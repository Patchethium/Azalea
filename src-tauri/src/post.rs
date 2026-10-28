//! Post-processing: frame-level f0 edits and time edits applied to a synthesized waveform.
//!
//! The base waveform is analyzed once with WORLD (Harvest, CheapTrick, D4C) at 1 ms frames.
//! Edits and the editor's view use 5 ms frames, every fifth analysis frame; an edit replaces
//! the f0 of some of them, is interpolated onto the analysis frames, and WORLD resynthesizes the
//! block with the edited contour. Only the edited frames, plus a short margin, are crossfaded
//! into the original waveform. Time anchors then warp the result with WSOLA
//! ([`crate::audio::stretch`]). Both stages keep untouched audio bit-exact. f0 edits are
//! defined on the base waveform's timeline, so they follow the sounds they were drawn on when
//! the timing changes.

use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};

use base64::Engine;
use rustfft::{num_complex::Complex, FftPlanner};
use tokio::sync::OnceCell;
use voicevox_core::StyleId;

use crate::audio::stretch::{smooth_mask, time_warp, TimeMap};
use crate::audio::world::{self, F0Range, WorldFeatures, FRAME_PERIOD_MS};
use crate::config::range::PitchRange;

/// Frame period of post edits and of the analysis shown in the editor. Edits are stored per
/// frame, so changing it invalidates them.
pub const EDIT_FRAME_PERIOD_MS: f64 = 5.0;
/// Analysis frames per edit frame; edit frame `k` is analysis frame `k * EDIT_STRIDE`.
const EDIT_STRIDE: usize = (EDIT_FRAME_PERIOD_MS / FRAME_PERIOD_MS) as usize;
const _: () = assert!(EDIT_STRIDE as f64 * FRAME_PERIOD_MS == EDIT_FRAME_PERIOD_MS);

/// Audio around edited frames that is also taken from WORLD, before crossfading.
const SPLICE_MARGIN_SECONDS: f64 = 0.02;
/// Raised-cosine crossfade length between WORLD and the original waveform.
const SPLICE_FADE_SECONDS: f64 = 0.015;
/// How far beyond the style's typical pitch range Harvest searches, in octaves.
const F0_RANGE_RELAX_OCTAVES: f64 = 0.5;
const F0_FLOOR_LIMITS: (f64, f64) = (40.0, 400.0);
const F0_CEIL_LIMIT: f64 = 1600.0;
/// Upper bound on edited frames, about 80 minutes at 5 ms.
const MAX_EDIT_FRAMES: usize = 1_000_000;
const MAX_TIME_ANCHORS: usize = 100_000;
/// How far a span between time anchors may be squeezed or stretched.
pub const MIN_TIME_RATE: f64 = 0.25;
pub const MAX_TIME_RATE: f64 = 4.0;

/// Log-frequency spectrogram shown behind the f0 editor.
const DISPLAY_ROWS: usize = 160;
const DISPLAY_MIN_HZ: f64 = 40.0;
const DISPLAY_MAX_HZ: f64 = 1600.0;
const DISPLAY_RANGE_DB: f64 = 80.0;

const FEATURE_CACHE_SIZE: usize = 4;
const RENDER_CACHE_SIZE: usize = 16;

/// A run of consecutive edited frames, starting at frame `start`.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
pub struct PostF0Segment {
  pub start: u32,
  /// Edited f0 in Hz, one value per frame.
  pub f0: Vec<f32>,
}

/// A time anchor: the point at `source` seconds of the synthesized waveform plays at `target`
/// seconds of the output. Time between anchors (and from the start to the first one) is
/// stretched or squeezed linearly; after the last anchor it keeps that anchor's offset.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
pub struct PostTimeAnchor {
  pub source: f64,
  pub target: f64,
}

/// Post-processing edits for one block. `base` fingerprints the synthesized content the edits
/// were made on; the frontend drops edits whose base no longer matches.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
pub struct PostEdit {
  pub base: String,
  /// Edited f0 runs, on the frames of the synthesized waveform.
  pub f0: Vec<PostF0Segment>,
  /// Time anchors, ordered by both `source` and `target`.
  pub time: Vec<PostTimeAnchor>,
}

impl PostEdit {
  pub fn is_empty(&self) -> bool {
    self.f0.is_empty() && self.time.is_empty()
  }

