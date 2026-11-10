import { createSignal } from "solid-js";

export const locales = ["en", "ja", "zh-CN"] as const;
export type Locale = (typeof locales)[number];

/** Each language's own name, shown in the selector. */
export const localeNames: Record<Locale, string> = {
  en: "English",
  ja: "日本語",
  "zh-CN": "简体中文",
};

const en = {
  nav: {
    features: "Features",
    tuning: "Tuning",
    start: "Get started",
    github: "Azalea on GitHub",
    language: "Language",
    theme: "Toggle dark mode",
  },
  hero: {
    badge: "Unofficial VOICEVOX GUI · in active development",
    title: ["Japanese speech,", "tuned your way."],
    lead: "Azalea is a lightweight desktop editor for VOICEVOX voices. It drives the Rust VOICEVOX Core directly, with no engine running in the background, and organizes your script around voice presets.",
    download: "Download",
    source: "View source",
    platforms: "Windows · macOS (Apple Silicon) · Linux — free and open source",
    shot: "The Azalea editor: preset list, text blocks and the pitch tuning panel",
  },
  features: {
    eyebrow: "Features",
    title: "A small app with careful tools",
    items: [
      {
        title: "Only the voices you need",
        body: "Reuse an existing VOICEVOX installation, or download just the voice packages you want from inside Azalea.",
      },
      {
        title: "Built around presets",
        body: "Write in text blocks and give each one a preset: speaker, style, speed, pitch and intonation, set once and reused.",
      },
      {
        title: "Pitch variations",
        body: "Seeded noise in pitch prediction lets you step through alternative intonations and return to any of them by its seed.",
      },
      {
        title: "Post tuning",
        body: "Redraw pitch frame by frame and stretch timing after synthesis. Experimental, and may reduce audio quality.",
      },
      {
        title: "Fast first sound",
        body: "Streaming synthesis starts playback once the first chunk is rendered, not after the whole line.",
      },
      {
        title: "MCP server",
        body: "Let LLM clients such as Claude speak with your voices through a local MCP server. Experimental and off by default.",
      },
    ],
  },
  tuning: {
    eyebrow: "Tuning",
    title: "Shape every mora",
    lead: "Fix how a line is read phrase by phrase, then adjust pitch and length mora by mora.",
    points: [
      "Move accents and split or join accent phrases",
      "Tune pitch on an absolute scale, or relative to the prediction",
      "Check the result against a spectrogram preview",
    ],
    shots: [
      "The accent panel: accent phrases with a slider for each accent position",
      "The tuning panel: a pitch line for each mora over a spectrogram",
    ],
  },
  start: {
    eyebrow: "Get started",
    title: "Three steps to your first line",
    steps: [
      {
        title: "Install",
        body: "Get a build for Windows, macOS (Apple Silicon) or Linux from the releases page.",
      },
      {
        title: "Set up voices",
        body: "Open config and, under Voice → Voice setup, download Azalea-managed models or choose the vv-engine folder of your VOICEVOX installation.",
      },
      {
        title: "Start typing",
        body: "Close config, write a line and press play.",
      },
    ],
    download: "Go to releases",
    guide: "Read the guide",
  },
  footer: {
    disclaimer:
      "Azalea is an unofficial project and is not affiliated with VOICEVOX. Voice models are subject to their own terms of use.",
    screenshots: "Screenshots show sample data.",
    license: "Licensed under GPL-3.0-or-later",
  },
};

type Messages = typeof en;

const ja: Messages = {
  nav: {
    features: "機能",
    tuning: "調整",
    start: "はじめ方",
    github: "GitHubのAzalea",
    language: "言語",
    theme: "ダークモードを切り替え",
  },
  hero: {
    badge: "非公式VOICEVOX GUI・開発中",
    title: ["日本語の音声を、", "思いどおりに。"],
    lead: "Azalea（アザレア）は、VOICEVOXの音声を扱う軽量なデスクトップエディターです。エンジンを起動せずRust版VOICEVOX Coreを直接利用し、テキストをプリセット単位で管理します。",
    download: "ダウンロード",
    source: "ソースを見る",
    platforms: "Windows・macOS（Apple Silicon）・Linux — 無料・オープンソース",
    shot: "Azaleaのエディター：プリセット一覧、テキストブロック、音高調整パネル",
  },
  features: {
    eyebrow: "機能",
    title: "小さなアプリに、丁寧な道具を",
    items: [
      {
        title: "必要なモデルだけ導入",
        body: "インストール済みのVOICEVOXを使うか、必要な音声モデルだけをアプリ内でダウンロードできます。",
      },
      {
        title: "プリセット中心の操作",
        body: "テキストをブロックに分け、話者・スタイル・話速・音高・抑揚をまとめたプリセットを割り当てます。",
      },
      {
        title: "音高のバリエーション",
        body: "シード付きノイズで音高予測に変化を加え、別の抑揚を探せます。シードを戻せば同じ結果に戻れます。",
      },
      {
        title: "ポスト調整",
        body: "合成後の音高をフレーム単位で描き直し、長さも伸縮できます。実験的な機能で、音質が低下する場合があります。",
      },
      {
        title: "すぐに再生",
        body: "ストリーミング合成により、文全体を待たず最初のチャンクができた時点で再生が始まります。",
      },
      {
        title: "MCPサーバー",
        body: "ClaudeなどのLLMクライアントから、ローカルのMCPサーバー経由で音声を合成できます。実験的な機能で、初期状態では無効です。",
      },
    ],
  },
  tuning: {
    eyebrow: "調整",
    title: "モーラごとに整える",
    lead: "アクセント句ごとに読みを直し、モーラ単位で音高と長さを調整します。",
    points: [
      "アクセントの移動、アクセント句の分割と結合",
      "絶対値、または予測値からの相対値で音高を調整",
      "スペクトログラムのプレビューで結果を確認",
    ],
    shots: [
      "アクセントパネル：アクセント句と、アクセント位置を決めるスライダー",
      "調整パネル：スペクトログラムに重ねたモーラごとの音高",
    ],
  },
  start: {
    eyebrow: "はじめ方",
    title: "3ステップで最初の一文",
    steps: [
      {
        title: "インストール",
        body: "リリースページから、Windows・macOS（Apple Silicon）・Linux向けのビルドを入手します。",
      },
      {
        title: "音声を準備",
        body: "設定を開き、「音声 → 音声環境」でAzalea管理のモデルをダウンロードするか、VOICEVOXのvv-engineフォルダーを選びます。",
      },
      {
        title: "入力する",
        body: "設定を閉じ、文章を入力して再生します。",
      },
    ],
    download: "リリースページへ",
    guide: "ガイドを読む",
  },
  footer: {
    disclaimer:
      "Azaleaは非公式のプロジェクトであり、VOICEVOXとは提携していません。音声モデルにはそれぞれの利用規約が適用されます。",
    screenshots: "スクリーンショットはサンプルデータです。",
    license: "GPL-3.0-or-laterで公開",
  },
};

