use rodio::{buffer::SamplesBuffer, OutputStream, Sink, Source};
use std::io::Cursor;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::async_runtime::{channel, spawn, spawn_blocking, JoinHandle, Sender};
use tokio::sync::mpsc::error::TryRecvError;
use tokio::sync::oneshot;

/// Audio handed to a playing [`AudioPlayer`] through its [`PlaybackFeed`].
#[derive(Debug)]
pub(crate) enum FeedMessage {
  /// The following audio belongs to the sequence item with this index.
  Item(usize),
  Wav {
    wav: Vec<u8>,
    skip: Duration,
  },
  Pcm {
    pcm: Vec<u8>,
    sample_rate: u32,
    channels: u16,
    skip: Duration,
  },
  /// No more audio follows; playback finishes once the queue drains.
  Finish,
  Fail(String),
}

/// Producer side of a streaming [`AudioPlayer`]. Audio is queued in the order it is sent, and
/// the queue keeps playing silence while it waits for the next chunk. Dropping the feed without
/// [`Self::finish`] finishes playback as well.
#[derive(Clone)]
pub struct PlaybackFeed {
  tx: mpsc::Sender<FeedMessage>,
}

impl PlaybackFeed {
  /// A feed whose messages go to the returned receiver instead of an audio device.
  #[cfg(test)]
  pub(crate) fn for_test() -> (Self, mpsc::Receiver<FeedMessage>) {
    let (tx, rx) = mpsc::channel();
    (Self { tx }, rx)
  }

  // Sends fail only after the player stopped, when nobody is listening anymore.
  fn send(&self, message: FeedMessage) {
    let _ = self.tx.send(message);
  }

  /// Marks the start of a sequence item; following audio belongs to `index`.
  pub fn begin_item(&self, index: usize) {
    self.send(FeedMessage::Item(index));
  }

  /// Queues a whole WAV file, skipping its first `skip`.
  pub fn wav(&self, wav: Vec<u8>, skip: Duration) {
    self.send(FeedMessage::Wav { wav, skip });
  }

  /// Queues 16-bit little-endian PCM, skipping its first `skip`.
  pub fn pcm(&self, pcm: Vec<u8>, sample_rate: u32, stereo: bool, skip: Duration) {
    self.send(FeedMessage::Pcm {
      pcm,
      sample_rate,
      channels: if stereo { 2 } else { 1 },
      skip,
    });
  }

  pub fn finish(&self) {
    self.send(FeedMessage::Finish);
  }

  /// Stops playback with an error. Before any audio was queued, the error is returned from
  /// [`AudioPlayer::wait_started`]; afterwards it is reported to the failure callback.
  pub fn fail(&self, error: String) {
    self.send(FeedMessage::Fail(error));
  }
}

enum PlaybackOutcome {
  Finished,
  Stopped,
  Failed(String),
}

pub struct AudioPlayer {
  stop_tx: Sender<()>,
  handle: Option<JoinHandle<()>>,
  started_rx: Option<oneshot::Receiver<Result<(), String>>>,
  producer: Option<JoinHandle<()>>,
}

impl AudioPlayer {
  pub async fn play<F>(wav: Vec<u8>, start_at: Duration, on_finished: F) -> Result<Self, String>
  where
    F: FnOnce() + Send + 'static,
  {
    Self::play_many_from(vec![wav], start_at, |_| {}, on_finished).await
  }

  pub async fn play_many<F, G>(
    wavs: Vec<Vec<u8>>,
    on_item_started: F,
    on_finished: G,
  ) -> Result<Self, String>
  where
    F: FnMut(usize) + Send + 'static,
    G: FnOnce() + Send + 'static,
  {
    Self::play_many_from(wavs, Duration::ZERO, on_item_started, on_finished).await
  }

  pub async fn play_many_from<F, G>(
    wavs: Vec<Vec<u8>>,
    start_at: Duration,
    on_item_started: F,
    on_finished: G,
  ) -> Result<Self, String>
  where
    F: FnMut(usize) + Send + 'static,
    G: FnOnce() + Send + 'static,
  {
    let (mut player, feed) = Self::stream(on_item_started, on_finished, |_| {}).await?;
    for (index, wav) in wavs.into_iter().enumerate() {
      feed.begin_item(index);
      feed.wav(wav, if index == 0 { start_at } else { Duration::ZERO });
    }
    feed.finish();
    player.wait_started().await?;
    Ok(player)
  }