  pub fn validate(&self) -> Result<(), String> {
    if self.base.trim().is_empty() {
      return Err("Post edit has an empty base fingerprint".into());
    }
    if self.time.len() > MAX_TIME_ANCHORS {
      return Err("Post edit has too many time anchors".into());
    }
    let mut previous = (0.0, 0.0);
    for (index, anchor) in self.time.iter().enumerate() {
      if !anchor.source.is_finite() || !anchor.target.is_finite() {
        return Err(format!("Post time anchor {index} is not finite"));
      }
      let source_span = anchor.source - previous.0;
      let target_span = anchor.target - previous.1;
      if source_span <= 0.0 || target_span <= 0.0 {
        return Err(format!("Post time anchor {index} is out of order"));
      }
      let rate = target_span / source_span;
      // A little slack for rounding in the frontend's clamping.
      if !(MIN_TIME_RATE * 0.999..=MAX_TIME_RATE * 1.001).contains(&rate) {
        return Err(format!(
          "Post time anchor {index} stretches time by {rate:.3}×"
        ));
      }
      previous = (anchor.source, anchor.target);
    }
    let mut next_free = 0usize;
    let mut frames = 0usize;
    for (index, segment) in self.f0.iter().enumerate() {
      let start = segment.start as usize;
      if segment.f0.is_empty() {
        return Err(format!("Post edit segment {index} is empty"));
      }
      if start < next_free {
        return Err(format!(
          "Post edit segment {index} overlaps or is out of order"
        ));
      }
      if segment
        .f0
        .iter()
        .any(|value| !value.is_finite() || *value < 0.0)
      {
        return Err(format!("Post edit segment {index} has an invalid f0 value"));
      }
      frames += segment.f0.len();
      if frames > MAX_EDIT_FRAMES {
        return Err("Post edit is too long".into());
      }
      next_free = start + segment.f0.len();
    }
    Ok(())
  }

  /// The analyzed contour with the edits applied, and which frames were edited, both on edit
  /// frames.
  fn contour(&self, analyzed: &[f64]) -> Result<(Vec<f64>, Vec<bool>), String> {
    self.validate()?;
    let mut f0 = analyzed.to_vec();
    let mut edited = vec![false; analyzed.len()];
    for segment in &self.f0 {
      let start = segment.start as usize;
      let end = start + segment.f0.len();
      if end > analyzed.len() {
        return Err("Post edit extends beyond the waveform".into());
      }
      for (offset, value) in segment.f0.iter().enumerate() {
        f0[start + offset] = f64::from(*value);
        edited[start + offset] = true;
      }
    }
    Ok((f0, edited))
  }

  /// The edit's time anchors as a map from the synthesized waveform to the output.
  pub fn time_map(&self) -> TimeMap {
    TimeMap::new(
      self
        .time
        .iter()
        .map(|anchor| (anchor.source, anchor.target)),
    )
  }
}

/// The f0 analysis shown in the post-processing tab.
#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct PostF0Analysis {
  pub frame_period_ms: f32,
  /// Analyzed f0 in Hz per frame; 0 is unvoiced.
  pub f0: Vec<f32>,
  pub f0_floor: f32,
  pub f0_ceil: f32,
  /// Waveform length in seconds.
  pub duration: f64,
  pub spectrogram: PostSpectrogram,
}

/// A log-frequency power spectrogram, one column per analysis frame.
#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct PostSpectrogram {
  pub rows: u32,
  pub min_hz: f32,
  pub max_hz: f32,
  /// Base64 of `frames × rows` bytes, frame-major, low frequencies first; 255 is the loudest
  /// value and 0 is 80 dB below it.
  pub data: String,
}

/// Harvest's search range for a style: its typical pitch range widened by half an octave.
pub fn f0_range(range: Option<&PitchRange>) -> F0Range {
  let Some(range) = range.filter(|range| range.min > 0.0 && range.max >= range.min) else {
    return F0Range::default();
  };
  let relax = 2f64.powf(F0_RANGE_RELAX_OCTAVES);
  let floor = (f64::from(range.min).exp() / relax).clamp(F0_FLOOR_LIMITS.0, F0_FLOOR_LIMITS.1);
  let ceil = (f64::from(range.max).exp() * relax).clamp(floor * 2.0, F0_CEIL_LIMIT);
  F0Range { floor, ceil }
}

