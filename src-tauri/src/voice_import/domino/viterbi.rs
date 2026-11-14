//! Viterbi decoding of pydomino's phoneme-transition model, after pydomino's
//! `solve_viterbi`.
//!
//! Each transition token happens in exactly one frame and every other frame
//! is blank. The decoder picks the frames that maximize the summed
//! log-probabilities with at least `min_frames` between consecutive
//! transitions, so no phoneme is shorter than that.

/// The frame of each of `tokens`' transitions, in order.
///
/// `transitions` holds `frames * width` log-probabilities, a row per frame,
/// and `blank` one per frame. Fewer frames than `min_frames` allows shorten
/// the minimum, as pydomino does; `None` when even one frame per transition
/// does not fit. Equal scores resolve to the earlier frame.
pub(super) fn decode(
  transitions: &[f32],
  blank: &[f32],
  width: usize,
  tokens: &[usize],
  min_frames: usize,
) -> Option<Vec<usize>> {
  let frames = blank.len();
  let count = tokens.len();
  if count == 0
    || frames < count
    || transitions.len() != frames * width
    || tokens.iter().any(|token| *token >= width)
  {
    return None;
  }
  let min_frames = if count > 1 {
    min_frames.clamp(1, (frames - 1) / (count - 1))
  } else {
    1
  };
  let emission = |frame: usize, token: usize| f64::from(transitions[frame * width + tokens[token]]);
  // blank_before[t]: the blank log-probabilities of the frames before t.
  let mut blank_before = Vec::with_capacity(frames + 1);
  blank_before.push(0.0);
  for value in blank {
    blank_before.push(blank_before[blank_before.len() - 1] + f64::from(*value));
  }

  // score[t]: the best total through frame t with the current token at t.
  let mut score: Vec<f64> = (0..frames)
    .map(|frame| blank_before[frame] + emission(frame, 0))
    .collect();
  // previous[token - 1][t]: the frame of the token before, given this one at t.
  let mut previous: Vec<Vec<u32>> = Vec::with_capacity(count - 1);
  for token in 1..count {
    let mut next = vec![f64::NEG_INFINITY; frames];
    let mut back = vec![0u32; frames];
    // The best earlier frame so far, without the blanks up to the current one.
    let mut best = f64::NEG_INFINITY;
    let mut best_frame = 0;
    for frame in token * min_frames..frames {
      let candidate = frame - min_frames;
      let value = score[candidate] - blank_before[candidate + 1];
      if value > best {
        best = value;
        best_frame = candidate;
      }
      next[frame] = best + blank_before[frame] + emission(frame, token);
      back[frame] = best_frame as u32;
    }
    score = next;
    previous.push(back);
  }

  let mut best = f64::NEG_INFINITY;
  let mut last = None;
  for (frame, value) in score.iter().enumerate() {
    let total = value + blank_before[frames] - blank_before[frame + 1];
    if total > best {
      best = total;
      last = Some(frame);
    }
  }
  let mut frame = last?;
  let mut result = vec![0; count];
  for token in (0..count).rev() {
    result[token] = frame;
    if token > 0 {
      frame = previous[token - 1][frame] as usize;
    }
  }
  Some(result)
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A small deterministic generator, so the cases are the same every run.
  struct Lcg(u64);
  impl Lcg {
    fn next(&mut self) -> f32 {
      self.0 = self
        .0
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
      -(((self.0 >> 40) % 1000) as f32) / 100.0
    }
  }

  fn total(
    transitions: &[f32],
    blank: &[f32],
    width: usize,
    tokens: &[usize],
    at: &[usize],
  ) -> f64 {
    let mut sum = 0.0;
    let mut next = 0;
    for frame in 0..blank.len() {
      if next < at.len() && at[next] == frame {
        sum += f64::from(transitions[frame * width + tokens[next]]);
        next += 1;
      } else {
        sum += f64::from(blank[frame]);
      }
    }
    sum
  }

  /// Every placement of the tokens with the minimum gap.
  fn placements(frames: usize, count: usize, min_frames: usize) -> Vec<Vec<usize>> {
    fn extend(
      frames: usize,
      count: usize,
      min_frames: usize,
      current: &mut Vec<usize>,
      all: &mut Vec<Vec<usize>>,
    ) {
      if current.len() == count {
        all.push(current.clone());
        return;
      }
      let start = current.last().map_or(0, |last| last + min_frames);
      for frame in start..frames {
        current.push(frame);
        extend(frames, count, min_frames, current, all);
        current.pop();
      }
    }
    let mut all = Vec::new();
    extend(frames, count, min_frames, &mut Vec::new(), &mut all);
    all
  }

  #[test]
  fn decoding_matches_an_exhaustive_search() {
    let mut random = Lcg(7);
    let width = 4;
    for frames in 1..=9 {
      for count in 1..=4 {
        for min_frames in 1..=3 {
          let transitions: Vec<f32> = (0..frames * width).map(|_| random.next()).collect();
          let blank: Vec<f32> = (0..frames).map(|_| random.next()).collect();
          let tokens: Vec<usize> = (0..count).map(|token| (token * 3) % width).collect();
          let decoded = decode(&transitions, &blank, width, &tokens, min_frames);
          if frames < count {
            assert_eq!(decoded, None);
            continue;
          }
          let allowed = if count > 1 {
            min_frames.min((frames - 1) / (count - 1))
          } else {
            1
          };
          let best = placements(frames, count, allowed)
            .into_iter()
            .map(|at| total(&transitions, &blank, width, &tokens, &at))
            .fold(f64::NEG_INFINITY, f64::max);
          let decoded = decoded.expect("a placement exists");
          assert!(decoded.windows(2).all(|pair| pair[1] - pair[0] >= allowed));
          let score = total(&transitions, &blank, width, &tokens, &decoded);
          assert!(
            (score - best).abs() < 1e-9,
            "{frames} frames, {count} tokens, gap {min_frames}: {score} vs {best}"
          );
        }
      }
    }
  }

  #[test]
  fn clear_transitions_are_found_and_kept_apart() {
    // Two tokens that both peak at frame 4: the gap moves one of them.
    let width = 2;
    let frames = 10;
    let mut transitions = vec![-20.0; frames * width];
    transitions[4 * width] = -0.1;
    transitions[4 * width + 1] = -0.1;
    transitions[7 * width + 1] = -0.5;
    let blank = vec![-1.0; frames];
    assert_eq!(
      decode(&transitions, &blank, width, &[0, 1], 3),
      Some(vec![4, 7])
    );
    assert_eq!(decode(&transitions, &blank, width, &[0], 3), Some(vec![4]));
  }

  #[test]
  fn malformed_input_is_rejected() {
    let blank = vec![-1.0; 3];
    assert_eq!(decode(&[-1.0; 6], &blank, 2, &[], 3), None);
    assert_eq!(decode(&[-1.0; 6], &blank, 2, &[2], 3), None);
    assert_eq!(decode(&[-1.0; 5], &blank, 2, &[0], 3), None);
    assert_eq!(decode(&[-1.0; 6], &blank, 2, &[0, 1, 0, 1], 1), None);
  }
}