  /// Opens the audio output and returns a player fed through the returned [`PlaybackFeed`].
  /// Playback begins with the first queued audio; await [`Self::wait_started`] for it.
  pub async fn stream<F, G, H>(
    mut on_item_started: F,
    on_finished: G,
    on_failed: H,
  ) -> Result<(Self, PlaybackFeed), String>
  where
    F: FnMut(usize) + Send + 'static,
    G: FnOnce() + Send + 'static,
    H: FnOnce(String) + Send + 'static,
  {
    let (stop_tx, mut stop_rx) = channel::<()>(1);
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();
    let (started_tx, started_rx) = oneshot::channel::<Result<(), String>>();
    let (feed_tx, feed_rx) = mpsc::channel::<FeedMessage>();

    let handle = spawn(async move {
      let outcome = spawn_blocking(move || {
        let (_stream, stream_handle) = match OutputStream::try_default() {
          Ok(v) => v,
          Err(e) => {
            let _ = ready_tx.send(Err(format!("Failed to open audio output: {e}")));
            return PlaybackOutcome::Stopped;
          }
        };
        let sink = match Sink::try_new(&stream_handle) {
          Ok(v) => v,
          Err(e) => {
            let _ = ready_tx.send(Err(format!("Failed to create audio sink: {e}")));
            return PlaybackOutcome::Stopped;
          }
        };
        sink.pause();
        let _ = ready_tx.send(Ok(()));

        let mut started_tx = Some(started_tx);
        let mut queue = SourceQueue::default();
        let mut producing = true;
        loop {
          match stop_rx.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => {
              sink.stop();
              return PlaybackOutcome::Stopped;
            }
            Err(TryRecvError::Empty) => {}
          }
          while producing {
            let message = match feed_rx.try_recv() {
              Ok(message) => message,
              Err(mpsc::TryRecvError::Empty) => break,
              Err(mpsc::TryRecvError::Disconnected) => FeedMessage::Finish,
            };
            let appended = match message {
              FeedMessage::Item(index) => {
                queue.begin_item(index);
                Ok(false)
              }
              FeedMessage::Wav { wav, skip } => rodio::Decoder::new_wav(Cursor::new(wav))
                .map(|decoder| {
                  if skip.is_zero() {
                    sink.append(decoder);
                  } else {
                    sink.append(decoder.skip_duration(skip));
                  }
                  true
                })
                .map_err(|e| format!("Failed to decode WAV audio: {e}")),
              FeedMessage::Pcm {
                pcm,
                sample_rate,
                channels,
                skip,
              } => {
                let source = SamplesBuffer::new(channels, sample_rate, pcm_samples(&pcm));
                if skip.is_zero() {
                  sink.append(source);
                } else {
                  sink.append(source.skip_duration(skip));
                }
                Ok(true)
              }
              FeedMessage::Finish => {
                producing = false;
                Ok(false)
              }
              FeedMessage::Fail(error) => Err(error),
            };
            match appended {
              Ok(true) => {
                queue.appended += 1;
                if let Some(started_tx) = started_tx.take() {
                  sink.play();
                  let _ = started_tx.send(Ok(()));
                }
              }
              Ok(false) => {}
              Err(error) => {
                sink.stop();
                return match started_tx.take() {
                  Some(started_tx) => {
                    let _ = started_tx.send(Err(error));
                    PlaybackOutcome::Stopped
                  }
                  None => PlaybackOutcome::Failed(error),
                };
              }
            }
          }
          if !producing {
            if let Some(started_tx) = started_tx.take() {
              let _ = started_tx.send(Ok(()));
            }
          }
          queue.notify_started(sink.len(), &mut on_item_started);
          if !producing && sink.empty() {
            return PlaybackOutcome::Finished;
          }
          thread::sleep(Duration::from_millis(10));
        }
      })
      .await;
      match outcome {
        Ok(PlaybackOutcome::Finished) => on_finished(),
        Ok(PlaybackOutcome::Failed(error)) => on_failed(error),
        Ok(PlaybackOutcome::Stopped) => {}
        Err(e) => eprintln!("Audio player task panicked: {e:?}"),
      }
    });

    ready_rx
      .await
      .map_err(|_| "Audio player initialization channel dropped".to_string())??;