/// 16-bit PCM WAV with a 44-byte header, as VOICEVOX Core writes it.
struct Wav<'a> {
  header: &'a [u8],
  sample_rate: u32,
  channels: usize,
  /// Samples per channel.
  channel_samples: Vec<Vec<f64>>,
}

impl<'a> Wav<'a> {
  fn parse(wav: &'a [u8]) -> Result<Self, String> {
    if wav.len() < 44 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" || &wav[36..40] != b"data"
    {
      return Err("Unsupported WAV layout".into());
    }
    let channels = usize::from(u16::from_le_bytes([wav[22], wav[23]]));
    let sample_rate = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
    let bits = u16::from_le_bytes([wav[34], wav[35]]);
    if bits != 16 || !matches!(channels, 1 | 2) || sample_rate == 0 {
      return Err("Unsupported WAV format".into());
    }
    let mut channel_samples = vec![Vec::new(); channels];
    for (index, frame) in wav[44..].chunks_exact(2).enumerate() {
      let sample = f64::from(i16::from_le_bytes([frame[0], frame[1]])) / 32768.0;
      channel_samples[index % channels].push(sample);
    }
    let length = channel_samples.iter().map(Vec::len).min().unwrap_or(0);
    channel_samples
      .iter_mut()
      .for_each(|samples| samples.truncate(length));
    Ok(Self {
      header: &wav[..44],
      sample_rate,
      channels,
      channel_samples,
    })
  }

  fn mono(&self) -> Vec<f64> {
    let length = self.channel_samples[0].len();
    (0..length)
      .map(|i| {
        self
          .channel_samples
          .iter()
          .map(|samples| samples[i])
          .sum::<f64>()
          / self.channels as f64
      })
      .collect()
  }

  /// Encodes channels of the same length and layout behind the original header.
  fn encode(&self, channel_samples: &[Vec<f64>]) -> Vec<u8> {
    let length = channel_samples[0].len();
    let mut wav = Vec::with_capacity(44 + length * self.channels * 2);
    wav.extend_from_slice(self.header);
    let data_size = (length * self.channels * 2) as u32;
    wav[4..8].copy_from_slice(&(36 + data_size).to_le_bytes());
    wav[40..44].copy_from_slice(&data_size.to_le_bytes());
    for i in 0..length {
      for samples in channel_samples {
        let value = (samples[i] * 32768.0).round().clamp(-32768.0, 32767.0) as i16;
        wav.extend_from_slice(&value.to_le_bytes());
      }
    }
    wav
  }
}

/// Carries an edit contour on edit frames onto the analysis frames.
///
/// Analysis frames nearest an edited edit frame are edited. Between two voiced edit frames
/// their f0 is interpolated linearly in log frequency; next to an unvoiced one it holds the
/// nearest edit frame's value, so voicing switches halfway instead of gliding toward 0 Hz.
/// Unedited analysis frames keep the analyzed 1 ms contour.
fn upsample_contour(
  analyzed: &[f64],
  edit_f0: &[f64],
  edit_edited: &[bool],
) -> (Vec<f64>, Vec<bool>) {
  let mut f0 = analyzed.to_vec();
  let mut edited = vec![false; analyzed.len()];
  if edit_f0.is_empty() {
    return (f0, edited);
  }
  let last = edit_f0.len() - 1;
  for (frame, (value, edited)) in f0.iter_mut().zip(&mut edited).enumerate() {
    let low = (frame / EDIT_STRIDE).min(last);
    let offset = frame - low * EDIT_STRIDE;
    let high = (low + 1).min(last);
    let nearest = if offset * 2 < EDIT_STRIDE { low } else { high };
    if !edit_edited[nearest] {
      continue;
    }
    *edited = true;
    let (a, b) = (edit_f0[low], edit_f0[high]);
    *value = if offset == 0 || a <= 0.0 || b <= 0.0 {
      edit_f0[nearest]
    } else {
      let t = offset as f64 / EDIT_STRIDE as f64;
      (a.ln() * (1.0 - t) + b.ln() * t).exp()
    };
  }
  (f0, edited)
}

