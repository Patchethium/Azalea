//! Compares whole-utterance synthesis with chunked streaming synthesis on the real core.
//!
//! Usage: `cargo run --release --example streaming_bench -- [text-file] [csv-out]`
//! The core comes from `AZALEA_TEST_CORE_DIR` or `config_dev/config.toml`.
//! `BENCH_FIRST_CHUNK_FRAMES` and `BENCH_MAX_CHUNK_FRAMES` override the chunk schedule.
use std::{
  io::Write,
  path::Path,
  time::{Duration, Instant},
};

use azalea_lib::streaming::{ChunkSchedule, StreamPlan, DEFAULT_CHUNK_SCHEDULE};
use azalea_lib::{
  config::{ConfigManager, CoreConfig},
  core::Core,
};
use voicevox_core::STREAMING_FRAME_RATE;

fn env_frames(name: &str, default: usize) -> usize {
  std::env::var(name)
    .ok()
    .map(|value| value.parse().expect("chunk sizes must be frame counts"))
    .unwrap_or(default)
}

fn core_config() -> CoreConfig {
  if let Some(root) = std::env::var_os("AZALEA_TEST_CORE_DIR") {
    return Core::find_path(Path::new(&root)).expect("AZALEA_TEST_CORE_DIR is incomplete");
  }
  ConfigManager::new()
    .expect("failed to load config_dev/config.toml")
    .config
    .core
    .expect("no development core configured")
}

/// Audio seconds of a 16-bit PCM WAV, from its header.
fn wav_seconds(wav: &[u8]) -> f64 {
  let channels = u16::from_le_bytes([wav[22], wav[23]]) as f64;
  let rate = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]) as f64;
  (wav.len() - 44) as f64 / (2.0 * channels * rate)
}

struct Sample {
  audio: f64,
  vanilla_total: Duration,
  prepare: Duration,
  first_chunk: Duration,
  streaming_total: Duration,
  chunks: usize,
  /// Silence inserted by playback waiting for a chunk that was not rendered yet.
  stall: Duration,
}

impl Sample {
  fn streaming_latency(&self) -> Duration {
    self.prepare + self.first_chunk
  }
}

fn percentile(values: &mut [f64], p: f64) -> f64 {
  values.sort_by(f64::total_cmp);
  let index = ((values.len() - 1) as f64 * p).round() as usize;
  values[index]
}

fn ms(duration: Duration) -> f64 {
  duration.as_secs_f64() * 1000.0
}

fn summarize(label: &str, samples: &[&Sample]) {
  if samples.is_empty() {
    return;
  }
  let stats = |f: &dyn Fn(&Sample) -> f64| {
    let mut values: Vec<f64> = samples.iter().map(|s| f(s)).collect();
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    (
      mean,
      percentile(&mut values, 0.5),
      percentile(&mut values, 0.9),
    )
  };
  let audio: f64 = samples.iter().map(|s| s.audio).sum();
  let vanilla: f64 = samples.iter().map(|s| s.vanilla_total.as_secs_f64()).sum();
  let streaming: f64 = samples
    .iter()
    .map(|s| s.streaming_total.as_secs_f64())
    .sum();
  let (vl_mean, vl_p50, vl_p90) = stats(&|s| ms(s.vanilla_total));
  let (sl_mean, sl_p50, sl_p90) = stats(&|s| ms(s.streaming_latency()));
  let (pr_mean, _, _) = stats(&|s| ms(s.prepare));
  let (fc_mean, _, _) = stats(&|s| ms(s.first_chunk));
  let stalled = samples.iter().filter(|s| !s.stall.is_zero()).count();
  let stall: f64 = samples.iter().map(|s| ms(s.stall)).sum();
  println!(
    "\n## {label}: {} utterances, {audio:.1} s audio (mean {:.2} s)",
    samples.len(),
    audio / samples.len() as f64
  );
  println!("latency to first audio (ms)   mean     p50     p90");
  println!("  vanilla                  {vl_mean:7.1} {vl_p50:7.1} {vl_p90:7.1}");
  println!("  streaming                {sl_mean:7.1} {sl_p50:7.1} {sl_p90:7.1}");
  println!("    (prepare {pr_mean:.1} + first chunk {fc_mean:.1})");
  println!(
    "total RTF: vanilla {:.4}, streaming {:.4} ({:+.1}%)",
    vanilla / audio,
    streaming / audio,
    (streaming / vanilla - 1.0) * 100.0
  );
  println!("playback stalls: {stalled} utterances, {stall:.0} ms in total");
}

