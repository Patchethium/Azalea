//! Decodes the audio files voice import accepts (WAV, FLAC, MP3, Ogg Vorbis) to mono samples,
//! and resamples them for the aligner.

use std::fs::File;
use std::path::Path;

use audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// The longest recording or file voice import accepts.
pub const MAX_SECONDS: f64 = 60.0;

/// Mono samples in `[-1, 1]` with their sample rate.
#[derive(Clone, Debug, PartialEq)]
pub struct MonoAudio {
  pub samples: Vec<f32>,
  pub sample_rate: u32,
}

impl MonoAudio {
  pub fn seconds(&self) -> f64 {
    self.samples.len() as f64 / f64::from(self.sample_rate)
  }

  /// Rejects empty and overlong audio.
  pub fn check_length(&self) -> Result<(), String> {
    if self.sample_rate == 0 || self.samples.is_empty() {
      return Err("The audio is empty".into());
    }
    if self.seconds() > MAX_SECONDS {
      return Err(format!("The audio is longer than {MAX_SECONDS:.0} seconds"));
    }
    Ok(())
  }
}

/// Averages interleaved channels into one.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
  if channels <= 1 {
    return interleaved.to_vec();
  }
  interleaved
    .chunks_exact(channels)
    .map(|frame| frame.iter().sum::<f32>() / channels as f32)
    .collect()
}

/// Decodes the default audio track of `path`, mixed down to mono.
pub fn decode_file(path: &Path) -> Result<MonoAudio, String> {
  let file = File::open(path).map_err(|e| format!("Cannot open the audio file: {e}"))?;
  let mut hint = Hint::new();
  if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
    hint.with_extension(extension);
  }
  let stream = MediaSourceStream::new(Box::new(file), Default::default());
  let mut format = symphonia::default::get_probe()
    .probe(
      &hint,
      stream,
      FormatOptions::default(),
      MetadataOptions::default(),
    )
    .map_err(|e| format!("Unsupported audio file: {e}"))?;
  let track = format
    .default_track(TrackType::Audio)
    .ok_or("The file has no audio track")?;
  let track_id = track.id;
  let params = track
    .codec_params
    .as_ref()
    .and_then(|params| params.audio())
    .ok_or("The file has no audio track")?;
  let mut decoder = symphonia::default::get_codecs()
    .make_audio_decoder(params, &AudioDecoderOptions::default())
    .map_err(|e| format!("Unsupported audio codec: {e}"))?;

  let mut samples = Vec::new();
  let mut sample_rate = 0;
  let mut interleaved: Vec<f32> = Vec::new();
  loop {
    let packet = match format.next_packet() {
      Ok(Some(packet)) => packet,
      Ok(None) => break,
      Err(SymphoniaError::ResetRequired) => break,
      Err(e) => return Err(format!("Cannot read the audio file: {e}")),
    };
    if packet.track_id != track_id {
      continue;
    }
    let buffer = match decoder.decode(&packet) {
      Ok(buffer) => buffer,
      // A corrupt packet is skipped, as players do.
      Err(SymphoniaError::DecodeError(_)) => continue,
      Err(e) => return Err(format!("Cannot decode the audio file: {e}")),
    };
    let spec = buffer.spec();
    let channels = spec.channels().count();
    if sample_rate == 0 {
      sample_rate = spec.rate();
    } else if sample_rate != spec.rate() {
      return Err("The audio changes its sample rate".into());
    }
    interleaved.resize(buffer.samples_interleaved(), 0.0);
    buffer.copy_to_slice_interleaved(&mut interleaved);
    samples.extend(downmix(&interleaved, channels));
    if sample_rate > 0 && samples.len() as f64 / f64::from(sample_rate) > MAX_SECONDS {
      return Err(format!("The audio is longer than {MAX_SECONDS:.0} seconds"));
    }
  }
  let audio = MonoAudio {
    samples,
    sample_rate,
  };
  audio.check_length()?;
  Ok(audio)
}

