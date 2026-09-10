import { For, createSignal } from "solid-js";

const presets = [
  { name: "A gentle introduction", voice: "四国めたん", style: "ノーマル" },
  { name: "A little more energy", voice: "ずんだもん", style: "ノーマル" },
];
const tabs = ["Pitch", "Accent", "Duration"] as const;
const moras = ["こ", "ん", "に", "ち", "は", "せ", "か", "い"];
const pitch = [47, 34, 29, 33, 40, 26, 31, 44];
const duration = [35, 24, 43, 30, 48, 26, 39, 54];

export function EditorPreview() {
  const [selected, setSelected] = createSignal(0);
  const [tab, setTab] = createSignal<(typeof tabs)[number]>("Pitch");
  return (
    <figure class="editor-figure">
      <div class="editor-window">
        <div class="editor-titlebar">
          <span
            class="i-lucide:audio-lines size-4 text-primary-5"
            aria-hidden="true"
          />
          <span>Azalea</span>
          <span class="editor-filename">hello-world.azp</span>
          <span class="i-lucide:minus size-3" aria-hidden="true" />
          <span class="i-lucide:square size-3" aria-hidden="true" />
        </div>
        <div class="editor-body">
          <aside class="preview-sidebar" aria-label="Example voice presets">
            <div class="preview-section-label">Your presets</div>
            <For each={presets}>
              {(preset, index) => (
                <button
                  type="button"
                  class="preview-preset"
                  classList={{ active: selected() === index() }}
                  aria-pressed={selected() === index()}
                  onClick={() => setSelected(index())}
                >
                  <span class="preset-swatch" aria-hidden="true">
                    <span class="i-lucide:mic-2 size-4" />
                  </span>
                  <span>
                    <strong>{preset.name}</strong>
                    <span lang="ja">
                      {preset.voice} · {preset.style}
                    </span>
                  </span>
                </button>
              )}
            </For>
            <div class="preview-parameters">
              <div class="preview-section-label">Preset settings</div>
              <For
                each={[
                  { label: "Speed", value: "100%", width: "50%" },
                  { label: "Pitch", value: "+0.00", width: "50%" },
                  {
                    label: "Intonation",
                    value: selected() === 0 ? "1.00" : "1.25",
                    width: selected() === 0 ? "50%" : "63%",
                  },
                ]}
              >
                {(parameter) => (
                  <div class="preview-parameter">
                    <div>
                      <span>{parameter.label}</span>
                      <span>{parameter.value}</span>
                    </div>
                    <div class="preview-slider" aria-hidden="true">
                      <span style={{ width: parameter.width }} />
                    </div>
                  </div>
                )}
              </For>
            </div>
            <div class="preview-sidebar-footer" aria-hidden="true">
              <span class="i-lucide:folder-open size-4" />
              <span class="i-lucide:notebook-tabs size-4" />
              <span class="i-lucide:keyboard size-4" />
              <span class="i-lucide:settings-2 size-4" />
            </div>
          </aside>
          <div class="preview-main">
            <div class="preview-script">
              <div class="preview-cell selected">
                <span class="cell-number">01</span>
                <p lang="ja">こんにちは、世界。</p>
                <span class="cell-preset">{presets[selected()].name}</span>
              </div>
              <div class="preview-cell">
                <span class="cell-number">02</span>
                <p lang="ja">あなたの言葉に、あなたらしい声を。</p>
                <span class="cell-preset">A little more energy</span>
              </div>
            </div>
            <div class="preview-tuning">
              <div class="preview-tuning-header">
                <div
                  class="preview-tabs"
                  role="group"
                  aria-label="Preview tuning panel"
                >
                  <For each={tabs}>
                    {(item) => (
                      <button
                        type="button"
                        aria-pressed={tab() === item}
                        classList={{ active: tab() === item }}
                        onClick={() => setTab(item)}
                      >
                        {item}
                      </button>
                    )}
                  </For>
                </div>
                <span class="preview-unit">
                  {tab() === "Duration"
                    ? "seconds"
                    : tab() === "Pitch"
                      ? "voice range"
                      : "accent"}
                </span>
              </div>
              <div
                class="preview-graph"
                aria-label={`Illustrative ${tab().toLowerCase()} values for the example sentence`}
              >
                <div class="graph-guides" aria-hidden="true" />
                <For each={moras}>
                  {(mora, index) => (
                    <div class="graph-column">
                      <div
                        class="graph-value"
                        style={{
                          bottom: `${tab() === "Duration" ? duration[index()] : tab() === "Accent" ? (index() > 0 && index() < 5 ? 62 : 27) : pitch[index()] + 20}%`,
                        }}
                      >
                        <span class="graph-point" />
                      </div>
                      <span lang="ja" class="graph-mora">
                        {mora}
                      </span>
                    </div>
                  )}
                </For>
              </div>
              <div class="preview-transport">
                <span
                  class="i-lucide:audio-lines size-4 text-primary-5"
                  aria-hidden="true"
                />
                <span>Room for the smallest details.</span>
                <span class="transport-format">WAV</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        Explore the presets and tuning tabs. This is an interface preview;
        speech is generated in the desktop app.
      </figcaption>
    </figure>
  );
}
