//! Safe bindings to the vendored WORLD vocoder (`third_party/world`), compiled by `build.rs`.
//!
//! Only the pieces the post-processing tab needs are bound: Harvest f0 estimation, CheapTrick
//! spectral envelopes, D4C aperiodicity and Synthesis. The C++ code has no input validation, so
//! every entry point here checks its arguments before crossing the FFI boundary.

use std::os::raw::{c_double, c_int};

/// Analysis frame period. Edits are stored per frame, so changing it invalidates them.
pub const FRAME_PERIOD_MS: f64 = 5.0;
/// CheapTrick's default lowest f0; analyses with a lower floor use a larger FFT.
const CHEAPTRICK_F0_FLOOR: f64 = 71.0;
/// Harvest needs a few periods of the lowest f0 to analyze anything.
const MIN_SAMPLES: usize = 1024;

mod ffi {
  use super::{c_double, c_int};

  #[repr(C)]
  pub struct HarvestOption {
    pub f0_floor: c_double,
    pub f0_ceil: c_double,
    pub frame_period: c_double,
  }

  #[repr(C)]
  pub struct CheapTrickOption {
    pub q1: c_double,
    pub f0_floor: c_double,
    pub fft_size: c_int,
  }

  #[repr(C)]
  pub struct D4COption {
    pub threshold: c_double,
  }

  extern "C" {
    pub fn InitializeHarvestOption(option: *mut HarvestOption);
    pub fn GetSamplesForHarvest(fs: c_int, x_length: c_int, frame_period: c_double) -> c_int;
    pub fn Harvest(
      x: *const c_double,
      x_length: c_int,
      fs: c_int,
      option: *const HarvestOption,
      temporal_positions: *mut c_double,
      f0: *mut c_double,
    );
    pub fn InitializeCheapTrickOption(fs: c_int, option: *mut CheapTrickOption);
    pub fn GetFFTSizeForCheapTrick(fs: c_int, option: *const CheapTrickOption) -> c_int;
    pub fn CheapTrick(
      x: *const c_double,
      x_length: c_int,
      fs: c_int,
      temporal_positions: *const c_double,
      f0: *const c_double,
      f0_length: c_int,
      option: *const CheapTrickOption,
      spectrogram: *mut *mut c_double,
    );
    pub fn InitializeD4COption(option: *mut D4COption);
    pub fn D4C(
      x: *const c_double,
      x_length: c_int,
      fs: c_int,
      temporal_positions: *const c_double,
      f0: *const c_double,
      f0_length: c_int,
      fft_size: c_int,
      option: *const D4COption,
      aperiodicity: *mut *mut c_double,
    );
    pub fn Synthesis(
      f0: *const c_double,
      f0_length: c_int,
      spectrogram: *const *const c_double,
      aperiodicity: *const *const c_double,
      fft_size: c_int,
      frame_period: c_double,
      fs: c_int,
      y_length: c_int,
      y: *mut c_double,
    );
  }
}

/// The f0 search range for Harvest, in Hz.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct F0Range {
  pub floor: f64,
  pub ceil: f64,
}

impl Default for F0Range {
  /// WORLD's own defaults.
  fn default() -> Self {
    Self {
      floor: 71.0,
      ceil: 800.0,
    }
  }
}

/// A waveform decomposed by WORLD: one f0, envelope and aperiodicity row per frame.
pub struct WorldFeatures {
  pub sample_rate: u32,
  pub sample_count: usize,
  pub f0: Vec<f64>,
  pub spectrogram: Vec<Vec<f64>>,
  pub aperiodicity: Vec<Vec<f64>>,
  pub fft_size: usize,
}

fn ffi_int(value: usize, what: &str) -> Result<c_int, String> {
  c_int::try_from(value).map_err(|_| format!("{what} is too large for WORLD"))
}

fn row_pointers(rows: &mut [Vec<f64>]) -> Vec<*mut c_double> {
  rows.iter_mut().map(|row| row.as_mut_ptr()).collect()
}