fn main() {
  let mut args = std::env::args().skip(1);
  let text_path = args
    .next()
    .unwrap_or_else(|| "tests/rashoumon.txt".to_string());
  let csv_path = args.next();
  let text = std::fs::read_to_string(&text_path).expect("failed to read the text file");
  let lines: Vec<&str> = text
    .lines()
    .map(str::trim)
    .filter(|l| !l.is_empty())
    .collect();

  let config = core_config();
  let core = Core::init(&config).expect("failed to initialize VOICEVOX Core");
  let mut styles: Vec<_> = core.speaker_to_vvm.keys().copied().collect();
  styles.sort_unstable();
  let style_id = styles[0];
  assert!(
    core.supports_streaming(style_id).unwrap(),
    "style {style_id:?} cannot stream"
  );
  let schedule = ChunkSchedule {
    first_frames: env_frames(
      "BENCH_FIRST_CHUNK_FRAMES",
      DEFAULT_CHUNK_SCHEDULE.first_frames,
    ),
    max_frames: env_frames("BENCH_MAX_CHUNK_FRAMES", DEFAULT_CHUNK_SCHEDULE.max_frames),
  };
  println!(
    "style {style_id:?}, cpu_num_threads {}, chunks {}..{} frames, {} lines from {text_path}",
    config.cpu_num_threads,
    schedule.first_frames,
    schedule.max_frames,
    lines.len()
  );

  let queries: Vec<_> = lines
    .iter()
    .map(|line| {
      core
        .audio_query(line, style_id)
        .expect("audio query failed")
    })
    .collect();

  // Warm up both paths so session initialization is not measured.
  for query in queries.iter().take(3) {
    core.synthesis(query, style_id).unwrap();
    let audio = core.prepare_streaming(query, style_id).unwrap();
    for range in StreamPlan::new(audio.frame_length(), schedule, 0).chunks {
      core.render_streaming(&audio, range).unwrap();
    }
  }

  let mut samples = Vec::with_capacity(queries.len());
  for (index, query) in queries.iter().enumerate() {
    let run_vanilla = || {
      let started = Instant::now();
      let wav = core.synthesis(query, style_id).unwrap();
      (started.elapsed(), wav)
    };
    let run_streaming = || {
      let started = Instant::now();
      let audio = core.prepare_streaming(query, style_id).unwrap();
      let prepare = started.elapsed();
      let plan = StreamPlan::new(audio.frame_length(), schedule, 0);
      let mut first_chunk = None;
      // Playback position on the wall clock: each chunk plays once rendered and the one
      // before it finished playing.
      let mut playback_end = Duration::ZERO;
      let mut stall = Duration::ZERO;
      for range in &plan.chunks {
        let chunk_started = Instant::now();
        core.render_streaming(&audio, range.clone()).unwrap();
        let ready = started.elapsed();
        first_chunk.get_or_insert(chunk_started.elapsed());
        if playback_end.is_zero() {
          playback_end = ready;
        } else if ready > playback_end {
          stall += ready - playback_end;
          playback_end = ready;
        }
        playback_end += Duration::from_secs_f64(range.len() as f64 / STREAMING_FRAME_RATE);
      }
      (
        prepare,
        first_chunk.unwrap_or_default(),
        started.elapsed(),
        plan.chunks.len(),
        stall,
      )
    };
    // Alternate the order so drift (thermal, caches) affects both paths alike.
    let ((vanilla_total, wav), (prepare, first_chunk, streaming_total, chunks, stall)) =
      if index % 2 == 0 {
        let v = run_vanilla();
        (v, run_streaming())
      } else {
        let s = run_streaming();
        (run_vanilla(), s)
      };
    samples.push(Sample {
      audio: wav_seconds(&wav),
      vanilla_total,
      prepare,
      first_chunk,
      streaming_total,
      chunks,
      stall,
    });
  }

  if let Some(csv_path) = csv_path {
    let mut csv = std::fs::File::create(csv_path).unwrap();
    writeln!(
      csv,
      "line,chars,audio_s,chunks,vanilla_ms,prepare_ms,first_chunk_ms,streaming_latency_ms,streaming_total_ms,stall_ms"
    )
    .unwrap();
    for (index, s) in samples.iter().enumerate() {
      writeln!(
        csv,
        "{},{},{:.3},{},{:.2},{:.2},{:.2},{:.2},{:.2},{:.2}",
        index + 1,
        lines[index].chars().count(),
        s.audio,
        s.chunks,
        ms(s.vanilla_total),
        ms(s.prepare),
        ms(s.first_chunk),
        ms(s.streaming_latency()),
        ms(s.streaming_total),
        ms(s.stall)
      )
      .unwrap();
    }
  }

  let all: Vec<_> = samples.iter().collect();
  summarize("all", &all);
  let bucket = |lo: f64, hi: f64| -> Vec<&Sample> {
    samples
      .iter()
      .filter(|s| s.audio >= lo && s.audio < hi)
      .collect()
  };
  summarize("short (< 3 s)", &bucket(0.0, 3.0));
  summarize("medium (3–6 s)", &bucket(3.0, 6.0));
  summarize("long (≥ 6 s)", &bucket(6.0, f64::INFINITY));
}
