//! The pydomino aligner: its phoneme-transition model (downloaded as
//! [`ExtraPack::DominoModel`](crate::commands::ExtraPack)) run on the VOICEVOX
//! ONNX Runtime the core loaded, with pydomino's tokenizer and Viterbi decoder
//! ported to Rust.
//!
//! The model takes the 16 kHz waveform and computes its own features. For
//! every 10 ms frame it returns the log-probability of each phoneme
//! transition and of no transition (blank).

mod tokenizer;
mod viterbi;

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use ort::session::Session;
use ort::value::Tensor;

use crate::config::manager::domino_model_dir;

/// The model file in the pack.
pub const MODEL_FILE: &str = "phoneme_transition_model.onnx";
/// Seconds per output frame.
const FRAME_SECONDS: f64 = 0.01;
/// Fewest frames between two transitions, pydomino's default.
const MIN_FRAMES: usize = 3;

static MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

/// Whether the downloaded model is in place.
pub fn model_available() -> bool {
  MODEL_PATH.get().is_some()
    || crate::commands::pack_present(crate::commands::ExtraPack::DominoModel)
}

/// Uses the model at `path` in place of the downloaded one, for tests.
pub fn provide_model(path: PathBuf) {
  let _ = MODEL_PATH.set(path);
}

/// Creates the session on the runtime the core loaded. This crate never
/// loads a runtime itself, so a voice setup must be loaded first.
fn create_session(cpu_num_threads: u16) -> Result<Session, String> {
  if voicevox_core::blocking::Onnxruntime::get().is_none() {
    return Err("Load a voice setup before using the pydomino aligner".into());
  }
  if !model_available() {
    return Err("The pydomino model is not downloaded".into());
  }
  let path = match MODEL_PATH.get() {
    Some(path) => path.clone(),
    None => domino_model_dir()?.join(MODEL_FILE),
  };
  let failed = |error: String| format!("Failed to load the pydomino model: {error}");
  Session::builder()
    .map_err(|e| failed(e.to_string()))?
    .with_intra_threads(cpu_num_threads.into())
    .map_err(|e| failed(e.to_string()))?
    .commit_from_file(path)
    .map_err(|e| failed(e.to_string()))
}

/// Splits the units' spans evenly among the phonemes each stands for.
fn phoneme_spans(frames: &[usize], units: &[usize]) -> Vec<(f64, f64)> {
  let mut spans = Vec::with_capacity(units.iter().sum());
  let mut start = 0.0;
  for (unit, count) in units.iter().enumerate() {
    // The last unit ends where the caller knows the recording does.
    let end = frames
      .get(unit)
      .map_or(start, |frame| *frame as f64 * FRAME_SECONDS);
    let step = (end - start) / *count as f64;
    for part in 0..*count {
      let part_end = if part + 1 == *count {
        end
      } else {
        start + step * (part + 1) as f64
      };
      spans.push((start + step * part as f64, part_end));
    }
    start = end;
  }
  spans
}

/// Times `phonemes` (VOICEVOX's names, with a pause at both ends) in
/// `samples`, mono at 16 kHz. Returns each phoneme's span in seconds; the last
/// one ends where it starts, for the caller to extend to the recording's end.
pub(super) fn align(
  samples: &[f32],
  phonemes: &[String],
  cpu_num_threads: u16,
) -> Result<Vec<(f64, f64)>, String> {
  let tokens = tokenizer::tokenize(phonemes)?;
  let mut session = SESSION.lock().map_err(|e| e.to_string())?;
  // Failures are not kept, so a model downloaded later is picked up.
  let session = match &mut *session {
    Some(session) => session,
    empty => empty.insert(create_session(cpu_num_threads)?),
  };
  let failed = |error: String| format!("Failed to align the recording: {error}");
  let input = Tensor::from_array(([1, samples.len()], samples.to_vec()))
    .map_err(|e| failed(e.to_string()))?;
  let outputs = session
    .run(ort::inputs!["input_waveform" => input])
    .map_err(|e| failed(e.to_string()))?;
  let (shape, transitions) = outputs["transition_logprobs"]
    .try_extract_tensor::<f32>()
    .map_err(|e| failed(e.to_string()))?;
  let (_, blank) = outputs["blank_logprobs"]
    .try_extract_tensor::<f32>()
    .map_err(|e| failed(e.to_string()))?;
  let width = shape.last().map_or(0, |width| *width as usize);
  if width != tokenizer::TRANSITION_COUNT {
    return Err(failed(format!("the model has {width} transitions")));
  }
  let frames = viterbi::decode(transitions, blank, width, &tokens.ids, MIN_FRAMES)
    .ok_or("The recording is too short for this text")?;
  Ok(phoneme_spans(&frames, &tokens.units))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn units_split_their_span_among_their_phonemes() {
    // Three units: one phoneme, two phonemes, one phoneme (the last).
    let spans = phoneme_spans(&[10, 30], &[1, 2, 1]);
    assert_eq!(spans.len(), 4);
    assert_eq!(spans[0], (0.0, 0.1));
    assert!((spans[1].0 - 0.1).abs() < 1e-12 && (spans[1].1 - 0.2).abs() < 1e-12);
    assert!((spans[2].0 - 0.2).abs() < 1e-12);
    assert_eq!(spans[2].1, 0.3);
    assert_eq!(spans[3], (0.3, 0.3));
    for pair in spans.windows(2) {
      assert_eq!(pair[0].1, pair[1].0);
    }
  }
}