    Ok((
      Self {
        stop_tx,
        handle: Some(handle),
        started_rx: Some(started_rx),
        producer: None,
      },
      PlaybackFeed { tx: feed_tx },
    ))
  }

  /// Ties the task feeding this player to its lifetime, so stopping playback stops rendering.
  pub fn attach_producer(&mut self, producer: JoinHandle<()>) {
    if let Some(previous) = self.producer.replace(producer) {
      previous.abort();
    }
  }

  /// Waits until the first audio is queued, or fails with the error that ended playback
  /// before any audio played. Returns immediately when called again.
  pub async fn wait_started(&mut self) -> Result<(), String> {
    let Some(started_rx) = self.started_rx.take() else {
      return Ok(());
    };
    started_rx
      .await
      .map_err(|_| "Audio player stopped before playback started".to_string())?
  }

  pub async fn stop(mut self) {
    if let Some(producer) = self.producer.take() {
      producer.abort();
    }
    let _ = self.stop_tx.send(()).await;
    if let Some(handle) = self.handle.take() {
      let _ = handle.await;
    }
  }
}

fn pcm_samples(pcm: &[u8]) -> Vec<i16> {
  let (samples, _) = pcm.as_chunks::<2>();
  samples.iter().copied().map(i16::from_le_bytes).collect()
}

/// Tracks which sink sources belong to which sequence item, so item starts can be reported as
/// the sink advances through a queue that grows while it plays.
#[derive(Default)]
struct SourceQueue {
  /// Index of each item's first source, in item order.
  item_first_sources: Vec<usize>,
  appended: usize,
  next_started_item: usize,
}

impl SourceQueue {
  fn begin_item(&mut self, index: usize) {
    debug_assert_eq!(index, self.item_first_sources.len());
    self.item_first_sources.push(self.appended);
  }

  /// Reports every item whose first source is playing or done. `remaining_sources` is the
  /// sink's queue length, including the playing source.
  fn notify_started<F>(&mut self, remaining_sources: usize, on_item_started: &mut F)
  where
    F: FnMut(usize),
  {
    let active_source = self.appended.saturating_sub(remaining_sources);
    while let Some(&first_source) = self.item_first_sources.get(self.next_started_item) {
      if first_source >= self.appended || first_source > active_source {
        break;
      }
      on_item_started(self.next_started_item);
      self.next_started_item += 1;
    }
  }
}

impl Drop for AudioPlayer {
  fn drop(&mut self) {
    if let Some(producer) = self.producer.take() {
      producer.abort();
    }
    if let Some(handle) = self.handle.take() {
      handle.abort();
    }
  }
}

#[cfg(test)]
mod tests {
  use super::{pcm_samples, SourceQueue};

  fn queue_with_items(sources_per_item: &[usize]) -> SourceQueue {
    let mut queue = SourceQueue::default();
    for (index, &sources) in sources_per_item.iter().enumerate() {
      queue.begin_item(index);
      queue.appended += sources;
    }
    queue
  }

  #[test]
  fn reports_each_started_item_when_the_queue_advances() {
    let mut queue = queue_with_items(&[1, 1, 1]);
    let mut started_items = Vec::new();

    queue.notify_started(3, &mut |index| started_items.push(index));
    queue.notify_started(2, &mut |index| started_items.push(index));
    queue.notify_started(0, &mut |index| started_items.push(index));

    assert_eq!(started_items, vec![0, 1, 2]);
  }

  #[test]
  fn streamed_items_start_at_their_first_chunk() {
    let mut queue = queue_with_items(&[3, 2]);
    let mut started_items = Vec::new();

    // Playing the second chunk of the first item.
    queue.notify_started(4, &mut |index| started_items.push(index));
    assert_eq!(started_items, vec![0]);
    // Playing the first chunk of the second item.
    queue.notify_started(2, &mut |index| started_items.push(index));
    assert_eq!(started_items, vec![0, 1]);
  }

  #[test]
  fn an_item_without_audio_yet_is_not_reported_during_an_underrun() {
    let mut queue = queue_with_items(&[2]);
    queue.begin_item(1);
    let mut started_items = Vec::new();

    // Every source played and the second item has nothing queued yet.
    queue.notify_started(0, &mut |index| started_items.push(index));
    assert_eq!(started_items, vec![0]);

    queue.appended += 1;
    queue.notify_started(1, &mut |index| started_items.push(index));
    assert_eq!(started_items, vec![0, 1]);
  }

  #[test]
  fn pcm_samples_decode_little_endian_and_drop_a_trailing_byte() {
    assert_eq!(pcm_samples(&[0x01, 0x00, 0xff, 0xff, 0x7f]), vec![1, -1]);
  }
}
