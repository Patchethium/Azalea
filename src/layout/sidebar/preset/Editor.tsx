import { INPUT_CLASS } from "@components/textField";
import type { Preset } from "$binding";
import { IconButton } from "@components/iconButton";
import { NumberInput } from "@components/numberField";
import { Tooltip } from "@components/tooltip";
import { useMetaStore } from "@contexts/meta";
import { usei18n } from "@contexts/i18n";
import { findPresetStyle, styleIdentityPatch } from "@contexts/text";
import { SpeakerSelectionDialog } from "@dialogs/SpeakerSelection";
import { TextField } from "@kobalte/core/text-field";
import { OptionSelector, PresetSlider } from "@layout/sidebar/preset/Fields";
import { createMemo, createSignal } from "solid-js";

/** Edits every field of a preset, reporting each change as a partial patch. */
export function PresetEditor(props: {
  preset: Preset;
  onChange: (patch: Partial<Preset>) => void;
}) {
  const { t1 } = usei18n()!;
  const { metas } = useMetaStore()!;
  const [speakerSelectionOpen, setSpeakerSelectionOpen] = createSignal(false);
  const identity = createMemo(() => findPresetStyle(props.preset, metas));
  const setStyleId = (styleId: number) => {
    const patch = styleIdentityPatch(styleId, metas);
    if (patch !== null) props.onChange(patch);
  };

  return (
    <>
      <div class="w-full h-1" />
      <span class="text-sm select-none cursor-default">
        {t1("preset.name")}
      </span>
      <TextField
        class="w-full"
        value={props.preset.name}
        onChange={(name) => props.onChange({ name })}
      >
        <TextField.Input
          placeholder={t1("preset.placeholder_name")}
          class={`h-8 text-sm ${INPUT_CLASS}`}
        />
      </TextField>
      <OptionSelector
        name={t1("preset.speaker")}
        options={metas.map((meta) => meta.name)}
        value={identity()?.speaker.name ?? ""}
        onChange={(name) => {
          const speaker = metas.find((meta) => meta.name === name);
          if (speaker?.styles[0]) setStyleId(speaker.styles[0].id);
        }}
        optionLang="ja"
        action={
          <IconButton
            icon="i-lucide:layout-grid"
            iconSize="sm"
            label={t1("speaker_selection.open")}
            size="lg"
            class="b b-slate-2 dark:b-slate-6"
            onClick={() => setSpeakerSelectionOpen(true)}
          />
        }
      />
      <OptionSelector
        name={t1("preset.style")}
        options={identity()?.speaker.styles.map((style) => style.name) ?? []}
        value={identity()?.style.name ?? ""}
        onChange={(name) => {
          const style = identity()?.speaker.styles.find(
            (candidate) => candidate.name === name,
          );
          if (style) setStyleId(style.id);
        }}
        optionLang="ja"
      />
      <PresetSlider
        name={t1("preset.speed")}
        min={50}
        max={200}
        step={1}
        appendix="%"
        value={props.preset.speed}
        setValue={(speed) => props.onChange({ speed })}
      />
      <PresetSlider
        name={t1("preset.pitch")}
        min={-0.5}
        max={0.5}
        step={0.01}
        value={props.preset.pitch}
        setValue={(pitch) => props.onChange({ pitch })}
      />
      <PresetSlider
        name={t1("preset.intonation")}
        min={0}
        max={2}
        step={0.01}
        value={props.preset.intonation}
        setValue={(intonation) => props.onChange({ intonation })}
      />
      <PresetSlider
        name={t1("preset.volume")}
        min={0}
        max={2}
        step={0.01}
        value={props.preset.volume}
        setValue={(volume) => props.onChange({ volume })}
      />
      <div class="flex flex-row gap2">
        <Tooltip content="in millisecond" class="min-w-0 flex-1">
          <NumberInput
            label={t1("preset.start_sli")}
            value={props.preset.start_slience}
            setValue={(start_slience) => props.onChange({ start_slience })}
            min={0}
            max={1500}
            step={100}
          />
        </Tooltip>
        <Tooltip content="in millisecond" class="min-w-0 flex-1">
          <NumberInput
            label={t1("preset.end_sli")}
            value={props.preset.end_slience}
            setValue={(end_slience) => props.onChange({ end_slience })}
            min={0}
            max={1500}
            step={100}
          />
        </Tooltip>
      </div>
      <div class="h-2 w-full" />
      <SpeakerSelectionDialog
        open={speakerSelectionOpen()}
        onOpenChange={setSpeakerSelectionOpen}
        speakers={metas}
        selectedSpeakerUuid={identity()?.speaker.speaker_uuid ?? null}
        onSelect={(speaker) => {
          setStyleId(speaker.styles[0].id);
          setSpeakerSelectionOpen(false);
        }}
      />
    </>
  );
}