/// Weight of the WORLD waveform per sample: 1 around edited frames, fading to 0 elsewhere.
fn splice_mask(edited: &[bool], sample_rate: u32, length: usize) -> Vec<f64> {
  let hop = f64::from(sample_rate) * FRAME_PERIOD_MS / 1000.0;
  let margin = (f64::from(sample_rate) * SPLICE_MARGIN_SECONDS) as usize;
  let fade = ((f64::from(sample_rate) * SPLICE_FADE_SECONDS) as usize).max(1);
  let mut hard = vec![0.0; length];
  let mut frame = 0;
  while frame < edited.len() {
    if !edited[frame] {
      frame += 1;
      continue;
    }
    let first = frame;
    while frame < edited.len() && edited[frame] {
      frame += 1;
    }
    // Frame `i` is centered at `i * hop`; cover half a hop on each side plus the margin.
    let start = ((first as f64 - 0.5) * hop).max(0.0) as usize;
    let end = (((frame as f64 - 0.5) * hop) as usize).min(length);
    hard[start.saturating_sub(margin)..(end + margin).min(length)].fill(1.0);
  }
  smooth_mask(&hard, fade)
}

/// Analysis of a base waveform: WORLD features plus the editor's display spectrogram.
pub struct PostAnalysisData {
  pub features: WorldFeatures,
  /// The analyzed f0 on edit frames: every `EDIT_STRIDE`th analysis frame.
  pub edit_f0: Vec<f64>,
  pub range: F0Range,
  pub spectrogram: Vec<u8>,
}

impl PostAnalysisData {
  pub fn compute(wav: &[u8], range: F0Range) -> Result<Self, String> {
    let parsed = Wav::parse(wav)?;
    let mono = parsed.mono();
    let features = world::analyze(&mono, parsed.sample_rate, range)?;
    let edit_f0: Vec<f64> = features.f0.iter().step_by(EDIT_STRIDE).copied().collect();
    let spectrogram = display_spectrogram(&mono, parsed.sample_rate, edit_f0.len());
    Ok(Self {
      features,
      edit_f0,
      range,
      spectrogram,
    })
  }

  pub fn summary(&self) -> PostF0Analysis {
    PostF0Analysis {
      frame_period_ms: EDIT_FRAME_PERIOD_MS as f32,
      f0: self.edit_f0.iter().map(|value| *value as f32).collect(),
      f0_floor: self.range.floor as f32,
      f0_ceil: self.range.ceil as f32,
      duration: self.features.sample_count as f64 / f64::from(self.features.sample_rate),
      spectrogram: PostSpectrogram {
        rows: DISPLAY_ROWS as u32,
        min_hz: DISPLAY_MIN_HZ as f32,
        max_hz: DISPLAY_MAX_HZ as f32,
        data: base64::engine::general_purpose::STANDARD.encode(&self.spectrogram),
      },
    }
  }

  /// Applies `edit` to `wav`, the waveform this analysis was made from: f0 edits with WORLD,
  /// then time anchors with WSOLA.
  pub fn render(&self, wav: &[u8], edit: &PostEdit) -> Result<Vec<u8>, String> {
    let parsed = Wav::parse(wav)?;
    if parsed.sample_rate != self.features.sample_rate
      || parsed.channel_samples[0].len() != self.features.sample_count
    {
      return Err("The waveform does not match its analysis".into());
    }
    let (edit_f0, edit_edited) = edit.contour(&self.edit_f0)?;
    let (f0, edited) = upsample_contour(&self.features.f0, &edit_f0, &edit_edited);
    let map = edit.time_map();
    let duration = self.features.sample_count as f64 / f64::from(parsed.sample_rate);
    if edit
      .time
      .last()
      .is_some_and(|anchor| anchor.source > duration)
    {
      return Err("Post time anchors extend beyond the waveform".into());
    }
    let pitch_edited = edited.contains(&true);
    if !pitch_edited && map.is_identity() {
      return Ok(wav.to_vec());
    }
    let mut channels = parsed.channel_samples.clone();
    if pitch_edited {
      let resynthesized = world::synthesize(&self.features, &f0)?;
      let mask = splice_mask(&edited, parsed.sample_rate, resynthesized.len());
      for samples in &mut channels {
        for ((sample, world), weight) in samples.iter_mut().zip(&resynthesized).zip(&mask) {
          *sample = *sample * (1.0 - weight) + world * weight;
        }
      }
    }
    let channels = time_warp(&channels, parsed.sample_rate, &map);
    Ok(parsed.encode(&channels))
  }
}

