import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { findPresetById, findPresetStyle, useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import { createMemo } from "solid-js";

export function useQueryReset() {
  const { t1 } = usei18n()!;
  const {
    projectPresetStore,
    selectedTextBlock,
    selectedTextBlockIndex,
    resetQueryEdits,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { uiStore } = useUIStore()!;

  const currentPreset = createMemo(() => {
    const preset = findPresetById(
      projectPresetStore,
      selectedTextBlock()?.preset_id,
    );
    return preset !== null && findPresetStyle(preset, metas) !== null
      ? preset
      : null;
  });
  const canReset = createMemo(
    () =>
      selectedTextBlock()?.query_is_modified === true &&
      currentPreset() !== null,
  );
  const resetLabel = () =>
    t1(
      uiStore.bottomPanel === "accent"
        ? "bottom.reset_accent_edits"
        : "bottom.reset_tuning_edits",
    );

  // Resetting discards every manual query edit (accent, pitch, and duration)
  // and regenerates the query from the text. Nulling the query also clears
  // `query_is_modified`, which re-enables the pitch-noise seed controls.
  const resetEdits = () => {
    const block = selectedTextBlock();
    if (
      block === null ||
      block.query === null ||
      !block.query_is_modified ||
      currentPreset() === null
    ) {
      return;
    }
    resetQueryEdits(selectedTextBlockIndex());
  };

  return { canReset, resetEdits, resetLabel };
}
