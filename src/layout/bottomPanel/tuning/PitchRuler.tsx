import { DEFAULT_DENSITY_AWARE_PITCH_SCALE } from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { ContextMenu } from "@kobalte/core/context-menu";
import { createMemo, For, Show } from "solid-js";
import type { PitchScale } from "./pitchScale";
import styles from "./PitchRuler.module.css";

export const PITCH_RULER_WIDTH = 64;

export function PitchRuler(props: { scale: PitchScale; height: number }) {
  const { t1 } = usei18n()!;
  const { config, setConfig, setPitchRulerEnabled } = useConfigStore()!;
  const densityAware = () =>
    config.ui.density_aware_pitch_scale ?? DEFAULT_DENSITY_AWARE_PITCH_SCALE;
  const ticks = createMemo(() => {
    const { min, max, toPosition } = props.scale;
    const span = max - min;
    if (span <= 0) return [];
    const magnitude = 10 ** Math.floor(Math.log10(span / 20));
    const step =
      [1, 2, 5, 10].find((n) => n * magnitude >= span / 20)! * magnitude;
    const values = [min];
    for (
      let n = Math.floor((min + step * 1e-6) / step) + 1;
      n * step < max - step * 1e-6;
      n++
    ) {
      values.push(n * step);
    }
    values.push(max);
    let previousLabel = 0;
    return values.map((pitch, index) => {
      const position = toPosition(pitch);
      const pixels = position * props.height;
      const first = index === 0;
      const last = index === values.length - 1;
      const labeled =
        first ||
        last ||
        (pixels - previousLabel >= 24 && props.height - pixels >= 24);
      if (labeled) previousLabel = pixels;
      return {
        pitch: Number(pitch.toFixed(3)),
        position,
        labeled,
        first,
        last,
      };
    });
  });

  return (
    <ContextMenu>
      <ContextMenu.Trigger
        role="group"
        aria-label={t1("config.pitch_scale")}
        class={styles.ruler}
        style={{
          height: `${props.height}px`,
          width: `${PITCH_RULER_WIDTH}px`,
        }}
      >
        <For each={ticks()}>
          {(tick) => (
            <span
              class={styles.tick}
              classList={{ [styles.minor]: !tick.labeled }}
              style={{ bottom: `${tick.position * 100}%` }}
              data-pitch={tick.pitch}
            >
              <Show when={tick.labeled}>
                <span
                  class={styles.label}
                  style={{
                    transform: `translateY(${tick.first ? 0 : tick.last ? 100 : 50}%)`,
                  }}
                >
                  {tick.pitch}
                </span>
              </Show>
            </span>
          )}
        </For>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="z-50 bg-slate-1 dark:bg-slate-7 p-1 outline-none rounded-md ring-1 ring-slate-3 dark:ring-slate-5 shadow-xl">
          <ContextMenu.CheckboxItem
            class={styles.menu_item}
            checked={densityAware()}
            closeOnSelect
            onChange={(checked) =>
              setConfig("ui", "density_aware_pitch_scale", checked)
            }
          >
            <ContextMenu.ItemIndicator class="size-4 flex items-center justify-center">
              <div class="i-lucide:check size-4" />
            </ContextMenu.ItemIndicator>
            <ContextMenu.ItemLabel>
              {t1("config.pitch_scale_density")}
            </ContextMenu.ItemLabel>
          </ContextMenu.CheckboxItem>
          <ContextMenu.Item
            class={styles.menu_item}
            onSelect={() => setPitchRulerEnabled(false)}
          >
            <ContextMenu.ItemLabel>
              {t1("menu.hide_pitch_ruler")}
            </ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
