use anyhow::Result;
use rodio::{OutputStream, Sink};
use std::io::Cursor;

pub fn play_samples(samples: Vec<u8>) -> Result<()> {
  let (_stream, stream_handle) = OutputStream::try_default()?;
  let sink = Sink::try_new(&stream_handle)?;

  let cursor = Cursor::new(samples);

  sink.append(rodio::Decoder::new_wav(cursor)?);
  sink.sleep_until_end();
  Ok(())
}

pub fn stop_audio() -> Result<()> {
  let (_stream, stream_handle) = OutputStream::try_default()?;
  let sink = Sink::try_new(&stream_handle)?;
  sink.stop();
  Ok(())
}