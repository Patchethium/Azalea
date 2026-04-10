use rodio::{OutputStream, Sink};
use std::io::Cursor;
use tauri::async_runtime::{channel, spawn, spawn_blocking, JoinHandle, Sender, TokioHandle};
use tokio::sync::oneshot;

pub struct AudioPlayer {
  stop_tx: Sender<()>,
  handle: Option<JoinHandle<()>>,
}

impl AudioPlayer {
  pub async fn play(wav: Vec<u8>) -> Result<Self, String> {
    let (stop_tx, mut stop_rx) = channel::<()>(1);
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();

    let handle = spawn(async move {
      spawn_blocking(move || {
        let (_stream, stream_handle) = match OutputStream::try_default() {
          Ok(v) => v,
          Err(e) => {
            let _ = ready_tx.send(Err(format!("Failed to open audio output: {e}")));
            return;
          }
        };
        let sink = match Sink::try_new(&stream_handle) {
          Ok(v) => v,
          Err(e) => {
            let _ = ready_tx.send(Err(format!("Failed to create audio sink: {e}")));
            return;
          }
        };
        let cursor = Cursor::new(wav);
        let decoder = match rodio::Decoder::new_wav(cursor) {
          Ok(v) => v,
          Err(e) => {
            let _ = ready_tx.send(Err(format!("Failed to decode WAV audio: {e}")));
            return;
          }
        };
        sink.append(decoder);
        sink.play();
        let _ = ready_tx.send(Ok(()));
        // only this works, I don't know nothing about async Rust (@ _ @)
        TokioHandle::current().block_on(stop_rx.recv());
        sink.stop();
      })
      .await
      .ok();
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

impl Drop for AudioPlayer {
  fn drop(&mut self) {
    if let Some(handle) = self.handle.take() {
      handle.abort();
    }
  }
}
