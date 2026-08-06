use rodio::{OutputStream, Sink};
use std::io::Cursor;
use std::thread;
use std::time::Duration;
use tauri::async_runtime::{channel, spawn, spawn_blocking, JoinHandle, Sender};
use tokio::sync::mpsc::error::TryRecvError;
use tokio::sync::oneshot;

pub struct AudioPlayer {
  stop_tx: Sender<()>,
  handle: Option<JoinHandle<()>>,
}

impl AudioPlayer {
  pub async fn play<F>(wav: Vec<u8>, on_finished: F) -> Result<Self, String>
  where
    F: FnOnce() + Send + 'static,
  {
    Self::play_many(vec![wav], |_| {}, on_finished).await
  }

  pub async fn play_many<F, G>(
    wavs: Vec<Vec<u8>>,
    mut on_item_started: F,
    on_finished: G,
  ) -> Result<Self, String>
  where
    F: FnMut(usize) + Send + 'static,
    G: FnOnce() + Send + 'static,
  {
    let (stop_tx, mut stop_rx) = channel::<()>(1);
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();

    let handle = spawn(async move {
      let naturally_finished = spawn_blocking(move || {
        let item_count = wavs.len();
        let (_stream, stream_handle) = match OutputStream::try_default() {
          Ok(v) => v,
          Err(e) => {
            let _ = ready_tx.send(Err(format!("Failed to open audio output: {e}")));
            return false;
          }
        };
        let sink = match Sink::try_new(&stream_handle) {
          Ok(v) => v,
          Err(e) => {
            let _ = ready_tx.send(Err(format!("Failed to create audio sink: {e}")));
            return false;
          }
        };
        sink.pause();
        for wav in wavs {
          let decoder = match rodio::Decoder::new_wav(Cursor::new(wav)) {
            Ok(v) => v,
            Err(e) => {
              let _ = ready_tx.send(Err(format!("Failed to decode WAV audio: {e}")));
              return false;
            }
          };
          sink.append(decoder);
        }
        let mut next_started_item = 0;
        notify_started_items(
          item_count,
          sink.len(),
          &mut next_started_item,
          &mut on_item_started,
        );
        sink.play();
        let _ = ready_tx.send(Ok(()));
        loop {
          match stop_rx.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => {
              sink.stop();
              return false;
            }
            Err(TryRecvError::Empty) => {}
          }
          notify_started_items(
            item_count,
            sink.len(),
            &mut next_started_item,
            &mut on_item_started,
          );
          if sink.empty() {
            return true;
          }
          thread::sleep(Duration::from_millis(10));
        }
      })
      .await;
      match naturally_finished {
        Ok(true) => on_finished(),
        Ok(false) => {}
        Err(e) => eprintln!("Audio player task panicked: {e:?}"),
      }
    });

    ready_rx
      .await
      .map_err(|_| "Audio player initialization channel dropped".to_string())??;

    Ok(Self {
      stop_tx,
      handle: Some(handle),
    })
  }

  pub async fn stop(mut self) {
    let _ = self.stop_tx.send(()).await;
    if let Some(handle) = self.handle.take() {
      let _ = handle.await;
    }
  }
}

fn notify_started_items<F>(
  item_count: usize,
  remaining_items: usize,
  next_started_item: &mut usize,
  on_item_started: &mut F,
) where
  F: FnMut(usize),
{
  let active_item = item_count.saturating_sub(remaining_items);
  while *next_started_item <= active_item && *next_started_item < item_count {
    on_item_started(*next_started_item);
    *next_started_item += 1;
  }
}

impl Drop for AudioPlayer {
  fn drop(&mut self) {
    if let Some(handle) = self.handle.take() {
      handle.abort();
    }
  }
}

#[cfg(test)]
mod tests {
  use super::notify_started_items;

  #[test]
  fn reports_each_started_item_when_the_queue_advances() {
    let mut next_started_item = 0;
    let mut started_items = Vec::new();

    notify_started_items(3, 3, &mut next_started_item, &mut |index| {
      started_items.push(index)
    });
    notify_started_items(3, 2, &mut next_started_item, &mut |index| {
      started_items.push(index)
    });
    notify_started_items(3, 0, &mut next_started_item, &mut |index| {
      started_items.push(index)
    });

    assert_eq!(started_items, vec![0, 1, 2]);
  }
}