/// `frames × DISPLAY_ROWS` bytes of log-frequency power, aligned with the edit frames.
fn display_spectrogram(mono: &[f64], sample_rate: u32, frames: usize) -> Vec<u8> {
  // About 6 Hz bins, enough to separate low harmonics.
  let fft_size = (4096 * sample_rate as usize / 24_000)
    .next_power_of_two()
    .max(1024);
  let hop = f64::from(sample_rate) * EDIT_FRAME_PERIOD_MS / 1000.0;
  let fft = FftPlanner::<f64>::new().plan_fft_forward(fft_size);
  let window: Vec<f64> = (0..fft_size)
    .map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / fft_size as f64).cos())
    .collect();
  let bin_hz = f64::from(sample_rate) / fft_size as f64;
  let ratio = (DISPLAY_MAX_HZ / DISPLAY_MIN_HZ).ln();
  let row_bins: Vec<f64> = (0..DISPLAY_ROWS)
    .map(|row| DISPLAY_MIN_HZ * (ratio * row as f64 / (DISPLAY_ROWS - 1) as f64).exp() / bin_hz)
    .collect();
  let mut decibels = Vec::with_capacity(frames * DISPLAY_ROWS);
  let mut buffer = vec![Complex::new(0.0, 0.0); fft_size];
  for frame in 0..frames {
    let center = (frame as f64 * hop) as isize;
    for (i, value) in buffer.iter_mut().enumerate() {
      let index = center + i as isize - (fft_size / 2) as isize;
      let sample = usize::try_from(index)
        .ok()
        .and_then(|index| mono.get(index))
        .copied()
        .unwrap_or(0.0);
      *value = Complex::new(sample * window[i], 0.0);
    }
    fft.process(&mut buffer);
    for bin in &row_bins {
      let low = bin.floor() as usize;
      let t = bin - low as f64;
      let power = buffer[low].norm_sqr() * (1.0 - t) + buffer[low + 1].norm_sqr() * t;
      decibels.push(10.0 * (power + 1e-12).log10());
    }
  }
  let top = decibels.iter().copied().fold(f64::MIN, f64::max);
  decibels
    .into_iter()
    .map(|db| (((db - (top - DISPLAY_RANGE_DB)) / DISPLAY_RANGE_DB).clamp(0.0, 1.0) * 255.0) as u8)
    .collect()
}

/// Identifies a base waveform: the waveform cache key and its style.
pub type PostKey = (String, StyleId);

type AnalysisCell = Arc<OnceCell<Arc<PostAnalysisData>>>;

/// Caches analyses per base waveform and rendered waveforms per edit.
pub struct PostCache {
  analyses: Mutex<lru::LruCache<PostKey, AnalysisCell>>,
  renders: Mutex<lru::LruCache<(PostKey, String), Arc<Vec<u8>>>>,
}

impl Default for PostCache {
  fn default() -> Self {
    Self {
      analyses: Mutex::new(lru::LruCache::new(
        NonZeroUsize::new(FEATURE_CACHE_SIZE).expect("nonzero"),
      )),
      renders: Mutex::new(lru::LruCache::new(
        NonZeroUsize::new(RENDER_CACHE_SIZE).expect("nonzero"),
      )),
    }
  }
}

impl PostCache {
  pub fn clear(&self) {
    lock(&self.analyses).clear();
    lock(&self.renders).clear();
  }

  /// Analyzes `wav` once per key; concurrent callers share one analysis.
  pub async fn analysis(
    &self,
    key: &PostKey,
    wav: Vec<u8>,
    range: F0Range,
  ) -> Result<Arc<PostAnalysisData>, String> {
    let cell = lock(&self.analyses)
      .get_or_insert(key.clone(), || Arc::new(OnceCell::new()))
      .clone();
    cell
      .get_or_try_init(|| async move {
        tauri::async_runtime::spawn_blocking(move || PostAnalysisData::compute(&wav, range))
          .await
          .map_err(|e| format!("Post analysis task failed: {e}"))?
          .map(Arc::new)
      })
      .await
      .cloned()
  }

