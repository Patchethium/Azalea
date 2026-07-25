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
  fn has_same_payload(&self, other: &Self) -> bool {
    self.query_key == other.query_key && self.speaker_id == other.speaker_id
  }

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
  latest_by_block: HashMap<String, SynthesisJobIdentity>,
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
      .latest_generation_by_block
      .get(&job.identity.block_id)
      .is_some_and(|generation_id| job.identity.generation_id < *generation_id)
    {
      events.push(job.identity.event(SynthesisJobState::Cancelled, None));
      return events;
    }

    if state
      .pending
      .iter()
      .any(|pending| pending.identity == job.identity)
    {
      events.push(job.identity.event(SynthesisJobState::Queued, None));
      return events;
    }
    if state.running.as_ref() == Some(&job.identity) {
      events.push(job.identity.event(SynthesisJobState::Running, None));
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
        .get(position)
        .expect("pending synthesis job disappeared while locked");
      if existing.identity.has_same_payload(&job.identity) {
        let existing = state
          .pending
          .remove(position)
          .expect("pending synthesis job disappeared while locked");
        events.push(existing.identity.event(SynthesisJobState::Cancelled, None));
        state
          .latest_by_block
          .insert(job.identity.block_id.clone(), job.identity.clone());
        events.push(job.identity.event(SynthesisJobState::Queued, None));
        state.pending.insert(position, job);
        drop(state);
        self.notify.notify_one();
        return events;
      }
    }

    let mut retained = VecDeque::with_capacity(state.pending.len());
    while let Some(pending) = state.pending.pop_front() {
      if pending.identity.block_id == job.identity.block_id {
        events.push(pending.identity.event(SynthesisJobState::Cancelled, None));
      } else {
        retained.push_back(pending);
      }
    }
    state.pending = retained;

    if let Some(running) = state.running.as_ref() {
      if running.block_id == job.identity.block_id
        && state.latest_by_block.get(&running.block_id) == Some(running)
      {
        events.push(running.event(SynthesisJobState::Cancelled, None));
      }
    }

    while state.pending.len() >= SYNTHESIS_QUEUE_CAPACITY {
      if let Some(evicted) = state.pending.pop_front() {
        if state.latest_by_block.get(&evicted.identity.block_id) == Some(&evicted.identity) {
          state.latest_by_block.remove(&evicted.identity.block_id);
        }
        events.push(evicted.identity.event(SynthesisJobState::Evicted, None));
      }
    }

    state
      .latest_by_block
      .insert(job.identity.block_id.clone(), job.identity.clone());
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
    while let Some(job) = state.pending.pop_front() {
      if state.latest_by_block.get(&job.identity.block_id) == Some(&job.identity) {
        state.running = Some(job.identity.clone());
        return Some(job);
      }
    }
    None
  }

  pub fn finish(&self, identity: &SynthesisJobIdentity) -> bool {
    let mut state = self.state.lock().unwrap();
    if state.running.as_ref() == Some(identity) {
      state.running = None;
    }
    if state.latest_by_block.get(&identity.block_id) == Some(identity) {
      state.latest_by_block.remove(&identity.block_id);
      true
    } else {
      false
    }
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
      if matches(running) && state.latest_by_block.get(&running.block_id) == Some(running) {
        events.push(running.event(SynthesisJobState::Cancelled, None));
      }
    }

    if let Some(latest) = state.latest_by_block.get(block_id) {
      if matches(latest) {
        state.latest_by_block.remove(block_id);
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
  fn replacement_moves_the_newest_block_job_to_the_back() {
    let queue = SynthesisQueue::default();
    queue.enqueue(job("first", 1, 1.0));
    queue.enqueue(job("second", 1, 1.0));

    let events = queue.enqueue(job("first", 2, 1.2));

    assert_eq!(events.len(), 2);
    assert_eq!(events[0].generation_id, 1);
    assert_eq!(events[0].state, SynthesisJobState::Cancelled);
    assert_eq!(events[1].generation_id, 2);
    assert_eq!(events[1].state, SynthesisJobState::Queued);
    assert_eq!(queue.pop_next().unwrap().identity.block_id, "second");
    queue.finish(&job("second", 1, 1.0).identity);
    assert_eq!(queue.pop_next().unwrap().identity.generation_id, 2);
  }

  #[test]
  fn identical_payload_keeps_its_place_in_the_queue() {
    let queue = SynthesisQueue::default();
    queue.enqueue(job("first", 1, 1.0));
    queue.enqueue(job("second", 1, 1.0));

    queue.enqueue(job("first", 2, 1.0));

    let first = queue.pop_next().unwrap();
    assert_eq!(first.identity.block_id, "first");
    assert_eq!(first.identity.generation_id, 2);
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
}
