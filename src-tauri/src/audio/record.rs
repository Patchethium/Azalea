//! Microphone recording for voice import, through the cpal backend rodio already uses.
//!
//! cpal streams are not `Send` on every platform, so each recording owns a thread that builds,
//! plays and drops its stream; [`Recording`] only holds the channel that stops it.

use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use rodio::cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rodio::cpal::{self, FromSample, Sample, SizedSample};

use super::decode::{MonoAudio, MAX_SECONDS};

/// How often the level callback runs while recording.
const LEVEL_INTERVAL: Duration = Duration::from_millis(50);

/// The input level and recorded length, reported every [`LEVEL_INTERVAL`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RecordingLevel {
  /// Peak absolute sample since the previous report, in `[0, 1]`.
  pub peak: f32,
  pub seconds: f64,
  /// Set once [`MAX_SECONDS`] are recorded; later input is dropped.
  pub full: bool,
}

/// Samples received from the device, mixed down to mono and capped at [`MAX_SECONDS`].
struct Capture {
  samples: Vec<f32>,
  sample_rate: u32,
  channels: usize,
  peak: f32,
  error: Option<String>,
}

impl Capture {
  fn new(sample_rate: u32, channels: usize) -> Self {
    Self {
      samples: Vec::new(),
      sample_rate,
      channels: channels.max(1),
      peak: 0.0,
      error: None,
    }
  }

  fn capacity(&self) -> usize {
    (f64::from(self.sample_rate) * MAX_SECONDS) as usize
  }

  fn push<T: Sample>(&mut self, interleaved: &[T])
  where
    f32: FromSample<T>,
  {
    let capacity = self.capacity();
    for frame in interleaved.chunks_exact(self.channels) {
      let sample = frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / self.channels as f32;
      self.peak = self.peak.max(sample.abs().min(1.0));
      if self.samples.len() < capacity {
        self.samples.push(sample);
      }
    }
  }

  fn level(&mut self) -> RecordingLevel {
    RecordingLevel {
      peak: std::mem::take(&mut self.peak),
      seconds: self.samples.len() as f64 / f64::from(self.sample_rate),
      full: self.samples.len() >= self.capacity(),
    }
  }
}

/// A running recording. Dropping it stops recording and discards the audio.
pub struct Recording {
  stop: Option<mpsc::Sender<()>>,
  thread: Option<JoinHandle<Result<MonoAudio, String>>>,
}

impl Recording {
  /// Starts recording from the default input device, calling `on_level` every
  /// [`LEVEL_INTERVAL`] from the recording thread.
  pub fn start(on_level: impl Fn(RecordingLevel) + Send + 'static) -> Result<Self, String> {
    let (stop, stopped) = mpsc::channel();
    let (ready, started) = mpsc::sync_channel(1);
    let thread = std::thread::Builder::new()
      .name("voice-recording".into())
      .spawn(move || {
        let (stream, capture) = match open_default_input() {
          Ok(opened) => {
            let _ = ready.send(Ok(()));
            opened
          }
          Err(error) => {
            let _ = ready.send(Err(error.clone()));
            return Err(error);
          }
        };
        loop {
          match stopped.recv_timeout(LEVEL_INTERVAL) {
            Err(RecvTimeoutError::Timeout) => {
              let level = capture.lock().unwrap().level();
              on_level(level);
            }
            // Stopped, or the `Recording` was dropped.
            _ => break,
          }
        }
        drop(stream);
        let capture = std::mem::replace(&mut *capture.lock().unwrap(), Capture::new(1, 1));
        if let Some(error) = capture.error {
          return Err(error);
        }
        let audio = MonoAudio {
          samples: capture.samples,
          sample_rate: capture.sample_rate,
        };
        audio.check_length()?;
        Ok(audio)
      })
      .map_err(|e| e.to_string())?;
    match started.recv() {
      Ok(Ok(())) => Ok(Self {
        stop: Some(stop),
        thread: Some(thread),
      }),
      Ok(Err(error)) => {
        let _ = thread.join();
        Err(error)
      }
      Err(_) => Err("The recording thread stopped unexpectedly".into()),
    }
  }

