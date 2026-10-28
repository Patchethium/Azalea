import { type Sortable, SortableHandle } from "@components/sortable";
import { useMetaStore } from "@contexts/meta";
import { usei18n } from "@contexts/i18n";
import { findPresetStyle, useTextStore } from "@contexts/text";
import { createMemo, createSignal, type JSX, splitProps } from "solid-js";

interface PresetCardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  presetIndex: number;
  selected: boolean;
  sortable: Sortable;
}

export function PresetCard(props: PresetCardProps) {
  const [local, divProps] = splitProps(props, [
    "presetIndex",
    "selected",
    "sortable",
  ]);
  const { t1 } = usei18n()!;
  const [hovered, setHovered] = createSignal(false);
  const { metas } = useMetaStore()!;
  const { projectPresetStore } = useTextStore()!;
  const preset = createMemo(
    () => projectPresetStore[local.presetIndex] ?? null,
  );
  const identity = createMemo(() => {
    const value = preset();
    return value === null ? null : findPresetStyle(value, metas);
  });

  return (
    <div
      class="p1 group/card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...divProps}
    >
      <div
        class="flex rounded-r-md p1 pl2 group-hover/card:bg-hover overflow-hidden bg-surface border-l-2 border-border cursor-default select-none w-full min-h-[fit-content] group-active/card:bg-surface"
        classList={{
          "shadow-md group-hover/card:bg-surface !border-accent":
            local.selected,
        }}
      >
        <div class="min-w-0 flex-1 flex flex-col">
          <div class="flex items-center gap1">
            <div class="min-w-0 flex-1 truncate">
              {preset()?.name || t1("preset.placeholder_name")}
            </div>
            <SortableHandle
              sortable={local.sortable}
              index={local.presetIndex}
              label={t1("preset.controls.reorder")}
              visible={hovered()}
              class="text-ink-faint"
            />
          </div>
          <div class="text-xs text-ink-subtle flex flex-row items-center">
            {identity()?.speaker.name}
            <span class="mx-1">{">"}</span>
            {identity()?.style.name}
          </div>
        </div>
      </div>
    </div>
  );
}
