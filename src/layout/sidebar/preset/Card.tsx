import { useMetaStore } from "@contexts/meta";
import { usei18n } from "@contexts/i18n";
import { findPresetStyle, useTextStore } from "@contexts/text";
import { createMemo, type JSX } from "solid-js";

interface PresetCardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  presetIndex: number;
  selected: boolean;
}

export function PresetCard(props: PresetCardProps) {
  const { t1 } = usei18n()!;
  const { metas } = useMetaStore()!;
  const { projectPresetStore } = useTextStore()!;
  const preset = createMemo(
    () => projectPresetStore[props.presetIndex] ?? null,
  );
  const identity = createMemo(() => {
    const value = preset();
    return value === null ? null : findPresetStyle(value, metas);
  });

  return (
    <div class="p1 group" {...props}>
      <div
        class="items-start rounded-r-md p1 group-hover:bg-slate-2 dark:group-hover:bg-slate-7 overflow-hidden bg-white dark:bg-slate-8 border-l-2 border-slate-1 dark:border-slate-7
        cursor-default select-none w-full min-h-[fit-content] group-active:bg-white dark:group-active:bg-slate-8 flex flex-col"
        classList={{
          "shadow-md group-hover:bg-white dark:group-hover:bg-slate-8 !border-primary-5":
            props.selected,
        }}
      >
        <div>{preset()?.name || t1("preset.placeholder_name")}</div>
        <div class="text-xs text-slate-5 flex flex-row items-center">
          {identity()?.speaker.name}
          <span class="mx-1">{">"}</span>
          {identity()?.style.name}
        </div>
      </div>
    </div>
  );
}