  /// The base waveform with `edit` applied.
  pub async fn render(
    &self,
    key: &PostKey,
    wav: Vec<u8>,
    edit: &PostEdit,
    range: F0Range,
  ) -> Result<Vec<u8>, String> {
    let edit_key = serde_json::to_string(edit).map_err(|e| e.to_string())?;
    let render_key = (key.clone(), edit_key);
    if let Some(rendered) = lock(&self.renders).get(&render_key) {
      return Ok(rendered.as_ref().clone());
    }
    let analysis = self.analysis(key, wav.clone(), range).await?;
    let edit = edit.clone();
    let rendered = tauri::async_runtime::spawn_blocking(move || analysis.render(&wav, &edit))
      .await
      .map_err(|e| format!("Post render task failed: {e}"))??;
    lock(&self.renders).put(render_key, Arc::new(rendered.clone()));
    Ok(rendered)
  }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
  mutex
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
  use super::*;

  const FS: u32 = 24_000;

  fn wav_from(channels: &[Vec<f64>]) -> Vec<u8> {
    let length = channels[0].len();
    let count = channels.len() as u16;
    let data_size = (length * channels.len() * 2) as u32;
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_size).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&count.to_le_bytes());
    wav.extend_from_slice(&FS.to_le_bytes());
    wav.extend_from_slice(&(FS * 2 * u32::from(count)).to_le_bytes());
    wav.extend_from_slice(&(2 * count).to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    for i in 0..length {
      for channel in channels {
        wav.extend_from_slice(&((channel[i] * 32767.0) as i16).to_le_bytes());
      }
    }
    wav
  }

  fn tone(seconds: f64, f0: f64) -> Vec<f64> {
    (0..(seconds * f64::from(FS)) as usize)
      .map(|i| {
        let phase = 2.0 * std::f64::consts::PI * f0 * i as f64 / f64::from(FS);
        (1..=6)
          .map(|h| (h as f64 * phase).sin() / h as f64)
          .sum::<f64>()
          * 0.2
      })
      .collect()
  }

  fn edit(segments: Vec<PostF0Segment>) -> PostEdit {
    PostEdit {
      base: "base".into(),
      f0: segments,
      time: vec![],
    }
  }

  fn timed(anchors: &[(f64, f64)]) -> PostEdit {
    PostEdit {
      time: anchors
        .iter()
        .map(|&(source, target)| PostTimeAnchor { source, target })
        .collect(),
      ..edit(vec![])
    }
  }

  fn segment(start: u32, f0: Vec<f32>) -> PostF0Segment {
    PostF0Segment { start, f0 }
  }

  #[test]
  fn validation_rejects_malformed_edits() {
    assert!(edit(vec![segment(0, vec![200.0]), segment(5, vec![210.0])])
      .validate()
      .is_ok());
    assert!(PostEdit {
      base: " ".into(),
      ..edit(vec![])
    }
    .validate()
    .is_err());
    assert!(edit(vec![]).is_empty());
    assert!(!timed(&[(0.1, 0.1)]).is_empty());
    assert!(edit(vec![segment(0, vec![])]).validate().is_err());
    assert!(edit(vec![segment(0, vec![f32::NAN])]).validate().is_err());
    assert!(edit(vec![segment(0, vec![-1.0])]).validate().is_err());
    assert!(edit(vec![
      segment(0, vec![200.0, 200.0]),
      segment(1, vec![200.0])
    ])
    .validate()
    .is_err());
    assert!(edit(vec![segment(5, vec![200.0]), segment(0, vec![200.0])])
      .validate()
      .is_err());
  }

  #[test]
  fn contour_overlays_segments_and_rejects_out_of_range_frames() {
    let analyzed = vec![100.0, 0.0, 100.0, 100.0];
    let (f0, edited) = edit(vec![segment(1, vec![150.0, 160.0])])
      .contour(&analyzed)
      .unwrap();
    assert_eq!(f0, vec![100.0, 150.0, 160.0, 100.0]);
    assert_eq!(edited, vec![false, true, true, false]);
    assert!(edit(vec![segment(3, vec![1.0, 1.0])])
      .contour(&analyzed)
      .is_err());
  }

  #[test]
  fn f0_range_relaxes_the_style_range_and_falls_back_without_one() {
    assert_eq!(f0_range(None), F0Range::default());
    let range = PitchRange {
      min: 200f32.ln(),
      max: 400f32.ln(),
      histogram_min: 0.0,
      histogram_max: 0.0,
      histogram: vec![],
    };
    let relaxed = f0_range(Some(&range));
    assert!((relaxed.floor - 200.0 / 2f64.sqrt()).abs() < 0.1);
    assert!((relaxed.ceil - 400.0 * 2f64.sqrt()).abs() < 0.1);
    let low = PitchRange {
      min: 50f32.ln(),
      max: 60f32.ln(),
      ..range
    };
    let clamped = f0_range(Some(&low));
    assert_eq!(clamped.floor, 40.0);
    assert!(clamped.ceil >= 80.0);
  }

  #[test]
  fn splice_mask_covers_edited_frames_and_fades_out() {
    // 24 samples per 1 ms analysis frame at 24 kHz.
    let mut edited = vec![false; 500];
    edited[200..250].fill(true);
    let length = 500 * 24;
    let mask = splice_mask(&edited, FS, length);
    assert_eq!(mask.len(), length);
    assert_eq!(mask[225 * 24], 1.0);
    assert_eq!(mask[0], 0.0);
    assert_eq!(mask[length - 1], 0.0);
    assert!(mask.windows(2).all(|w| (w[0] - w[1]).abs() < 0.01));
    assert!(splice_mask(&vec![false; 500], FS, length)
      .iter()
      .all(|v| *v == 0.0));
  }

  #[test]
  fn upsample_contour_interpolates_edits_and_keeps_the_analysis_elsewhere() {
    // Five analysis frames per edit frame: edit frames 0..=3 cover analysis frames 0..=19.
    let analyzed: Vec<f64> = (0..18).map(|i| 100.0 + i as f64).collect();
    let edit_f0 = vec![100.0, 200.0, 400.0, 0.0];
    let edit_edited = vec![false, true, true, true];
    let (f0, edited) = upsample_contour(&analyzed, &edit_f0, &edit_edited);
    assert_eq!(f0.len(), analyzed.len());
    // Frames nearest unedited edit frame 0 keep the 1 ms analysis.
    assert_eq!(&f0[..3], &analyzed[..3]);
    assert_eq!(&edited[..3], &[false; 3]);
    // From the halfway point toward edit frame 1, the edit ramps from the analysis on edit
    // frames in log frequency; it lands exactly on edit frames.
    assert!(edited[3..].iter().all(|edited| *edited));
    assert!((f0[3] - 100.0 * 2f64.powf(0.6)).abs() < 1e-9);
    assert_eq!(f0[5], 200.0);
    assert!((f0[7] - 200.0 * 2f64.powf(0.4)).abs() < 1e-9);
    assert_eq!(f0[10], 400.0);
    // Next to the unvoiced edit frame, voicing switches at the midpoint.
    assert_eq!(&f0[11..13], &[400.0, 400.0]);
    assert_eq!(&f0[13..], &[0.0; 5]);

    let (unchanged, none) = upsample_contour(&analyzed, &edit_f0, &[false; 4]);
    assert_eq!(unchanged, analyzed);
    assert!(none.iter().all(|edited| !edited));
  }

  #[test]
  fn render_keeps_unedited_audio_and_changes_edited_frames() {
    let samples = tone(0.6, 200.0);
    let wav = wav_from(&[samples.clone(), samples]);
    let analysis = PostAnalysisData::compute(&wav, F0Range::default()).unwrap();
    let summary = analysis.summary();
    assert_eq!(summary.frame_period_ms, 5.0);
    assert_eq!(summary.f0.len(), analysis.edit_f0.len());
    // Edit frames are every fifth 1 ms analysis frame, covering the whole waveform.
    assert_eq!(analysis.features.f0.len(), 601);
    assert_eq!(analysis.edit_f0.len(), 121);
    assert_eq!(analysis.edit_f0[7], analysis.features.f0[35]);
    assert_eq!(
      base64::engine::general_purpose::STANDARD
        .decode(&summary.spectrogram.data)
        .unwrap()
        .len(),
      summary.f0.len() * DISPLAY_ROWS
    );
    assert!((summary.duration - 0.6).abs() < 1e-3);

    assert_eq!(analysis.render(&wav, &edit(vec![])).unwrap(), wav);

    let frames: Vec<f32> = (60..80).map(|i| analysis.edit_f0[i] as f32 * 1.5).collect();
    let rendered = analysis
      .render(&wav, &edit(vec![segment(60, frames)]))
      .unwrap();
    assert_eq!(rendered.len(), wav.len());
    assert_eq!(rendered[..44], wav[..44]);
    // Far from the edit the original bytes are kept; inside it they change.
    assert_eq!(rendered[44..44 + 4 * 2400], wav[44..44 + 4 * 2400]);
    let inside = 44 + 4 * 70 * 120;
    assert_ne!(rendered[inside..inside + 400], wav[inside..inside + 400]);
    let parsed = Wav::parse(&rendered).unwrap();
    let left = &parsed.channel_samples[0];
    assert_eq!(left, &parsed.channel_samples[1]);
  }

  #[test]
  fn render_rejects_a_waveform_from_another_analysis() {
    let wav = wav_from(&[tone(0.6, 200.0)]);
    let other = wav_from(&[tone(0.5, 200.0)]);
    let analysis = PostAnalysisData::compute(&wav, F0Range::default()).unwrap();
    assert!(analysis
      .render(&other, &edit(vec![segment(0, vec![200.0])]))
      .is_err());
    assert!(Wav::parse(b"not a wav").is_err());
  }

  #[test]
  fn validation_checks_time_anchor_order_and_rates() {
    assert!(timed(&[(0.1, 0.2), (0.3, 0.3)]).validate().is_ok());
    assert!(timed(&[(0.1, 0.4)]).validate().is_ok());
    assert!(timed(&[(0.1, 0.025)]).validate().is_ok());
    // Out of order on either axis, or starting at zero.
    assert!(timed(&[(0.2, 0.2), (0.1, 0.3)]).validate().is_err());
    assert!(timed(&[(0.1, 0.2), (0.2, 0.2)]).validate().is_err());
    assert!(timed(&[(0.0, 0.1)]).validate().is_err());
    // Beyond the rate limits, or not finite.
    assert!(timed(&[(0.1, 0.5)]).validate().is_err());
    assert!(timed(&[(0.1, 0.02)]).validate().is_err());
    assert!(timed(&[(f64::NAN, 0.1)]).validate().is_err());
    assert_eq!(timed(&[(0.1, 0.2)]).time_map().to_target(0.3), 0.4);
  }

  #[test]
  fn render_warps_time_after_editing_pitch() {
    let wav = wav_from(&[tone(0.6, 200.0)]);
    let analysis = PostAnalysisData::compute(&wav, F0Range::default()).unwrap();
    // Identity anchors change nothing.
    assert_eq!(analysis.render(&wav, &timed(&[(0.3, 0.3)])).unwrap(), wav);

    let mut both = timed(&[(0.2, 0.2), (0.3, 0.4)]);
    both.f0 = vec![segment(
      60,
      (60..80).map(|i| analysis.edit_f0[i] as f32 * 1.5).collect(),
    )];
    let rendered = analysis.render(&wav, &both).unwrap();
    // 0.1 s longer, the WAV header updated to match.
    assert_eq!(rendered.len(), wav.len() + 2 * 2400);
    let parsed = Wav::parse(&rendered).unwrap();
    assert_eq!(parsed.channel_samples[0].len(), 14_400 + 2400);
    // The audio before the stretch and the pitch edit is untouched.
    assert_eq!(rendered[44..44 + 2 * 3000], wav[44..44 + 2 * 3000]);

    assert!(analysis
      .render(&wav, &timed(&[(0.7, 0.7)]))
      .unwrap_err()
      .contains("beyond the waveform"));
  }

  #[test]
  fn cache_shares_analyses_and_renders() {
    tauri::async_runtime::block_on(cache_shares_analyses_and_renders_async());
  }

  async fn cache_shares_analyses_and_renders_async() {
    let cache = PostCache::default();
    let wav = wav_from(&[tone(0.4, 200.0)]);
    let key: PostKey = ("query".into(), StyleId::new(1));
    let first = cache
      .analysis(&key, wav.clone(), F0Range::default())
      .await
      .unwrap();
    let second = cache
      .analysis(&key, wav.clone(), F0Range::default())
      .await
      .unwrap();
    assert!(Arc::ptr_eq(&first, &second));
    let change = edit(vec![segment(20, vec![300.0; 10])]);
    let rendered = cache
      .render(&key, wav.clone(), &change, F0Range::default())
      .await
      .unwrap();
    assert_ne!(rendered, wav);
    assert_eq!(
      cache
        .render(&key, wav, &change, F0Range::default())
        .await
        .unwrap(),
      rendered
    );
    cache.clear();
    assert!(lock(&cache.renders).is_empty());
    assert!(lock(&cache.analyses).is_empty());
  }
}