/// Estimates f0 with Harvest and the spectral envelope and aperiodicity at those frames.
pub fn analyze(x: &[f64], sample_rate: u32, range: F0Range) -> Result<WorldFeatures, String> {
  if x.len() < MIN_SAMPLES {
    return Err("The waveform is too short to analyze".into());
  }
  if x.iter().any(|sample| !sample.is_finite()) {
    return Err("The waveform contains non-finite samples".into());
  }
  if !(range.floor.is_finite() && range.ceil.is_finite())
    || range.floor < 10.0
    || range.ceil <= range.floor
    || range.ceil >= f64::from(sample_rate) / 2.0
  {
    return Err(format!("Invalid f0 range {range:?}"));
  }
  let fs = ffi_int(sample_rate as usize, "The sample rate")?;
  let x_length = ffi_int(x.len(), "The waveform length")?;

  // SAFETY: every option struct is initialized by WORLD before use, buffers are sized from
  // WORLD's own length functions, and all pointers outlive the calls.
  unsafe {
    let mut harvest = std::mem::zeroed::<ffi::HarvestOption>();
    ffi::InitializeHarvestOption(&mut harvest);
    harvest.f0_floor = range.floor;
    harvest.f0_ceil = range.ceil;
    harvest.frame_period = FRAME_PERIOD_MS;
    let frames = ffi::GetSamplesForHarvest(fs, x_length, FRAME_PERIOD_MS);
    let frame_count = usize::try_from(frames).map_err(|_| "Invalid frame count")?;
    let mut temporal_positions = vec![0.0; frame_count];
    let mut f0 = vec![0.0; frame_count];
    ffi::Harvest(
      x.as_ptr(),
      x_length,
      fs,
      &harvest,
      temporal_positions.as_mut_ptr(),
      f0.as_mut_ptr(),
    );

    let mut cheaptrick = std::mem::zeroed::<ffi::CheapTrickOption>();
    ffi::InitializeCheapTrickOption(fs, &mut cheaptrick);
    // Frames below CheapTrick's floor are treated as unvoiced, so follow a lower search floor.
    cheaptrick.f0_floor = range.floor.min(CHEAPTRICK_F0_FLOOR);
    cheaptrick.fft_size = ffi::GetFFTSizeForCheapTrick(fs, &cheaptrick);
    let fft_size = usize::try_from(cheaptrick.fft_size).map_err(|_| "Invalid FFT size")?;
    let bins = fft_size / 2 + 1;
    let mut spectrogram = vec![vec![0.0; bins]; frame_count];
    let mut rows = row_pointers(&mut spectrogram);
    ffi::CheapTrick(
      x.as_ptr(),
      x_length,
      fs,
      temporal_positions.as_ptr(),
      f0.as_ptr(),
      frames,
      &cheaptrick,
      rows.as_mut_ptr(),
    );

    let mut d4c = std::mem::zeroed::<ffi::D4COption>();
    ffi::InitializeD4COption(&mut d4c);
    let mut aperiodicity = vec![vec![0.0; bins]; frame_count];
    let mut rows = row_pointers(&mut aperiodicity);
    ffi::D4C(
      x.as_ptr(),
      x_length,
      fs,
      temporal_positions.as_ptr(),
      f0.as_ptr(),
      frames,
      cheaptrick.fft_size,
      &d4c,
      rows.as_mut_ptr(),
    );

    Ok(WorldFeatures {
      sample_rate,
      sample_count: x.len(),
      f0,
      spectrogram,
      aperiodicity,
      fft_size,
    })
  }
}

