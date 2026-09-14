import { Tabs } from "@kobalte/core/tabs";
import { IconButton } from "./demo/IconButton";
import { TuningPanel } from "./demo/tuning/Panel";
import { useTuningPanel } from "./demo/tuning/usePanel";

export function TuningPreview() {
  const panel = useTuningPanel();
  return (
    <figure class="tuning-preview" aria-labelledby="tuning-preview-title">
      <div class="tuning-preview-intro">
        <div>
          <span class="eyebrow">Try the tuning panel</span>
          <h2 id="tuning-preview-title">Small changes. Your expression.</h2>
        </div>
        <p lang="ja">あなたの言葉に、あなたらしい声を。</p>
      </div>
      {/* Shell and tab styling copied from src/layout/bottomPanel/index.tsx.
          Playback controls are pruned; the demo only edits local sample data. */}
      <Tabs
        aria-label="Bottom Panel Tabs"
        class="tuning-preview-panel relative flex flex-col bg-white dark:bg-slate-8 border border-slate-2 dark:border-slate-6 rounded-lg overflow-hidden outline-none select-none text-slate-9 dark:text-slate-1"
        orientation="horizontal"
        defaultValue="tuning"
      >
        <div class="w-full flex flex-col b-b b-slate-3 dark:b-slate-6 select-none">
          <div class="h-8 w-full px-2 flex m-l-auto flex-row items-center justify-end gap-1">
            <IconButton
              icon="i-lucide:rotate-ccw"
              label="Reset tuning"
              onClick={panel.reset}
            />
          </div>
        </div>
        <div class="absolute left-0 top-0">
          <Tabs.List class="w-full flex flex-row items-center relative p-1 outline-none select-none">
            <Tabs.Trigger
              class="bg-transparent hover:bg-slate-1 dark:hover:bg-slate-7 px-2 rounded-md outline-none select-none"
              value="tuning"
            >
              Tuning
            </Tabs.Trigger>
            <Tabs.Indicator class="bg-primary-5 h-1px absolute transition-all bottom-0 left-0" />
          </Tabs.List>
        </div>
        <Tabs.Content class="flex min-h-0 flex-1 flex-col" value="tuning">
          <TuningPanel panel={panel} />
        </Tabs.Content>
      </Tabs>
      <figcaption>
        Drag a pitch line up or down. Hover over a character and drag its
        phonemes sideways to change timing. Use the slider below to zoom.
        <span>
          Keyboard: focus a pitch or phoneme control and use the arrow keys.
          Sample edits stay in this preview; generate speech in the desktop app.
        </span>
      </figcaption>
    </figure>
  );
}
