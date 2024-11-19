use rodio::{OutputStream, Sink};
use std::io::Cursor;
use tauri::async_runtime::{channel, spawn, spawn_blocking, JoinHandle, Sender, TokioHandle};

pub struct AudioPlayer {
  stop_tx: Sender<()>,
  handle: Option<JoinHandle<()>>,
}

impl AudioPlayer {
  pub fn play(wav: Vec<u8>) -> Self {
    let (stop_tx, mut stop_rx) = channel::<()>(1);
    let handle = spawn(async move {
      spawn_blocking(move || {
        let (_stream, stream_handle) = OutputStream::try_default().unwrap();
        let sink = Sink::try_new(&stream_handle).unwrap();
        let cursor = Cursor::new(wav);
        sink.append(rodio::Decoder::new_wav(cursor).unwrap());
        sink.play();
        // only this works, I don't know nothing about async Rust (@ _ @)
        TokioHandle::current().block_on(stop_rx.recv());
        sink.stop();
      })
      .await
      .unwrap();
    });
    Self {
      stop_tx,
      handle: Some(handle),
    }
  }

  pub async fn stop(mut self) {
    self.stop_tx.send(()).await.unwrap();
    self.handle.take().unwrap().await.unwrap();
  }
}

impl Drop for AudioPlayer {
  fn drop(&mut self) {
    if let Some(handle) = self.handle.take() {
      handle.abort();
    }
  }
}
