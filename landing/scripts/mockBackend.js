// A stand-in for Azalea's Rust backend, injected into the page before the
// app's frontend loads so the real UI can be screenshotted in a browser.
// It answers the Tauri IPC with fixture data: voices, pitches and
// spectrograms here are illustrative, not VOICEVOX output.
//
// Runs in the page, so it must stay self-contained (no imports).
(() => {
  const options = window.__AZALEA_CAPTURE__ ?? {};

  // --- Fixture voices -----------------------------------------------------
  const metas = [
    ["voice-aoi", "あおい", ["ノーマル", "あまあま", "ささやき"]],
    ["voice-hinata", "ひなた", ["ノーマル", "げんき"]],
    ["voice-ren", "れん", ["ノーマル", "クール"]],
  ].map(([speaker_uuid, name, styles], order) => ({
    name,
    speaker_uuid,
    version: "0.16.4",
    order,
    styles: styles.map((style, index) => ({
      id: order * 10 + index,
      name: style,
      order: index,
      type: "talk",
    })),
  }));
  const centers = { 0: 5.75, 1: 5.85, 2: 5.2 };
  const centerOf = (styleId) => centers[Math.floor(styleId / 10)] ?? 5.6;
  const range = metas.flatMap((meta) =>
    meta.styles.map((style) => {
      const center = centerOf(style.id);
      return [
        style.id,
        {
          min: center - 0.45,
          max: center + 0.45,
          histogram_min: center - 0.8,
          histogram_max: center + 0.8,
          histogram: Array.from({ length: 128 }, (_, bin) =>
            Math.round(100 * Math.exp(-(((bin - 64) / 22) ** 2))),
          ),
        },
      ];
    }),
  );

  const preset = (id, name, style_id, speaker, style, overrides = {}) => ({
    id,
    name,
    style_id,
    speaker_uuid: speaker,
    style_name: style,
    speed: 100,
    pitch: 0,
    intonation: 1,
    volume: 1,
    start_slience: 100,
    end_slience: 100,
    ...overrides,
  });
  const presets = [
    preset("preset-narrator", "Narrator", 0, "voice-aoi", "ノーマル"),
    preset("preset-whisper", "Whisper", 2, "voice-aoi", "ささやき", {
      speed: 90,
      volume: 0.8,
    }),
    preset("preset-cheerful", "Cheerful", 11, "voice-hinata", "げんき", {
      speed: 110,
      intonation: 1.3,
    }),
    preset("preset-cool", "Cool", 21, "voice-ren", "クール", { pitch: -0.05 }),
  ];

  // --- Fixture readings ---------------------------------------------------
  // Each line: text, then accent phrases as "katakana/accent", with a
  // trailing "、" for a pause.
  const readings = {
    "こんにちは、アザレアへようこそ。": [
      "コンニチワ/5、",
      "アザレアエ/2",
      "ヨオコソ/1",
    ],
    "テキストをブロックに分けて、プリセットで声を選びます。": [
      "テキストオ/1",
      "ブロックニ/2",
      "ワケテ/2、",
      "プリセットデ/2",
      "コエオ/1",
      "エラビマス/4",
    ],
    "音の高さも長さも、思いどおりに調整できます。": [
      "オトノ/2",
      "タカサモ/1",
      "ナガサモ/1、",
      "オモイドオリニ/4",
      "チョオセエ/5",
      "デキマス/3",
    ],
    "シードを変えると、別の抑揚が見つかります。": [
      "シードオ/1",
      "カエルト/3、",
      "ベツノ/3",
      "ヨクヨオガ/5",
      "ミツカリマス/5",
    ],
  };

  const consonants = {
    カ: "k",
    キ: "k",
    ク: "k",
    ケ: "k",
    コ: "k",
    ガ: "g",
    ギ: "g",
    グ: "g",
    ゲ: "g",
    ゴ: "g",
    サ: "s",
    シ: "sh",
    ス: "s",
    セ: "s",
    ソ: "s",
    ザ: "z",
    ジ: "j",
    ズ: "z",
    ゼ: "z",
    ゾ: "z",
    タ: "t",
    チ: "ch",
    ツ: "ts",
    テ: "t",
    ト: "t",
    ダ: "d",
    デ: "d",
    ド: "d",
    ナ: "n",
    ニ: "n",
    ヌ: "n",
    ネ: "n",
    ノ: "n",
    ハ: "h",
    ヒ: "h",
    フ: "f",
    ヘ: "h",
    ホ: "h",
    バ: "b",
    ビ: "b",
    ブ: "b",
    ベ: "b",
    ボ: "b",
    パ: "p",
    ピ: "p",
    プ: "p",
    ペ: "p",
    ポ: "p",
    マ: "m",
    ミ: "m",
    ム: "m",
    メ: "m",
    モ: "m",
    ヤ: "y",
    ユ: "y",
    ヨ: "y",
    ラ: "r",
    リ: "r",
    ル: "r",
    レ: "r",
    ロ: "r",
    ワ: "w",
  };
  const vowels = {
    a: "アカガサザタダナハバパマヤラワャ",
    i: "イキギシジチニヒビピミリ",
    u: "ウクグスズツヌフブプムユルュ",
    e: "エケゲセゼテデネヘベペメレ",
    o: "オコゴソゾトドノホボポモヨロョ",
  };
  const vowelOf = (kana) =>
    Object.keys(vowels).find((vowel) => vowels[vowel].includes(kana));
  const small = "ャュョ";
  const unvoiced = new Set(["k", "s", "sh", "t", "ch", "ts", "h", "f", "p"]);

  // Deterministic jitter, so the same text always yields the same contour.
  const jitter = (seed) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  };

  const moraOf = (text, index) => {
    if (text === "ン")
      return {
        text,
        consonant: null,
        consonant_length: null,
        vowel: "N",
        vowel_length: 0.075,
      };
    if (text === "ッ")
      return {
        text,
        consonant: null,
        consonant_length: null,
        vowel: "cl",
        vowel_length: 0.07,
      };
    const head = text[0];
    const tail = text[text.length - 1];
    let consonant = consonants[head] ?? null;
    if (text.length === 2 && consonant !== null && !/[jc]|sh/.test(consonant))
      consonant += "y";
    return {
      text,
      consonant,
      consonant_length:
        consonant === null ? null : 0.05 + 0.03 * (jitter(index + 3) + 0.5),
      vowel: vowelOf(tail),
      vowel_length: 0.085 + 0.05 * (jitter(index + 11) + 0.5),
    };
  };

  const splitMoras = (kana) => {
    const moras = [];
    for (const char of kana) {
      if (small.includes(char)) moras[moras.length - 1] += char;
      else moras.push(char);
    }
    return moras;
  };

  const buildQuery = (text, styleId, seed) => {
    const phrases = readings[text] ?? fallbackReading(text);
    const center = centerOf(styleId);
    let moraIndex = 0;
    const accent_phrases = phrases.map((phrase, phraseIndex) => {
      const pause = phrase.endsWith("、");
      const [kana, accentText] = phrase.replace("、", "").split("/");
      const accent = Number(accentText);
      const texts = splitMoras(kana);
      // Each phrase starts a little lower than the one before it.
      const declination = -0.045 * phraseIndex;
      const moras = texts.map((moraText, position) => {
        const mora = moraOf(moraText, moraIndex++);
        const high = position < accent && (position > 0 || accent === 1);
        const fall = position >= accent ? -0.06 * (position - accent) : 0;
        const voiced = mora.vowel !== "cl";
        const noise = 0.035 * jitter(moraIndex * 7 + seed * 13);
        const pitch =
          center + declination + (high ? 0.16 : -0.1) + fall + noise;
        return { ...mora, pitch: voiced ? pitch : 0 };
      });
      return {
        moras,
        accent,
        pause_mora: pause
          ? {
              text: "、",
              consonant: null,
              consonant_length: null,
              vowel: "pau",
              vowel_length: 0.32,
              pitch: 0,
            }
          : null,
        is_interrogative: false,
      };
    });
    return {
      accent_phrases,
      speedScale: 1,
      pitchScale: 0,
      intonationScale: 1,
      volumeScale: 1,
      prePhonemeLength: 0.1,
      postPhonemeLength: 0.1,
      outputSamplingRate: 24000,
      outputStereo: false,
      kana: phrases.join(""),
    };
  };

  // Text without a fixture reading is read kana by kana as one flat phrase.
  const fallbackReading = (text) => {
    const kana = [...text]
      .map((char) => {
        const code = char.codePointAt(0);
        return code >= 0x3041 && code <= 0x3096
          ? String.fromCodePoint(code + 0x60)
          : char;
      })
      .filter((char) => vowelOf(char) || "ンッ".includes(char))
      .join("");
    return kana ? [`${kana}/1`] : [];
  };

  // --- Fixture spectrogram ------------------------------------------------
  // Harmonics of the query's pitch under a few formant bumps, with noise for
  // unvoiced consonants: enough to look like speech behind the pitch editor.
  const formants = {
    a: [800, 1300, 2700],
    i: [300, 2300, 3000],
    u: [350, 1300, 2400],
    e: [500, 1900, 2600],
    o: [500, 900, 2600],
    N: [300, 1200, 2400],
  };
  const MEL_BINS = 80;
  const FRAME_SECONDS = 256 / 24000;
  const melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);
  const maxMel = 2595 * Math.log10(1 + 12000 / 700);
  const binHz = Array.from({ length: MEL_BINS }, (_, bin) =>
    melToHz(((bin + 0.5) / MEL_BINS) * maxMel),
  );

  const buildSpectrogram = (query) => {
    const segments = [];
    const speed = query.speedScale || 1;
    for (const phrase of query.accent_phrases) {
      for (const mora of phrase.moras) {
        if (mora.consonant)
          segments.push({
            seconds: mora.consonant_length / speed,
            noise: unvoiced.has(mora.consonant.replace("y", "")) ? 1 : 0.25,
            f0: unvoiced.has(mora.consonant) ? 0 : Math.exp(mora.pitch),
            formant: formants[mora.vowel],
            level: 0.45,
          });
        segments.push({
          seconds: mora.vowel_length / speed,
          noise: 0.06,
          f0: mora.pitch > 0 ? Math.exp(mora.pitch + query.pitchScale) : 0,
          formant: formants[mora.vowel],
          level: mora.vowel === "cl" ? 0 : 1,
        });
      }
      if (phrase.pause_mora)
        segments.push({
          seconds: phrase.pause_mora.vowel_length / speed,
          level: 0,
        });
    }
    const durationSeconds = segments.reduce((sum, s) => sum + s.seconds, 0);
    const frameCount = Math.max(1, Math.round(durationSeconds / FRAME_SECONDS));
    const values = new Array(frameCount * MEL_BINS).fill(0);
    let start = 0;
    for (const segment of segments) {
      const from = Math.round(start / FRAME_SECONDS);
      start += segment.seconds;
      const to = Math.min(frameCount, Math.round(start / FRAME_SECONDS));
      for (let frame = from; frame < to; frame++) {
        // Fade each sound in and out so neighbours blend.
        const edge = Math.min(frame - from + 1, to - frame, 3) / 3;
        for (let bin = 0; bin < MEL_BINS; bin++) {
          const hz = binHz[bin];
          let energy = 0;
          if (segment.level > 0 && segment.formant) {
            const envelope = segment.formant.reduce(
              (sum, center, index) =>
                sum +
                Math.exp(-(((hz - center) / (180 + 90 * index)) ** 2)) /
                  (1 + 0.5 * index),
              0.3 * Math.exp(-hz / 4000),
            );
            if (segment.f0 > 0) {
              const harmonic = hz / segment.f0;
              const distance = Math.abs(harmonic - Math.round(harmonic));
              // Mel bins widen with frequency, so harmonics smear together.
              const width = 0.1 + hz / 4500;
              const comb = Math.exp(-((distance / width) ** 2));
              energy +=
                envelope * (0.35 + 0.65 * comb) * (harmonic < 0.6 ? 0.1 : 1);
            }
            energy +=
              segment.noise *
              (0.25 + 0.5 * Math.min(1, hz / 5000)) *
              (0.6 + 0.8 * (jitter(frame * 131 + bin * 17) + 0.5));
          }
          const value = segment.level * edge * energy;
          values[bin * frameCount + frame] = Math.max(
            0,
            Math.min(255, Math.round(255 * (1.5 * value) ** 0.6)),
          );
        }
      }
    }
    return { values, frameCount, melBins: MEL_BINS, durationSeconds };
  };

  // --- Config and project -------------------------------------------------
  let config = {
    core: {
      ort_path: "/voicevox/onnxruntime",
      ojt_dir: "/voicevox/dict",
      vvm_dir: "/voicevox/models",
      setup_source: "Downloaded",
    },
    setup_source: "Downloaded",
    system_presets: presets,
    ui: {
      locale: "En",
      theme_mode: "Light",
      titlebar_style: "Custom",
      portrait_ratio: 0,
      bottom_ratio: 0.44,
      buffer_render: true,
      nonblocking_synthesis: true,
      synthesis_delay_ms: 0,
      spectrogram_preview: true,
      pitch_noise_enabled: true,
      post_processing: false,
      voice_import: false,
      shortcuts: {},
      ...options.ui,
    },
  };
  const texts = Object.keys(readings);
  const project = {
    presets,
    blocks: texts.map((text, index) => ({
      id: `block-${index + 1}`,
      text,
      query: buildQuery(
        text,
        presets[index % presets.length].style_id,
        index + 1,
      ),
      pitch_noise_seed: index + 1,
      preset_id: presets[index % presets.length].id,
    })),
  };

  // --- Tauri IPC ----------------------------------------------------------
  const callbacks = new Map();
  const listeners = new Map();
  let nextId = 1;
  const emit = (event, payload) => {
    for (const [id, listener] of listeners)
      if (listener.event === event)
        callbacks.get(listener.handler)?.({ event, id, payload });
  };
  const later = (fn, ms = 30) => setTimeout(fn, ms);

  const handlers = {
    "plugin:event|listen": ({ event, handler }) => {
      const id = nextId++;
      listeners.set(id, { event, handler });
      return id;
    },
    "plugin:event|unlisten": ({ eventId }) => void listeners.delete(eventId),
    "plugin:event|emit": ({ event }) => {
      if (event === "frontend-ready-event")
        later(() =>
          emit("initialization-event", {
            config,
            core_initialized: true,
            metas,
            range,
            error: null,
            resolved_core: config.core,
            active_setup_source: "Downloaded",
            unsupported_system_locale: null,
          }),
        );
    },
    "plugin:window|theme": () => "light",
    "plugin:window|is_maximized": () => false,
    "plugin:window|is_fullscreen": () => false,
    get_os: () => "Linux",
    get_config: () => config,
    set_config: ({ config: next }) => {
      config = next;
      return null;
    },
    get_metas: () => metas,
    get_range: () => range,
    supports_pitch_control: () => true,
    get_extras_status: () => [
      { pack: "Fonts", bytes: 23187805, installed: false },
      { pack: "EnglishModels", bytes: 7887840, installed: true },
      { pack: "AlignerModel", bytes: 1248924, installed: true },
    ],
    get_cached_speaker_icons: ({ requests }) =>
      requests.map(({ speaker_uuid }) => ({
        speaker_uuid,
        data_url: null,
        error: null,
      })),
    get_speaker_portrait: () => null,
    get_assets_size: () => 0,
    take_startup_project: () => "/projects/welcome.azp",
    load_project: () => project,
    home_dir: () => "/home/azalea",
    parent_path: () => "/projects",
    audio_query: ({ text, speakerId, seed }) =>
      buildQuery(text, speakerId, seed ?? 0),
    replace_mora_pitch: ({ ap }) => ap,
    replace_mora: ({ ap }) => ap,
    replace_mora_duration: ({ ap }) => ap,
    complete_mora_pitch: ({ ap }) => ap,
    synthesize_state: () => "Completed",
    synthesize_nonblocking: ({ request }) => {
      for (const [state, ms] of [
        ["Running", 10],
        ["Completed", 40],
      ])
        later(
          () =>
            emit("synthesis-job-event", {
              ...identity(request),
              state,
              error: null,
            }),
          ms,
        );
      return null;
    },
    synthesize: ({ request }) => handlers.synthesize_nonblocking({ request }),
    request_spectrogram_preview: ({ request }) => {
      later(
        () =>
          emit("spectrogram-job-event", {
            ...identity(request),
            state: "Completed",
            error: null,
            preview: buildSpectrogram(request.audioQuery),
          }),
        40,
      );
      return null;
    },
  };
  const identity = ({ blockId, generationId, hash }) => ({
    blockId,
    generationId,
    hash,
  });

  window.__AZALEA_CALLS__ = [];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event, id) => void listeners.delete(id),
  };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    transformCallback(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id) => void callbacks.delete(id),
    convertFileSrc: (path) => path,
    async invoke(command, args = {}) {
      window.__AZALEA_CALLS__.push(command);
      const handler = handlers[command];
      // Anything the fixtures do not cover succeeds with nothing.
      return handler ? handler(args) : null;
    },
  };
})();