/// Resamples to `sample_rate`; audio already at that rate is returned unchanged.
pub fn resample(audio: &MonoAudio, sample_rate: u32) -> Result<MonoAudio, String> {
  if audio.sample_rate == sample_rate {
    return Ok(audio.clone());
  }
  // Resample in f64, the precision every other FFT in Azalea uses, so the binary carries a
  // single instantiation of rustfft.
  let samples: Vec<f64> = audio.samples.iter().map(|&s| f64::from(s)).collect();
  let frames = samples.len();
  let input = InterleavedSlice::new(&samples, 1, frames).map_err(|e| e.to_string())?;
  let mut resampler = Fft::<f64>::new(
    audio.sample_rate as usize,
    sample_rate as usize,
    1024,
    1,
    FixedSync::Input,
  )
  .map_err(|e| e.to_string())?;
  let output = resampler
    .process_all(&input, frames, None)
    .map_err(|e| e.to_string())?;
  Ok(MonoAudio {
    samples: output.take_data().into_iter().map(|s| s as f32).collect(),
    sample_rate,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sine(frequency: f32, sample_rate: u32, seconds: f32) -> Vec<f32> {
    let n = (seconds * sample_rate as f32) as usize;
    (0..n)
      .map(|i| (2.0 * std::f32::consts::PI * frequency * i as f32 / sample_rate as f32).sin() * 0.5)
      .collect()
  }

  fn write_wav(path: &Path, channels: u16, sample_rate: u32, samples: &[f32]) {
    let spec = hound::WavSpec {
      channels,
      sample_rate,
      bits_per_sample: 16,
      sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).unwrap();
    for sample in samples {
      writer
        .write_sample((sample * 32767.0).round() as i16)
        .unwrap();
    }
    writer.finalize().unwrap();
  }

  #[test]
  fn downmix_averages_channels() {
    assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), [0.5, 0.5]);
    assert_eq!(downmix(&[0.25, 0.75], 1), [0.25, 0.75]);
  }

  #[test]
  fn decodes_a_stereo_wav_to_mono() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("voice.wav");
    let tone = sine(440.0, 22050, 0.5);
    let interleaved: Vec<f32> = tone.iter().flat_map(|&s| [s, 0.0]).collect();
    write_wav(&path, 2, 22050, &interleaved);
    let audio = decode_file(&path).unwrap();
    assert_eq!(audio.sample_rate, 22050);
    assert_eq!(audio.samples.len(), tone.len());
    for (decoded, original) in audio.samples.iter().zip(&tone) {
      assert!((decoded - original / 2.0).abs() < 1e-3);
    }
  }

  #[test]
  fn rejects_unreadable_empty_and_overlong_files() {
    let directory = tempfile::tempdir().unwrap();
    assert!(decode_file(&directory.path().join("missing.wav")).is_err());
    let garbage = directory.path().join("garbage.wav");
    std::fs::write(&garbage, b"definitely not audio").unwrap();
    assert!(decode_file(&garbage).is_err());
    let empty = directory.path().join("empty.wav");
    write_wav(&empty, 1, 16000, &[]);
    assert!(decode_file(&empty).is_err());
    let long = directory.path().join("long.wav");
    write_wav(&long, 1, 8000, &vec![0.0; 8000 * 61]);
    assert!(decode_file(&long).unwrap_err().contains("60 seconds"));
  }

  #[test]
  fn resampling_keeps_duration_and_frequency() {
    let audio = MonoAudio {
      samples: sine(440.0, 48000, 1.0),
      sample_rate: 48000,
    };
    let resampled = resample(&audio, 16000).unwrap();
    assert_eq!(resampled.sample_rate, 16000);
    assert!((resampled.samples.len() as i64 - 16000).abs() <= 16);
    // Zero crossings of a 440 Hz tone: about 880 per second.
    let crossings = resampled
      .samples
      .windows(2)
      .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
      .count();
    assert!((crossings as i64 - 880).abs() <= 4, "{crossings}");
    assert_eq!(resample(&resampled, 16000).unwrap(), resampled);
  }
}
