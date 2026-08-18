use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::hash::Hash;
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc, Mutex,
};

use futures_util::future::{select, Either};
use tokio::sync::Notify;

pub(crate) const DEFAULT_QUEUE_CAPACITY: usize = 256;

pub(crate) trait LatestJob: Clone {
  type Key: Clone + Eq + Hash;
  type Identity: Clone + Eq;

  fn key(&self) -> &Self::Key;
  fn generation_id(&self) -> u64;
  fn identity(&self) -> &Self::Identity;

  fn cancel_running_when_superseded(&self) -> bool {
    true
  }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum QueueEventState {
  Queued,
  Running,
  Cancelled,
  Evicted,
}

pub(crate) struct QueueEvent<I> {
  pub identity: I,
  pub state: QueueEventState,
}

impl<I> QueueEvent<I> {
  fn new(identity: I, state: QueueEventState) -> Self {
    Self { identity, state }
  }
}

#[derive(Default)]
pub(crate) struct JobCancellation {
  cancelled: AtomicBool,
  notify: Notify,
}

impl JobCancellation {
  fn cancel(&self) {
    if !self.cancelled.swap(true, Ordering::AcqRel) {
      self.notify.notify_waiters();
    }
  }

  pub async fn cancelled(&self) {
    loop {
      let notified = self.notify.notified();
      if self.cancelled.load(Ordering::Acquire) {
        return;
      }
      notified.await;
    }
  }

  #[cfg(test)]
  pub(crate) fn is_cancelled(&self) -> bool {
    self.cancelled.load(Ordering::Acquire)
  }
}

#[derive(Clone)]
pub(crate) struct QueuedJob<J> {
  pub job: J,
  pub cancellation: Arc<JobCancellation>,
}

struct RunningJob<K, I> {
  key: K,
  generation_id: u64,
  identity: I,
  cancellation: Arc<JobCancellation>,
  cancel_when_superseded: bool,
  cancelled: bool,
}

struct LatestJobQueueState<J: LatestJob> {
  pending: VecDeque<QueuedJob<J>>,
  running: Option<RunningJob<J::Key, J::Identity>>,
  latest_generation_by_key: HashMap<J::Key, u64>,
}

impl<J: LatestJob> Default for LatestJobQueueState<J> {
  fn default() -> Self {
    Self {
      pending: VecDeque::new(),
      running: None,
      latest_generation_by_key: HashMap::new(),
    }
  }
}

pub(crate) struct LatestJobQueue<J: LatestJob> {
  state: Mutex<LatestJobQueueState<J>>,
  notify: Notify,
  capacity: usize,
}

impl<J: LatestJob> Default for LatestJobQueue<J> {
  fn default() -> Self {
    Self::new(DEFAULT_QUEUE_CAPACITY)
  }
}

impl<J: LatestJob> LatestJobQueue<J> {
  pub fn new(capacity: usize) -> Self {
    assert!(capacity > 0, "latest-job queue capacity must be non-zero");
    Self {
      state: Mutex::new(LatestJobQueueState::default()),
      notify: Notify::new(),
      capacity,
    }
  }