  /// Stops recording and returns the recorded audio.
  pub fn finish(mut self) -> Result<MonoAudio, String> {
    self.stop.take();
    self
      .thread
      .take()
      .expect("a recording is finished once")
      .join()
      .map_err(|_| "The recording thread panicked".to_string())?
  }
}

impl Drop for Recording {
  fn drop(&mut self) {
    // Closing the channel stops the thread, which drops the stream.
    self.stop.take();
  }
}

type SharedCapture = Arc<Mutex<Capture>>;

fn open_default_input() -> Result<(cpal::Stream, SharedCapture), String> {
  let device = cpal::default_host()
    .default_input_device()
    .ok_or("No microphone is available")?;
  let config = device
    .default_input_config()
    .map_err(|e| format!("Cannot open the microphone: {e}"))?;
  let capture = Arc::new(Mutex::new(Capture::new(
    config.sample_rate().0,
    usize::from(config.channels()),
  )));
  let stream_config = config.config();
  let stream = match config.sample_format() {
    cpal::SampleFormat::F32 => build::<f32>(&device, &stream_config, &capture),
    cpal::SampleFormat::F64 => build::<f64>(&device, &stream_config, &capture),
    cpal::SampleFormat::I16 => build::<i16>(&device, &stream_config, &capture),
    cpal::SampleFormat::I32 => build::<i32>(&device, &stream_config, &capture),
    cpal::SampleFormat::I8 => build::<i8>(&device, &stream_config, &capture),
    cpal::SampleFormat::U16 => build::<u16>(&device, &stream_config, &capture),
    cpal::SampleFormat::U8 => build::<u8>(&device, &stream_config, &capture),
    format => return Err(format!("Unsupported microphone sample format {format}")),
  }
  .map_err(|e| format!("Cannot open the microphone: {e}"))?;
  stream
    .play()
    .map_err(|e| format!("Cannot start the microphone: {e}"))?;
  Ok((stream, capture))
}

fn build<T: SizedSample + Send + 'static>(
  device: &cpal::Device,
  config: &cpal::StreamConfig,
  capture: &SharedCapture,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
  f32: FromSample<T>,
{
  let data = capture.clone();
  let error = capture.clone();
  device.build_input_stream(
    config,
    move |samples: &[T], _: &cpal::InputCallbackInfo| data.lock().unwrap().push(samples),
    move |e| {
      error
        .lock()
        .unwrap()
        .error
        .get_or_insert_with(|| format!("The microphone stopped: {e}"));
    },
    None,
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn capture_mixes_down_and_reports_the_peak_once() {
    let mut capture = Capture::new(4, 2);
    capture.push(&[0.5f32, -0.5, 1.0, 0.5, -0.25, -0.75]);
    assert_eq!(capture.samples, [0.0, 0.75, -0.5]);
    let level = capture.level();
    assert_eq!(level.peak, 0.75);
    assert_eq!(level.seconds, 0.75);
    assert!(!level.full);
    assert_eq!(capture.level().peak, 0.0);
  }

  #[test]
  fn capture_converts_integer_samples() {
    let mut capture = Capture::new(16000, 1);
    capture.push(&[i16::MIN, 0, i16::MAX / 2]);
    assert_eq!(capture.samples[0], -1.0);
    assert_eq!(capture.samples[1], 0.0);
    assert!((capture.samples[2] - 0.5).abs() < 1e-3);
  }

  #[test]
  fn capture_stops_storing_at_the_limit() {
    let mut capture = Capture::new(2, 1);
    let limit = (2.0 * MAX_SECONDS) as usize;
    capture.push(&vec![0.1f32; limit + 10]);
    assert_eq!(capture.samples.len(), limit);
    let level = capture.level();
    assert!(level.full);
    assert_eq!(level.seconds, MAX_SECONDS);
    // Input past the limit still moves the meter.
    capture.push(&[0.9f32]);
    assert_eq!(capture.level().peak, 0.9);
  }
}
