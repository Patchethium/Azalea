import { type AccentPhrase, commands } from "$binding";
import { AccentPhraseItem } from "@layout/bottomPanel/AccentPhraseItem";
import { debounce } from "@solid-primitives/scheduled";
import { createMemo, For, onCleanup, Show } from "solid-js";
import { produce } from "solid-js/store";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { findPresetById, findPresetStyle, useTextStore } from "@contexts/text";
import { useSideEffect } from "$utils";

export function PhonemePanel() {
  const { t1 } = usei18n()!;
  const {
    textStore,
    setTextStore,
    markQueryModified,
    projectPresetStore,
    selectedTextBlock,
    selectedTextBlockIndex,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const currentText = selectedTextBlock;
  const selectedIdx = () =>
    currentText() === null ? null : selectedTextBlockIndex();
  const currentPreset = createMemo(() => {
    const preset = findPresetById(projectPresetStore, currentText()?.preset_id);
    return preset !== null && findPresetStyle(preset, metas) !== null
      ? preset
      : null;
  });

  const setPhrase = (index: number, phrase: AccentPhrase) => {
    const textIndex = selectedIdx();
    if (textIndex === null) return;
    setTextStore(textIndex, "query", "accent_phrases", index, phrase);
    markQueryModified(textIndex);
  };
  const refreshMoraData = debounce(async () => {
    const sourceBlock = currentText();
    const textIndex = sourceBlock === null ? null : selectedTextBlockIndex();
    const phrases = sourceBlock?.query?.accent_phrases;
    const preset = currentPreset();
    if (textIndex === null || !phrases || !preset) return;
    const result = await commands.replaceMora(phrases, preset.style_id);
    if (result.status === "ok" && textStore[textIndex] === sourceBlock) {
      setTextStore(textIndex, "query", "accent_phrases", result.data);
      markQueryModified(textIndex);
    }
  }, 300);
  onCleanup(() => refreshMoraData.clear());

  const splitPhrase = useSideEffect(
    (phraseIndex: number, moraIndex: number) => {
      const textIndex = selectedIdx();
      const phrases = currentText()?.query?.accent_phrases;
      if (textIndex === null || phrases == null) {
        console.error("No accent phrases to split");
        return;
      }
      if (moraIndex <= 0 || moraIndex >= phrases[phraseIndex].moras.length) {
        console.error("Invalid mora index to split");
        return;
      }
      const leftPhrase = {
        ...phrases[phraseIndex],
        moras: phrases[phraseIndex].moras.slice(0, moraIndex),
        accent: 1,
        pause_mora: null,
      };
      const rightPhrase = {
        ...phrases[phraseIndex],
        moras: phrases[phraseIndex].moras.slice(moraIndex),
        accent: 1,
      };
      setTextStore(
        textIndex,
        "query",
        "accent_phrases",
        produce((draft) => {
          draft.splice(phraseIndex, 1, leftPhrase, rightPhrase);
        }),
      );
      markQueryModified(textIndex);
    },
    refreshMoraData,
  );

  const combinePhrase = useSideEffect((phraseIndex: number) => {
    const textIndex = selectedIdx();
    const phrases = currentText()?.query?.accent_phrases;
    if (textIndex === null || phrases == null) {
      console.error("No accent phrases to combine");
      return;
    }
    if (phraseIndex < 0 || phraseIndex >= phrases.length - 1) {
      console.error("Invalid accent phrase index to combine");
      return;
    }
    const left = phrases[phraseIndex];
    const right = phrases[phraseIndex + 1];
    const combinedPhrase = {
      ...left,
      moras: left.moras.concat(right.moras),
      accent: 1,
      pause_mora: right.pause_mora,
    };
    setTextStore(
      textIndex,
      "query",
      "accent_phrases",
      produce((draft) => {
        draft.splice(phraseIndex, 2, combinedPhrase);
      }),
    );
    markQueryModified(textIndex);
  }, refreshMoraData);

  const handleEditPhoneme = async (phraseIndex: number, newText: string) => {
    const sourceBlock = currentText();
    const textIndex = sourceBlock === null ? null : selectedTextBlockIndex();
    const query = sourceBlock?.query;
    const preset = currentPreset();
    if (textIndex === null || query == null || preset === null) return;
    const sourcePhrase = query.accent_phrases[phraseIndex];
    if (sourcePhrase === undefined) return;
    const result = await commands.accentPhrases(newText, preset.style_id);
    if (result.status !== "ok" || result.data.length === 0) return;
    const replacementPhrases = result.data.map((phrase) => ({ ...phrase }));
    const finalReplacement = replacementPhrases[replacementPhrases.length - 1];
    finalReplacement.pause_mora = sourcePhrase.pause_mora;
    finalReplacement.is_interrogative = sourcePhrase.is_interrogative;
    if (textStore[textIndex] !== sourceBlock) return;
    setTextStore(
      textIndex,
      "query",
      "accent_phrases",
      produce((draft) => {
        draft.splice(phraseIndex, 1, ...replacementPhrases);
      }),
    );
    markQueryModified(textIndex);
  };

  const queryExists = () => {
    const query = currentText()?.query;
    return (
      query !== null && query !== undefined && query.accent_phrases.length > 0
    );
  };
  return (
    <div class="size-full relative flex flex-row left-0 top-0 overflow-x-auto overflow-y-hidden cursor-default p-2">
      <Show
        when={queryExists()}
        fallback={
          <div class="flex size-full items-center justify-center select-none cursor-default">
            {t1("bottom.no_query")}
          </div>
        }
      >
        <For each={currentText()?.query?.accent_phrases}>
          {(phrase, index) => (
            <AccentPhraseItem
              phrase={phrase}
              setPhrase={(value) => setPhrase(index(), value)}
              refreshMoraData={refreshMoraData}
              onSplit={(moraIndex) => splitPhrase(index(), moraIndex)}
              onCombine={() => combinePhrase(index())}
              onEdit={(text) => handleEditPhoneme(index(), text)}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