const zhCN: Messages = {
  nav: {
    features: "功能",
    tuning: "调音",
    start: "开始使用",
    github: "GitHub 上的 Azalea",
    language: "语言",
    theme: "切换深色模式",
  },
  hero: {
    badge: "非官方 VOICEVOX GUI · 开发中",
    title: ["日语语音，", "随心调校。"],
    lead: "Azalea 是一款轻量的 VOICEVOX 桌面编辑器。它直接调用 Rust 版 VOICEVOX Core，无需在后台运行引擎，并以预设为中心组织文本。",
    download: "下载",
    source: "查看源码",
    platforms: "Windows · macOS（Apple Silicon）· Linux — 免费开源",
    shot: "Azalea 编辑器：预设列表、文本块与音高调整面板",
  },
  features: {
    eyebrow: "功能",
    title: "小巧的应用，用心的工具",
    items: [
      {
        title: "只装需要的模型",
        body: "可以复用已安装的 VOICEVOX，也可以在应用内只下载需要的语音包。",
      },
      {
        title: "以预设为中心",
        body: "把文本分成文本块，为每块指定预设：说话人、风格、语速、音高与语调，设置一次即可反复使用。",
      },
      {
        title: "音高变化",
        body: "在音高预测中加入带种子的噪声，逐个尝试不同的语调，并可凭种子回到任意一个结果。",
      },
      {
        title: "后期调整",
        body: "合成后逐帧重绘音高并伸缩时长。实验性功能，可能降低音质。",
      },
      {
        title: "即刻出声",
        body: "流式合成在渲染出第一段后即开始播放，无需等待整句完成。",
      },
      {
        title: "MCP 服务器",
        body: "通过本地 MCP 服务器，让 Claude 等 LLM 客户端使用你的语音。实验性功能，默认关闭。",
      },
    ],
  },
  tuning: {
    eyebrow: "调音",
    title: "逐个音拍精修",
    lead: "先按重音短语修正读法，再逐个音拍调整音高与时长。",
    points: [
      "移动重音位置，拆分或合并重音短语",
      "按绝对音高，或相对于预测值调整音高",
      "对照频谱图预览检查结果",
    ],
    shots: [
      "重音面板：重音短语及其重音位置滑块",
      "调音面板：叠加在频谱图上的各音拍音高",
    ],
  },
  start: {
    eyebrow: "开始使用",
    title: "三步读出第一句",
    steps: [
      {
        title: "安装",
        body: "从发布页获取适用于 Windows、macOS（Apple Silicon）或 Linux 的版本。",
      },
      {
        title: "准备语音",
        body: "打开设置，在“语音 → 语音环境”中下载 Azalea 管理的模型，或选择 VOICEVOX 安装目录下的 vv-engine 文件夹。",
      },
      {
        title: "开始输入",
        body: "关闭设置，输入一句话，然后播放。",
      },
    ],
    download: "前往发布页",
    guide: "阅读指南",
  },
  footer: {
    disclaimer:
      "Azalea 是非官方项目，与 VOICEVOX 没有关联。语音模型受其各自的使用条款约束。",
    screenshots: "截图为示例数据。",
    license: "以 GPL-3.0-or-later 许可发布",
  },
};

const messages: Record<Locale, Messages> = { en, ja, "zh-CN": zhCN };
const STORAGE_KEY = "azalea-locale";

const isLocale = (value: unknown): value is Locale =>
  locales.includes(value as Locale);

/** The locale for a BCP 47 tag such as `ja-JP` or `zh-Hans`, if supported. */
export const matchLocale = (tag: string): Locale | null => {
  const language = tag.toLowerCase().split("-")[0];
  if (language === "ja") return "ja";
  if (language === "zh") return "zh-CN";
  if (language === "en") return "en";
  return null;
};

const readStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/** `?lang=`, then the stored choice, then the browser's languages. */
const initialLocale = (): Locale => {
  const requested = new URLSearchParams(location.search).get("lang");
  if (isLocale(requested)) return requested;
  const stored = readStored();
  if (isLocale(stored)) return stored;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return "en";
};

const [locale, setLocaleSignal] = createSignal<Locale>(initialLocale());

export { locale };

export const setLocale = (next: Locale) => {
  setLocaleSignal(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable; the choice then lasts for this visit.
  }
};

/** The messages of the current locale; reactive when read in a tracking scope. */
export const t = () => messages[locale()];
