//! A very simple mel spectrogram implementation
//! used for users to refer how the audio looks like in frequency domain
use ndarray::{s, Array1, Array2, Axis};
use rayon::prelude::*;
use rustfft::num_complex::Complex;
use rustfft::FftPlanner;

pub struct MelSpec {
  fft_planner: FftPlanner<f64>,
  n_fft: usize,
  hop_length: usize,
  window: Array1<f64>,
  filterbank: Array2<f64>,
}

impl MelSpec {
  pub fn new(n_fft: usize, n_mels: usize, hop_length: usize, sample_rate: usize) -> Self {
    Self {
      fft_planner: FftPlanner::new(),
      n_fft,
      hop_length,
      window: Self::hanning(n_fft),
      filterbank: Self::mel_filter_bank(n_mels, n_fft, sample_rate),
    }
  }

  fn hanning(size: usize) -> Array1<f64> {
    Array1::from_iter(
      (0..size)
        .map(|n| 0.5 * (1.0 - (2.0 * std::f64::consts::PI * n as f64 / (size - 1) as f64).cos())),
    )
  }
  /// O'Shaughnessy, D. (1987)
  /// $m = 2595 \log_{10}(1 + \frac{f}{700})$
  fn hz2mel(f: f64) -> f64 {
    (1. + f / 700.).log10() * 2595.
  }

  fn mel2hz(m: f64) -> f64 {
    700. * (10f64.powf(m / 2595.) - 1.)
  }

  /// Mel filter bank
  fn mel_filter_bank(n_filters: usize, n_fft: usize, sample_rate: usize) -> Array2<f64> {
    let nyquist = sample_rate as f64 / 2.;
    let mel_low = Self::hz2mel(0.);
    let mel_high = Self::hz2mel(nyquist);
    let mel_points = Array1::linspace(mel_low, mel_high, n_filters + 2);
    let hz_points = mel_points.mapv(Self::mel2hz);
    let bins: Array1<f64> = hz_points.mapv(|hz| (n_fft as f64 + 1.) * hz / sample_rate as f64);
    let mut filterbank = Array2::zeros((n_filters, n_fft / 2 + 1));

    // triangular filter
    for i in 0..n_filters {
      for j in 0..(n_fft / 2 + 1) {
        let freq = j as f64;
        if freq >= bins[i] && freq <= bins[i + 1] {
          filterbank[[i, j]] = (freq - bins[i]) / (bins[i + 1] - bins[i]);
        } else if freq >= bins[i + 1] && freq <= bins[i + 2] {
          filterbank[[i, j]] = (bins[i + 2] - freq) / (bins[i + 2] - bins[i + 1]);
        }
      }
    }

    // normalize
    for i in 0..n_filters {
      let sum = filterbank.row(i).sum();
      filterbank.row_mut(i).mapv_inplace(|x| x / sum);
    }

    filterbank
  }

  fn spectrogram(&mut self, signal: Array1<f64>) -> Array2<f64> {
    let fft = self.fft_planner.plan_fft_forward(self.n_fft);

    let n_samples = signal.len();
    // Keep one zero-padded frame for short clips. Apart from avoiding an
    // underflow here, this lets the preview represent very short utterances.
    let remaining = n_samples.saturating_sub(self.n_fft);
    let n_frames = remaining.saturating_add(self.hop_length - 1) / self.hop_length + 1;
    let mut spec = Array2::zeros((self.n_fft / 2 + 1, n_frames));

    let n_fft = self.n_fft;
    let hop_length = self.hop_length;
    let window = &self.window;
    spec
      .axis_iter_mut(Axis(1))
      .into_par_iter()
      .enumerate()
      .for_each(|(i, mut output)| {
        let start = i * hop_length;
        let end = (start + n_fft).min(n_samples);
        let frame = signal.slice(s![start..end]);
        let mut windowed = vec![Complex::new(0., 0.); n_fft];
        for ((sample, window), output) in frame.iter().zip(window.iter()).zip(windowed.iter_mut()) {
          output.re = sample * window;
        }

        fft.process(&mut windowed);

        // compute power spectrum
        for (j, complex_val) in windowed.iter().take(n_fft / 2 + 1).enumerate() {
          output[j] = (complex_val.norm() / n_fft as f64).powi(2);
        }
      });
    spec
  }

  fn amp2db(amp: f64) -> f64 {
    10. * amp.max(f64::MIN_POSITIVE).log10()
  }

  pub fn process(&mut self, signal: Array1<f64>) -> Array2<f64> {
    let spec = self.spectrogram(signal);
    let n_mels = self.filterbank.nrows();
    let n_frames = spec.ncols();
    let mut mel_spec = Array2::zeros((n_mels, n_frames));
    let filterbank = &self.filterbank;

    mel_spec
      .axis_iter_mut(Axis(1))
      .into_par_iter()
      .enumerate()
      .for_each(|(frame, mut output)| {
        let spectrum = spec.column(frame);
        for (mel, filter) in filterbank.axis_iter(Axis(0)).enumerate() {
          output[mel] = Self::amp2db(filter.dot(&spectrum));
        }
      });

    mel_spec
  }
}
