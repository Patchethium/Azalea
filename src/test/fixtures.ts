import type {
  AudioQuery,
  AzaleaConfig,
  CharacterMeta,
  Preset,
  SpectrogramPreview,
} from "$binding";
import {
  DEFAULT_BOTTOM_RATIO,
  DEFAULT_BOTTOM_SCALE,
  DEFAULT_CUSTOM_TITLEBAR,
  DEFAULT_PLAYBACK_TIMELINE,
  DEFAULT_LOCALE,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_SPECTROGRAM_PREVIEW,
  DEFAULT_SYNTHESIS_DELAY_MS,
  DEFAULT_THEME_MODE,
} from "$constants";

export const mora = {
  text: "コ",
  consonant: "k",
  consonant_length: 0.08,
  vowel: "o",
  vowel_length: 0.12,
  pitch: 5.4,
};

export const audioQuery = (
  overrides: Partial<AudioQuery> = {},
): AudioQuery => ({
  accent_phrases: [
    {
      moras: [{ ...mora }],
      accent: 1,
      pause_mora: null,
      is_interrogative: false,
    },
  ],
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
  outputSamplingRate: 24_000,
  outputStereo: false,
  kana: "コ",
  ...overrides,
});

export const preset = (overrides: Partial<Preset> = {}): Preset => ({
  id: "preset-1",
  name: "Default",
  style_id: 1,
  speaker_uuid: "speaker-1",
  style_name: "Normal",
  speed: 100,
  pitch: 0,
  intonation: 1,
  volume: 1,
  start_slience: 100,
  end_slience: 200,
  ...overrides,
});

export const config = (
  overrides: Partial<AzaleaConfig["ui"]> = {},
): AzaleaConfig => ({
  core: null,
  system_presets: [preset()],
  ui: {
    locale: DEFAULT_LOCALE,
    theme_mode: DEFAULT_THEME_MODE,
    custom_titlebar: DEFAULT_CUSTOM_TITLEBAR,
    primary_color: DEFAULT_PRIMARY_COLOR,
    bottom_scale: DEFAULT_BOTTOM_SCALE,
    auto_save: false,
    bottom_ratio: DEFAULT_BOTTOM_RATIO,
    side_width: DEFAULT_SIDEBAR_WIDTH,
    buffer_render: false,
    synthesis_delay_ms: DEFAULT_SYNTHESIS_DELAY_MS,
    spectrogram_preview: DEFAULT_SPECTROGRAM_PREVIEW,
    playback_timeline: DEFAULT_PLAYBACK_TIMELINE,
    name_truncation_len: 0,
    last_exported_dir: null,
    shortcuts: {},
    ...overrides,
  },
});

export const metas: CharacterMeta[] = [
  {
    name: "Speaker",
    speaker_uuid: "speaker-1",
    version: "1.0.0",
    order: 0,
    styles: [
      { id: 2, name: "Happy", order: 1, type: "talk" },
      { id: 1, name: "Normal", order: 0, type: "talk" },
    ],
  },
];

export const spectrogram: SpectrogramPreview = {
  values: [0, 64, 128, 255],
  frameCount: 2,
  melBins: 2,
  durationSeconds: 1,
};