  pub fn enqueue(&self, job: J) -> Vec<QueueEvent<J::Identity>> {
    let mut state = self.state.lock().unwrap();
    let mut events = Vec::new();

    if state
      .pending
      .iter()
      .any(|pending| pending.job.identity() == job.identity())
    {
      events.push(QueueEvent::new(
        job.identity().clone(),
        QueueEventState::Queued,
      ));
      return events;
    }
    if let Some(running) = state
      .running
      .as_ref()
      .filter(|running| &running.identity == job.identity())
    {
      events.push(QueueEvent::new(
        job.identity().clone(),
        if running.cancelled {
          QueueEventState::Cancelled
        } else {
          QueueEventState::Running
        },
      ));
      return events;
    }

    if state
      .latest_generation_by_key
      .get(job.key())
      .is_some_and(|generation_id| job.generation_id() < *generation_id)
    {
      events.push(QueueEvent::new(
        job.identity().clone(),
        QueueEventState::Cancelled,
      ));
      return events;
    }

    state
      .latest_generation_by_key
      .insert(job.key().clone(), job.generation_id());

    let superseded_running = state.running.as_mut().filter(|running| {
      &running.key == job.key() && running.cancel_when_superseded && !running.cancelled
    });
    if let Some(running) = superseded_running {
      events.push(QueueEvent::new(
        running.identity.clone(),
        QueueEventState::Cancelled,
      ));
      running.cancelled = true;
      running.cancellation.cancel();
    }

    let queued = QueuedJob {
      cancellation: Arc::new(JobCancellation::default()),
      job,
    };
    if let Some(position) = state
      .pending
      .iter()
      .position(|pending| pending.job.key() == queued.job.key())
    {
      let existing = state
        .pending
        .remove(position)
        .expect("pending latest-generation job disappeared while locked");
      events.push(QueueEvent::new(
        existing.job.identity().clone(),
        QueueEventState::Cancelled,
      ));
      events.push(QueueEvent::new(
        queued.job.identity().clone(),
        QueueEventState::Queued,
      ));
      state.pending.insert(position, queued);
      drop(state);
      self.notify.notify_one();
      return events;
    }

    while state.pending.len() >= self.capacity {
      if let Some(evicted) = state.pending.pop_front() {
        events.push(QueueEvent::new(
          evicted.job.identity().clone(),
          QueueEventState::Evicted,
        ));
      }
    }

    events.push(QueueEvent::new(
      queued.job.identity().clone(),
      QueueEventState::Queued,
    ));
    state.pending.push_back(queued);
    drop(state);
    self.notify.notify_one();
    events
  }

  pub async fn next(&self) -> QueuedJob<J> {
    loop {
      let notified = self.notify.notified();
      if let Some(job) = self.pop_next() {
        return job;
      }
      notified.await;
    }
  }

  pub(crate) fn pop_next(&self) -> Option<QueuedJob<J>> {
    self.pop_next_inner()
  }

  fn pop_next_inner(&self) -> Option<QueuedJob<J>> {
    let mut state = self.state.lock().unwrap();
    if state.running.is_some() {
      return None;
    }
    let queued = state.pending.pop_front()?;
    state.running = Some(RunningJob {
      key: queued.job.key().clone(),
      generation_id: queued.job.generation_id(),
      identity: queued.job.identity().clone(),
      cancellation: queued.cancellation.clone(),
      cancel_when_superseded: queued.job.cancel_running_when_superseded(),
      cancelled: false,
    });
    Some(queued)
  }

  pub fn finish(&self, identity: &J::Identity) -> bool {
    let mut state = self.state.lock().unwrap();
    let Some(running) = state
      .running
      .as_ref()
      .filter(|running| &running.identity == identity)
    else {
      return false;
    };
    let completed_without_cancellation = !running.cancelled;
    state.running = None;
    drop(state);
    self.notify.notify_one();
    completed_without_cancellation
  }

  pub fn cancel(&self, key: &J::Key, generation_id: Option<u64>) -> Vec<QueueEvent<J::Identity>> {
    let mut state = self.state.lock().unwrap();
    let mut events = Vec::new();
    let matches = |job_key: &J::Key, job_generation_id: u64| {
      job_key == key
        && generation_id
          .map(|generation_id| job_generation_id == generation_id)
          .unwrap_or(true)
    };

    let mut retained = VecDeque::with_capacity(state.pending.len());
    while let Some(job) = state.pending.pop_front() {
      if matches(job.job.key(), job.job.generation_id()) {
        events.push(QueueEvent::new(
          job.job.identity().clone(),
          QueueEventState::Cancelled,
        ));
      } else {
        retained.push_back(job);
      }
    }
    state.pending = retained;

    if let Some(running) = state
      .running
      .as_mut()
      .filter(|running| matches(&running.key, running.generation_id) && !running.cancelled)
    {
      events.push(QueueEvent::new(
        running.identity.clone(),
        QueueEventState::Cancelled,
      ));
      running.cancelled = true;
      running.cancellation.cancel();
    }
    events
  }
}

pub(crate) async fn run_cancellable<F: Future>(
  cancellation: &JobCancellation,
  future: F,
) -> Option<F::Output> {
  match select(Box::pin(cancellation.cancelled()), Box::pin(future)).await {
    Either::Left(_) => None,
    Either::Right((output, _)) => Some(output),
  }
}

#[cfg(test)]
mod tests {
  use std::sync::atomic::{AtomicUsize, Ordering};

  use super::*;

  #[derive(Clone, Debug, Eq, PartialEq)]
  struct TestIdentity {
    key: String,
    generation_id: u64,
  }

