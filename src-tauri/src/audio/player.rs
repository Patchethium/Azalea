use rodio::{OutputStream, Sink};
use std::io::Cursor;
use anyhow::Result;

pub fn play_samples(samples: Vec<u8>) -> Result<()> {
  let (_stream, stream_handle) = OutputStream::try_default()?;
  let sink = Sink::try_new(&stream_handle)?;

  let cursor = Cursor::new(samples);

  sink.append(rodio::Decoder::new(cursor)?);
  sink.sleep_until_end();
  Ok(())
}
