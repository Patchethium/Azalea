import type {
  AudioQuery,
  AzaleaConfig,
  CharacterMeta,
  Preset,
  SpectrogramPreview,
} from "../binding";

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
  name: "Default",
  style_id: 1,
  speed: 100,
  pitch: 0,
  intonation: 1,
  volume: 1,
  start_slience: 100,
  end_slience: 200,
  ...overrides,
});

export const config = (
  overrides: Partial<AzaleaConfig["ui_config"]> = {},
): AzaleaConfig => ({
  core_config: null,
  system_presets: [preset()],
  ui_config: {
    locale: "En",
    theme_mode: "System",
    primary_color: "#3b82f6",
    bottom_scale: 360,
    auto_save: false,
    bottom_ratio: 0.3,
    side_ratio: 0.2,
    buffer_render: false,
    synthesis_delay_ms: 600,
    spectrogram_preview: true,
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