  #[derive(Clone)]
  struct TestJob {
    identity: TestIdentity,
    cancellable: bool,
  }

  impl TestJob {
    fn new(key: &str, generation_id: u64) -> Self {
      Self {
        identity: TestIdentity {
          key: key.into(),
          generation_id,
        },
        cancellable: true,
      }
    }
  }

  impl LatestJob for TestJob {
    type Key = String;
    type Identity = TestIdentity;

    fn key(&self) -> &Self::Key {
      &self.identity.key
    }

    fn generation_id(&self) -> u64 {
      self.identity.generation_id
    }

    fn identity(&self) -> &Self::Identity {
      &self.identity
    }

    fn cancel_running_when_superseded(&self) -> bool {
      self.cancellable
    }
  }

  #[test]
  fn rapid_submissions_cancel_running_work_and_keep_only_the_latest_pending_job() {
    let queue = LatestJobQueue::new(4);
    queue.enqueue(TestJob::new("block", 1));
    let running = queue.pop_next().unwrap();

    let second_events = queue.enqueue(TestJob::new("block", 2));
    let third_events = queue.enqueue(TestJob::new("block", 3));

    assert_eq!(second_events.len(), 2);
    assert_eq!(second_events[0].identity.generation_id, 1);
    assert_eq!(second_events[0].state, QueueEventState::Cancelled);
    assert_eq!(second_events[1].identity.generation_id, 2);
    assert_eq!(second_events[1].state, QueueEventState::Queued);
    assert_eq!(third_events.len(), 2);
    assert_eq!(third_events[0].identity.generation_id, 2);
    assert_eq!(third_events[0].state, QueueEventState::Cancelled);
    assert_eq!(third_events[1].identity.generation_id, 3);
    assert_eq!(third_events[1].state, QueueEventState::Queued);
    assert!(running.cancellation.is_cancelled());
    assert!(queue.pop_next().is_none());
    assert!(!queue.finish(&running.job.identity));
    assert_eq!(queue.pop_next().unwrap().job.identity.generation_id, 3);
  }

  #[test]
  fn superseding_can_leave_non_cancellable_running_work_active() {
    let queue = LatestJobQueue::new(4);
    let mut first = TestJob::new("block", 1);
    first.cancellable = false;
    queue.enqueue(first);
    let running = queue.pop_next().unwrap();

    let events = queue.enqueue(TestJob::new("block", 2));

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].state, QueueEventState::Queued);
    assert!(!running.cancellation.is_cancelled());
    assert!(queue.finish(&running.job.identity));
    assert_eq!(queue.pop_next().unwrap().job.identity.generation_id, 2);
  }

  #[test]
  fn queue_capacity_and_explicit_cancellation_are_keyed() {
    let queue = LatestJobQueue::new(2);
    queue.enqueue(TestJob::new("first", 1));
    queue.enqueue(TestJob::new("second", 1));

    let events = queue.enqueue(TestJob::new("third", 1));
    assert_eq!(events[0].identity.key, "first");
    assert_eq!(events[0].state, QueueEventState::Evicted);
    assert_eq!(events[1].identity.key, "third");
    assert_eq!(events[1].state, QueueEventState::Queued);

    let cancelled = queue.cancel(&"second".into(), None);
    assert_eq!(cancelled.len(), 1);
    assert_eq!(cancelled[0].identity.key, "second");
  }

  #[test]
  fn cancellable_runner_drops_superseded_work() {
    tauri::async_runtime::block_on(async {
      struct DropGuard(Arc<AtomicUsize>);
      impl Drop for DropGuard {
        fn drop(&mut self) {
          self.0.fetch_add(1, Ordering::SeqCst);
        }
      }

      let cancellation = Arc::new(JobCancellation::default());
      let dropped = Arc::new(AtomicUsize::new(0));
      let (started_tx, started_rx) = tokio::sync::oneshot::channel();
      let future_cancellation = cancellation.clone();
      let future_dropped = dropped.clone();
      let task = tauri::async_runtime::spawn(async move {
        run_cancellable(&future_cancellation, async move {
          let _guard = DropGuard(future_dropped);
          started_tx.send(()).unwrap();
          std::future::pending::<()>().await;
        })
        .await
      });

      started_rx.await.unwrap();
      cancellation.cancel();

      assert!(task.await.unwrap().is_none());
      assert_eq!(dropped.load(Ordering::SeqCst), 1);
    });
  }
}
