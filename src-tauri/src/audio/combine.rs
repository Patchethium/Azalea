//! Concatenates per-block WAV files into one combined WAV.
//!
//! Each block's leading and trailing silence is already part of its
//! synthesized waveform (VOICEVOX renders the query's pre- and post-phoneme
//! lengths), so blocks are joined back to back without adding extra gaps.

use std::io::Cursor;

/// A combined waveform and where each input begins within it.
#[derive(Debug)]
pub struct CombinedWav {
  /// The encoded 16-bit PCM WAV file.
  pub wav: Vec<u8>,
  /// The start time of each input waveform in seconds, in input order.
  pub offsets_seconds: Vec<f64>,
}

/// Converts one interleaved frame between channel counts: mono is duplicated
/// to every output channel and other layouts are averaged down to mono first.
fn convert_frame(frame: &[i16], channels: usize, out: &mut Vec<i16>) {
  if frame.len() == channels {
    out.extend_from_slice(frame);
    return;
  }
  let mono = if frame.len() == 1 {
    frame[0]
  } else {
    let sum: i32 = frame.iter().map(|sample| i32::from(*sample)).sum();
    (sum / frame.len() as i32) as i16
  };
  out.extend(std::iter::repeat_n(mono, channels));
}

/// Joins `wavs` in order into a single WAV using the first waveform's sample
/// rate and channel count. Waveforms with a different channel count are
/// up- or downmixed; a different sample rate is rejected because resampling
/// is not supported. Only 16-bit integer PCM input is accepted, which is what
/// VOICEVOX Core produces.
pub fn concatenate_wavs(wavs: &[Vec<u8>]) -> Result<CombinedWav, String> {
  let mut spec: Option<hound::WavSpec> = None;
  let mut samples: Vec<i16> = Vec::new();
  let mut offsets_seconds = Vec::with_capacity(wavs.len());
  for (index, wav) in wavs.iter().enumerate() {
    let reader = hound::WavReader::new(Cursor::new(wav))
      .map_err(|e| format!("Failed to decode audio for block {}: {e}", index + 1))?;
    let input = reader.spec();
    if input.sample_format != hound::SampleFormat::Int || input.bits_per_sample != 16 {
      return Err(format!(
        "Block {} is not 16-bit PCM audio and cannot be combined",
        index + 1
      ));
    }
    if input.channels == 0 {
      return Err(format!("Block {} has no audio channels", index + 1));
    }
    let output = *spec.get_or_insert(input);
    if input.sample_rate != output.sample_rate {
      return Err(format!(
        "Block {} uses a {} Hz sample rate, but the combined file uses {} Hz; \
         blocks with different sample rates cannot be combined",
        index + 1,
        input.sample_rate,
        output.sample_rate
      ));
    }
    let channels = usize::from(output.channels);
    offsets_seconds.push((samples.len() / channels) as f64 / f64::from(output.sample_rate));
    let decoded = reader
      .into_samples::<i16>()
      .collect::<Result<Vec<_>, _>>()
      .map_err(|e| format!("Failed to decode audio for block {}: {e}", index + 1))?;
    for frame in decoded.chunks(usize::from(input.channels)) {
      convert_frame(frame, channels, &mut samples);
    }
  }
  let spec = spec.ok_or("There is no audio to combine")?;

  let mut cursor = Cursor::new(Vec::new());
  {
    let mut writer = hound::WavWriter::new(&mut cursor, spec).map_err(|e| e.to_string())?;
    for sample in samples {
      writer.write_sample(sample).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
  }
  Ok(CombinedWav {
    wav: cursor.into_inner(),
    offsets_seconds,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn wav(channels: u16, sample_rate: u32, frames: &[i16]) -> Vec<u8> {
    let mut cursor = Cursor::new(Vec::new());
    {
      let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
      };
      let mut writer = hound::WavWriter::new(&mut cursor, spec).unwrap();
      for sample in frames {
        writer.write_sample(*sample).unwrap();
      }
      writer.finalize().unwrap();
    }
    cursor.into_inner()
  }

  fn decode(wav: &[u8]) -> (hound::WavSpec, Vec<i16>) {
    let reader = hound::WavReader::new(Cursor::new(wav)).unwrap();
    let spec = reader.spec();
    (
      spec,
      reader.into_samples::<i16>().map(Result::unwrap).collect(),
    )
  }

  #[test]
  fn concatenation_keeps_each_blocks_silence_without_adding_gaps() {
    // Leading and trailing zeros stand in for configured block silence.
    let first = wav(1, 10, &[0, 0, 5, 6, 0]);
    let second = wav(1, 10, &[0, 7, 0, 0]);
    let combined = concatenate_wavs(&[first, second]).unwrap();
    let (spec, samples) = decode(&combined.wav);
    assert_eq!(spec.channels, 1);
    assert_eq!(spec.sample_rate, 10);
    assert_eq!(samples, vec![0, 0, 5, 6, 0, 0, 7, 0, 0]);
    assert_eq!(combined.offsets_seconds, vec![0.0, 0.5]);
  }

  #[test]
  fn concatenation_converts_channel_counts_to_the_first_block() {
    let mono_first = concatenate_wavs(&[wav(1, 8, &[1, 2]), wav(2, 8, &[10, 20, -4, 4])]).unwrap();
    let (spec, samples) = decode(&mono_first.wav);
    assert_eq!(spec.channels, 1);
    assert_eq!(samples, vec![1, 2, 15, 0]);
    assert_eq!(mono_first.offsets_seconds, vec![0.0, 0.25]);

    let stereo_first = concatenate_wavs(&[wav(2, 8, &[1, 2]), wav(1, 8, &[3, 4])]).unwrap();
    let (spec, samples) = decode(&stereo_first.wav);
    assert_eq!(spec.channels, 2);
    assert_eq!(samples, vec![1, 2, 3, 3, 4, 4]);
    assert_eq!(stereo_first.offsets_seconds, vec![0.0, 0.125]);
  }

  #[test]
  fn concatenation_rejects_mismatched_sample_rates_and_invalid_input() {
    let error = concatenate_wavs(&[wav(1, 24_000, &[0]), wav(1, 48_000, &[0])]).unwrap_err();
    assert!(error.contains("Block 2"), "{error}");
    assert!(error.contains("48000 Hz"), "{error}");

    let error = concatenate_wavs(&[b"not a wav".to_vec()]).unwrap_err();
    assert!(error.contains("block 1"), "{error}");

    assert_eq!(
      concatenate_wavs(&[]).unwrap_err(),
      "There is no audio to combine"
    );

    let mut cursor = Cursor::new(Vec::new());
    {
      let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 8,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
      };
      let mut writer = hound::WavWriter::new(&mut cursor, spec).unwrap();
      writer.write_sample(0.5f32).unwrap();
      writer.finalize().unwrap();
    }
    let error = concatenate_wavs(&[cursor.into_inner()]).unwrap_err();
    assert!(error.contains("16-bit PCM"), "{error}");
  }
}
