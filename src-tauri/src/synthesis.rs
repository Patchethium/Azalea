use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::sync::{Notify, OnceCell};
use voicevox_core::{AudioQuery, StyleId};

const SYNTHESIS_QUEUE_CAPACITY: usize = 256;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SynthesisJobRequest {
  pub block_id: String,
  pub generation_id: u64,
  pub audio_query: AudioQuery,
  pub speaker_id: StyleId,
  pub hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
pub enum SynthesisJobState {
  Queued,
  Running,
  Completed,
  Failed,
  Cancelled,
  Evicted,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct SynthesisJobEvent {
  pub block_id: String,
  pub generation_id: u64,
  pub hash: String,
  pub state: SynthesisJobState,
  pub error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SynthesisJobIdentity {
  pub block_id: String,
  pub generation_id: u64,
  pub hash: String,
  pub query_key: String,
  pub speaker_id: StyleId,
}

impl SynthesisJobIdentity {
  pub fn event(&self, state: SynthesisJobState, error: Option<String>) -> SynthesisJobEvent {
    SynthesisJobEvent {
      block_id: self.block_id.clone(),
      generation_id: self.generation_id,
      hash: self.hash.clone(),
      state,
      error,
    }
  }
}

#[derive(Clone)]
pub(crate) struct SynthesisJob {
  pub request: SynthesisJobRequest,
  pub identity: SynthesisJobIdentity,
}

impl SynthesisJob {
  pub fn new(request: SynthesisJobRequest, query_key: String) -> Self {
    let identity = SynthesisJobIdentity {
      block_id: request.block_id.clone(),
      generation_id: request.generation_id,
      hash: request.hash.clone(),
      query_key,
      speaker_id: request.speaker_id,
    };
    Self { request, identity }
  }
}

#[derive(Default)]
struct SynthesisQueueState {
  pending: VecDeque<SynthesisJob>,
  running: Option<SynthesisJobIdentity>,
  running_is_cancelled: bool,
  latest_generation_by_block: HashMap<String, u64>,
}

pub(crate) struct SynthesisQueue {
  state: Mutex<SynthesisQueueState>,
  notify: Notify,
}

impl Default for SynthesisQueue {
  fn default() -> Self {
    Self {
      state: Mutex::new(SynthesisQueueState::default()),
      notify: Notify::new(),
    }
  }
}

impl SynthesisQueue {
  pub fn enqueue(&self, job: SynthesisJob) -> Vec<SynthesisJobEvent> {
    let mut state = self.state.lock().unwrap();
    let mut events = Vec::new();

    if state
      .pending
      .iter()
      .any(|pending| pending.identity == job.identity)
    {
      events.push(job.identity.event(SynthesisJobState::Queued, None));
      return events;
    }
    if state.running.as_ref() == Some(&job.identity) {
      let current_state = if state.running_is_cancelled {
        SynthesisJobState::Cancelled
      } else {
        SynthesisJobState::Running
      };
      events.push(job.identity.event(current_state, None));
      return events;
    }

    if state
      .latest_generation_by_block
      .get(&job.identity.block_id)
      .is_some_and(|generation_id| job.identity.generation_id < *generation_id)
    {
      events.push(job.identity.event(SynthesisJobState::Cancelled, None));
      return events;
    }

    state
      .latest_generation_by_block
      .insert(job.identity.block_id.clone(), job.identity.generation_id);

    if let Some(position) = state
      .pending
      .iter()
      .position(|pending| pending.identity.block_id == job.identity.block_id)
    {
      let existing = state
        .pending
        .remove(position)
        .expect("pending synthesis job disappeared while locked");
      events.push(existing.identity.event(SynthesisJobState::Cancelled, None));
      events.push(job.identity.event(SynthesisJobState::Queued, None));
      state.pending.insert(position, job);
      drop(state);
      self.notify.notify_one();
      return events;
    }

    while state.pending.len() >= SYNTHESIS_QUEUE_CAPACITY {
      if let Some(evicted) = state.pending.pop_front() {
        events.push(evicted.identity.event(SynthesisJobState::Evicted, None));
      }
    }

    events.push(job.identity.event(SynthesisJobState::Queued, None));
    state.pending.push_back(job);
    drop(state);
    self.notify.notify_one();
    events
  }

  pub async fn next(&self) -> SynthesisJob {
    loop {
      let notified = self.notify.notified();
      if let Some(job) = self.pop_next() {
        return job;
      }
      notified.await;
    }
  }

  fn pop_next(&self) -> Option<SynthesisJob> {
    let mut state = self.state.lock().unwrap();
    if state.running.is_some() {
      return None;
    }
    let job = state.pending.pop_front()?;
    state.running = Some(job.identity.clone());
    state.running_is_cancelled = false;
    Some(job)
  }

  pub fn finish(&self, identity: &SynthesisJobIdentity) -> bool {
    let mut state = self.state.lock().unwrap();
    if state.running.as_ref() != Some(identity) {
      return false;
    }
    state.running = None;
    let completed_without_cancellation = !state.running_is_cancelled;
    state.running_is_cancelled = false;
    drop(state);
    self.notify.notify_one();
    completed_without_cancellation
  }

  pub fn cancel(&self, block_id: &str, generation_id: Option<u64>) -> Vec<SynthesisJobEvent> {
    let mut state = self.state.lock().unwrap();
    let mut events = Vec::new();
    let matches = |identity: &SynthesisJobIdentity| {
      identity.block_id == block_id
        && generation_id
          .map(|generation_id| identity.generation_id == generation_id)
          .unwrap_or(true)
    };

    let mut retained = VecDeque::with_capacity(state.pending.len());
    while let Some(job) = state.pending.pop_front() {
      if matches(&job.identity) {
        events.push(job.identity.event(SynthesisJobState::Cancelled, None));
      } else {
        retained.push_back(job);
      }
    }
    state.pending = retained;

    if let Some(running) = state.running.as_ref() {
      if matches(running) && !state.running_is_cancelled {
        events.push(running.event(SynthesisJobState::Cancelled, None));
        state.running_is_cancelled = true;
      }
    }
    events
  }
}

#[derive(Clone)]
pub(crate) struct WaveformCacheOwner {
  pub identity: SynthesisJobIdentity,
}

pub(crate) struct WaveformCacheEntry {
  pub cell: Arc<OnceCell<Vec<u8>>>,
  pub owners: Vec<WaveformCacheOwner>,
}

impl WaveformCacheEntry {
  pub fn new(cell: Arc<OnceCell<Vec<u8>>>) -> Self {
    Self {
      cell,
      owners: Vec::new(),
    }
  }

  pub fn add_owner(&mut self, owner: WaveformCacheOwner) {
    self
      .owners
      .retain(|existing| existing.identity.block_id != owner.identity.block_id);
    self.owners.push(owner);
  }
}

pub(crate) fn eviction_events(
  entry: WaveformCacheEntry,
) -> impl Iterator<Item = SynthesisJobEvent> {
  entry
    .owners
    .into_iter()
    .map(|owner| owner.identity.event(SynthesisJobState::Evicted, None))
}

#[cfg(test)]
mod tests {
  use serde_json::json;
  use std::sync::mpsc;
  use std::thread;

  use super::*;

  fn request(block_id: &str, generation_id: u64, speed_scale: f32) -> SynthesisJobRequest {
    let audio_query = serde_json::from_value(json!({
      "accent_phrases": [],
      "speedScale": speed_scale,
      "pitchScale": 0.0,
      "intonationScale": 1.0,
      "volumeScale": 1.0,
      "prePhonemeLength": 0.1,
      "postPhonemeLength": 0.1,
      "outputSamplingRate": 24000,
      "outputStereo": false
    }))
    .unwrap();
    SynthesisJobRequest {
      block_id: block_id.into(),
      generation_id,
      audio_query,
      speaker_id: StyleId(1),
      hash: format!("hash-{generation_id}"),
    }
  }

  fn job(block_id: &str, generation_id: u64, speed_scale: f32) -> SynthesisJob {
    let request = request(block_id, generation_id, speed_scale);
    let query_key = serde_json::to_string(&request.audio_query).unwrap();
    SynthesisJob::new(request, query_key)
  }

  #[test]
  fn replacement_keeps_the_pending_jobs_position() {
    let queue = SynthesisQueue::default();
    queue.enqueue(job("first", 1, 1.0));
    queue.enqueue(job("second", 1, 1.0));

    let events = queue.enqueue(job("first", 2, 1.2));

    assert_eq!(events.len(), 2);
    assert_eq!(events[0].generation_id, 1);
    assert_eq!(events[0].state, SynthesisJobState::Cancelled);
    assert_eq!(events[1].generation_id, 2);
    assert_eq!(events[1].state, SynthesisJobState::Queued);
    let first = queue.pop_next().unwrap();
    assert_eq!(first.identity.block_id, "first");
    assert_eq!(first.identity.generation_id, 2);
    assert!(queue.finish(&first.identity));
    assert_eq!(queue.pop_next().unwrap().identity.block_id, "second");
  }

  #[test]
  fn a_running_job_is_not_replaced_by_newer_work_for_the_same_block() {
    let queue = SynthesisQueue::default();
    queue.enqueue(job("block", 1, 1.0));
    let running = queue.pop_next().unwrap();

    let events = queue.enqueue(job("block", 2, 1.2));

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].generation_id, 2);
    assert_eq!(events[0].state, SynthesisJobState::Queued);
    let duplicate_events = queue.enqueue(running.clone());
    assert_eq!(duplicate_events.len(), 1);
    assert_eq!(duplicate_events[0].state, SynthesisJobState::Running);
    assert!(queue.pop_next().is_none());
    assert!(queue.finish(&running.identity));
    assert_eq!(queue.pop_next().unwrap().identity.generation_id, 2);
  }

  #[test]
  fn an_out_of_order_generation_cannot_replace_newer_work() {
    let queue = SynthesisQueue::default();
    queue.enqueue(job("block", 2, 1.2));

    let events = queue.enqueue(job("block", 1, 1.0));

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].generation_id, 1);
    assert_eq!(events[0].state, SynthesisJobState::Cancelled);
    assert_eq!(queue.pop_next().unwrap().identity.generation_id, 2);
  }

  #[test]
  fn cancelling_running_work_makes_its_completion_stale() {
    let queue = SynthesisQueue::default();
    queue.enqueue(job("block", 7, 1.0));
    let running = queue.pop_next().unwrap();

    let events = queue.cancel("block", Some(7));

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].state, SynthesisJobState::Cancelled);
    assert!(!queue.finish(&running.identity));
  }

  #[test]
  fn duplicate_pending_and_running_jobs_report_their_existing_state() {
    let queue = SynthesisQueue::default();
    let duplicate = job("block", 1, 1.0);
    queue.enqueue(duplicate.clone());

    let pending_events = queue.enqueue(duplicate.clone());
    assert_eq!(pending_events.len(), 1);
    assert_eq!(pending_events[0].state, SynthesisJobState::Queued);

    let running = queue.pop_next().unwrap();
    let running_events = queue.enqueue(duplicate);
    assert_eq!(running_events.len(), 1);
    assert_eq!(running_events[0].state, SynthesisJobState::Running);
    assert!(queue.finish(&running.identity));
  }

  #[test]
  fn cancellation_can_target_one_generation_or_every_generation() {
    let queue = SynthesisQueue::default();
    queue.enqueue(job("first", 1, 1.0));
    queue.enqueue(job("second", 1, 1.0));

    assert!(queue.cancel("first", Some(9)).is_empty());
    let targeted = queue.cancel("first", Some(1));
    assert_eq!(targeted.len(), 1);
    assert_eq!(targeted[0].block_id, "first");
    assert_eq!(queue.pop_next().unwrap().identity.block_id, "second");

    queue.enqueue(job("third", 4, 1.0));
    let all = queue.cancel("third", None);
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].generation_id, 4);
  }

  #[test]
  fn full_queue_evicts_the_oldest_pending_block() {
    let queue = SynthesisQueue::default();
    for index in 0..SYNTHESIS_QUEUE_CAPACITY {
      queue.enqueue(job(&format!("block-{index}"), 1, 1.0));
    }

    let events = queue.enqueue(job("newest", 1, 1.0));

    assert_eq!(events.len(), 2);
    assert_eq!(events[0].block_id, "block-0");
    assert_eq!(events[0].state, SynthesisJobState::Evicted);
    assert_eq!(events[1].block_id, "newest");
    assert_eq!(events[1].state, SynthesisJobState::Queued);
    assert_eq!(queue.pop_next().unwrap().identity.block_id, "block-1");
  }

  #[test]
  fn cache_ownership_is_unique_per_block_and_emits_evictions() {
    let cell = Arc::new(OnceCell::new());
    let mut entry = WaveformCacheEntry::new(cell);
    entry.add_owner(WaveformCacheOwner {
      identity: job("same", 1, 1.0).identity,
    });
    entry.add_owner(WaveformCacheOwner {
      identity: job("other", 1, 1.0).identity,
    });
    entry.add_owner(WaveformCacheOwner {
      identity: job("same", 2, 1.2).identity,
    });

    assert_eq!(entry.owners.len(), 2);
    let events = eviction_events(entry).collect::<Vec<_>>();
    assert_eq!(events.len(), 2);
    assert!(events
      .iter()
      .all(|event| event.state == SynthesisJobState::Evicted));
    assert!(events
      .iter()
      .any(|event| event.block_id == "same" && event.generation_id == 2));
  }

  #[test]
  fn waiting_consumer_is_woken_by_a_concurrent_enqueue() {
    let queue = Arc::new(SynthesisQueue::default());
    let consumer_queue = queue.clone();
    let (started_tx, started_rx) = mpsc::channel();
    let consumer = thread::spawn(move || {
      started_tx.send(()).unwrap();
      tauri::async_runtime::block_on(consumer_queue.next())
    });

    started_rx.recv().unwrap();
    queue.enqueue(job("concurrent", 3, 1.0));

    let received = consumer.join().unwrap();
    assert_eq!(received.identity.block_id, "concurrent");
    assert_eq!(received.identity.generation_id, 3);
  }
}
