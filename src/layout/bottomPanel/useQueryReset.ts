import { commands } from "$binding";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { findPresetById, findPresetStyle, useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import { batch, createMemo, createSignal } from "solid-js";
import { unwrap } from "solid-js/store";

export function useQueryReset() {
  const { t1 } = usei18n()!;
  const {
    textStore,
    setTextStore,
    markQueryModified,
    projectPresetStore,
    selectedTextBlock,
    selectedTextBlockIndex,
    resetQueryEdits,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { uiStore } = useUIStore()!;
  const [resetPending, setResetPending] = createSignal(false);
  let resetRevision = 0;

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
      currentPreset() !== null &&
      !resetPending(),
  );
  const resetLabel = () =>
    t1(
      uiStore.bottomPanel === "accent"
        ? "bottom.reset_accent_edits"
        : "bottom.reset_tuning_edits",
    );

  const resetEdits = async () => {
    const block = selectedTextBlock();
    const preset = currentPreset();
    const index = selectedTextBlockIndex();
    if (
      block === null ||
      block.query === null ||
      preset === null ||
      !block.query_is_modified ||
      resetPending()
    ) {
      return;
    }
    if (uiStore.bottomPanel === "accent") {
      resetQueryEdits(index);
      return;
    }
    const phrases = structuredClone(unwrap(block.query.accent_phrases));
    const seed = block.pitch_noise_seed;
    const revision = ++resetRevision;
    setResetPending(true);
    try {
      const result = await commands.replaceMora(phrases, preset.style_id, seed);
      if (revision !== resetRevision) return;
      if (result.status === "error") {
        console.error(
          "Failed to reset pitch and duration edits:",
          result.error,
        );
        return;
      }
      const current = textStore[index];
      if (
        current?.id !== block.id ||
        current.pitch_noise_seed !== seed ||
        JSON.stringify(current.query?.accent_phrases) !==
          JSON.stringify(phrases)
      ) {
        return;
      }
      batch(() => {
        setTextStore(index, "query", "accent_phrases", result.data);
        markQueryModified(index);
      });
    } finally {
      if (revision === resetRevision) setResetPending(false);
    }
  };

  return { canReset, resetEdits, resetLabel };
}