/// Resynthesizes the analyzed waveform with `f0` in place of the analyzed contour.
pub fn synthesize(features: &WorldFeatures, f0: &[f64]) -> Result<Vec<f64>, String> {
  if f0.len() != features.f0.len() {
    return Err("The f0 contour does not match the analysis".into());
  }
  if f0.iter().any(|value| !value.is_finite() || *value < 0.0) {
    return Err("f0 values must be finite and nonnegative".into());
  }
  let bins = features.fft_size / 2 + 1;
  if features.spectrogram.len() != f0.len()
    || features.aperiodicity.len() != f0.len()
    || features
      .spectrogram
      .iter()
      .chain(&features.aperiodicity)
      .any(|row| row.len() != bins)
  {
    return Err("Malformed WORLD features".into());
  }
  let fs = ffi_int(features.sample_rate as usize, "The sample rate")?;
  let f0_length = ffi_int(f0.len(), "The f0 length")?;
  let fft_size = ffi_int(features.fft_size, "The FFT size")?;
  let y_length = ffi_int(features.sample_count, "The waveform length")?;
  let spectrogram: Vec<*const c_double> = features
    .spectrogram
    .iter()
    .map(|row| row.as_ptr())
    .collect();
  let aperiodicity: Vec<*const c_double> = features
    .aperiodicity
    .iter()
    .map(|row| row.as_ptr())
    .collect();
  let mut y = vec![0.0; features.sample_count];
  // SAFETY: the shapes were checked above and `y` has room for `y_length` samples.
  unsafe {
    ffi::Synthesis(
      f0.as_ptr(),
      f0_length,
      spectrogram.as_ptr(),
      aperiodicity.as_ptr(),
      fft_size,
      FRAME_PERIOD_MS,
      fs,
      y_length,
      y.as_mut_ptr(),
    );
  }
  Ok(y)
}

#[cfg(test)]
mod tests {
  use super::*;

  const FS: u32 = 24_000;

  /// A harmonic tone whose f0 follows `f0_at`, like a voiced vowel.
  fn tone(seconds: f64, f0_at: impl Fn(f64) -> f64) -> Vec<f64> {
    let n = (seconds * f64::from(FS)) as usize;
    let mut phase = 0.0;
    (0..n)
      .map(|i| {
        let t = i as f64 / f64::from(FS);
        phase += 2.0 * std::f64::consts::PI * f0_at(t) / f64::from(FS);
        (1..=8)
          .map(|h| (h as f64 * phase).sin() / h as f64)
          .sum::<f64>()
          * 0.2
      })
      .collect()
  }

  fn voiced_median(f0: &[f64]) -> f64 {
    let mut voiced: Vec<f64> = f0.iter().copied().filter(|v| *v > 0.0).collect();
    voiced.sort_by(f64::total_cmp);
    voiced[voiced.len() / 2]
  }

  #[test]
  fn harvest_finds_a_steady_tone() {
    let features = analyze(&tone(0.6, |_| 200.0), FS, F0Range::default()).unwrap();
    assert_eq!(features.f0.len(), (600.0 / FRAME_PERIOD_MS) as usize + 1);
    assert!((voiced_median(&features.f0) - 200.0).abs() < 2.0);
    assert_eq!(features.fft_size, 1024);
    assert!(features
      .spectrogram
      .iter()
      .all(|row| row.len() == 513 && row.iter().all(|v| v.is_finite())));
  }

  #[test]
  fn resynthesis_follows_a_shifted_contour() {
    let features = analyze(&tone(0.6, |_| 200.0), FS, F0Range::default()).unwrap();
    let raised: Vec<f64> = features.f0.iter().map(|f| f * 1.5).collect();
    let y = synthesize(&features, &raised).unwrap();
    assert_eq!(y.len(), features.sample_count);
    let reanalyzed = analyze(&y, FS, F0Range::default()).unwrap();
    assert!((voiced_median(&reanalyzed.f0) - 300.0).abs() < 6.0);
  }

  #[test]
  fn a_low_floor_widens_the_envelope_fft() {
    let range = F0Range {
      floor: 40.0,
      ceil: 400.0,
    };
    let features = analyze(&tone(0.6, |_| 60.0), FS, range).unwrap();
    assert_eq!(features.fft_size, 2048);
    assert!((voiced_median(&features.f0) - 60.0).abs() < 2.0);
  }

  #[test]
  fn invalid_inputs_are_rejected_before_reaching_world() {
    assert!(analyze(&[0.0; 100], FS, F0Range::default()).is_err());
    assert!(analyze(&[f64::NAN; 4096], FS, F0Range::default()).is_err());
    let backwards = F0Range {
      floor: 400.0,
      ceil: 100.0,
    };
    assert!(analyze(&tone(0.3, |_| 200.0), FS, backwards).is_err());
    let features = analyze(&tone(0.3, |_| 200.0), FS, F0Range::default()).unwrap();
    assert!(synthesize(&features, &[200.0]).is_err());
    let mut negative = features.f0.clone();
    negative[0] = -1.0;
    assert!(synthesize(&features, &negative).is_err());
  }
}
