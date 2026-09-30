import { type AccentPhrase, commands } from "$binding";
import { AccentPhraseItem } from "@layout/bottomPanel/AccentPhraseItem";
import { debounce } from "@solid-primitives/scheduled";
import {
  batch,
  createEffect,
  createMemo,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { produce, unwrap } from "solid-js/store";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { findPresetById, findPresetStyle, useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";

export function PhonemePanel() {
  const { t1 } = usei18n()!;
  const {
    textStore,
    setTextStore,
    markQueryAccentModified,
    projectPresetStore,
    selectedTextBlock,
    selectedTextBlockIndex,
    beginQueryUpdate,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  let scrollAreaRef!: HTMLDivElement;
  const currentText = selectedTextBlock;
  const selectedIdx = () =>
    currentText() === null ? null : selectedTextBlockIndex();
  const currentPreset = createMemo(() => {
    const preset = findPresetById(projectPresetStore, currentText()?.preset_id);
    return preset !== null && findPresetStyle(preset, metas) !== null
      ? preset
      : null;
  });

  type AccentRequest = {
    block: NonNullable<ReturnType<typeof currentText>>;
    index: number;
    styleId: number;
    phrases: AccentPhrase[];
    signature: string;
    update: ReturnType<typeof beginQueryUpdate>;
  };
  const sourceSignature = createMemo(() =>
    JSON.stringify([
      currentText(),
      currentPreset()?.id,
      currentPreset()?.style_id,
    ]),
  );
  let activeRequest: AccentRequest | null = null;
  const finishRequest = (request: AccentRequest) => {
    if (activeRequest !== request) return;
    activeRequest = null;
    request.update.finish();
  };
  const cancelRequest = () => {
    scheduledMoraRefresh.clear();
    if (activeRequest) finishRequest(activeRequest);
  };
  const beginRequest = (): AccentRequest | null =>
    batch(() => {
      cancelRequest();
      const block = currentText();
      const preset = currentPreset();
      if (block?.query == null || preset === null) return null;
      const request = {
        block,
        index: selectedTextBlockIndex(),
        styleId: preset.style_id,
        phrases: structuredClone(unwrap(block.query.accent_phrases)),
        signature: sourceSignature(),
        update: beginQueryUpdate(block.id),
      };
      activeRequest = request;
      return request;
    });
  const applyPhrases = (request: AccentRequest, phrases: AccentPhrase[]) => {
    if (
      activeRequest !== request ||
      !request.update.isCurrent() ||
      sourceSignature() !== request.signature ||
      textStore[request.index] !== request.block
    )
      return;
    batch(() => {
      finishRequest(request);
      setTextStore(request.index, "query", "accent_phrases", phrases);
      markQueryAccentModified(request.index);
    });
  };
  const scheduledMoraRefresh = debounce(async (request: AccentRequest) => {
    try {
      const result = await commands.replaceMora(
        request.phrases,
        request.styleId,
        request.block.pitch_noise_seed,
      );
      if (result.status === "ok") applyPhrases(request, result.data);
      else console.error("Failed to refresh mora data:", result.error);
    } catch (error) {
      console.error("Failed to refresh mora data:", error);
    } finally {
      finishRequest(request);
    }
  }, 300);
  const refreshMoraData = () => {
    const request = beginRequest();
    if (request) scheduledMoraRefresh(request);
  };
  createEffect(() => {
    const signature = sourceSignature();
    if (activeRequest && signature !== activeRequest.signature) cancelRequest();
  });
  onCleanup(cancelRequest);

  const setPhrase = (index: number, phrase: AccentPhrase) => {
    const textIndex = selectedIdx();
    if (textIndex === null) return;
    batch(() => {
      setTextStore(textIndex, "query", "accent_phrases", index, phrase);
      markQueryAccentModified(textIndex);
      refreshMoraData();
    });
  };

  const splitPhrase = (phraseIndex: number, moraIndex: number) => {
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
    batch(() => {
      setTextStore(
        textIndex,
        "query",
        "accent_phrases",
        produce((draft) => {
          draft.splice(phraseIndex, 1, leftPhrase, rightPhrase);
        }),
      );
      markQueryAccentModified(textIndex);
      refreshMoraData();
    });
  };

  const combinePhrase = (phraseIndex: number) => {
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
    batch(() => {
      setTextStore(
        textIndex,
        "query",
        "accent_phrases",
        produce((draft) => {
          draft.splice(phraseIndex, 2, combinedPhrase);
        }),
      );
      markQueryAccentModified(textIndex);
      refreshMoraData();
    });
  };

  const handleEditPhoneme = async (phraseIndex: number, newText: string) => {
    if (!currentText()?.query?.accent_phrases[phraseIndex]) return;
    const request = beginRequest();
    if (!request) return;
    try {
      const result = await commands.accentPhrases(
        newText,
        request.styleId,
        request.block.pitch_noise_seed,
      );
      if (result.status !== "ok" || result.data.length === 0) return;
      const sourcePhrase = request.phrases[phraseIndex];
      const replacementPhrases = result.data.map((phrase) => ({ ...phrase }));
      const finalReplacement =
        replacementPhrases[replacementPhrases.length - 1];
      finalReplacement.pause_mora = sourcePhrase.pause_mora;
      finalReplacement.is_interrogative = sourcePhrase.is_interrogative;
      request.phrases.splice(phraseIndex, 1, ...replacementPhrases);
      applyPhrases(request, request.phrases);
    } catch (error) {
      console.error("Failed to edit accent phrase:", error);
    } finally {
      finishRequest(request);
    }
  };

  const queryExists = () => {
    const query = currentText()?.query;
    return (
      query !== null && query !== undefined && query.accent_phrases.length > 0
    );
  };
  createEffect(() => {
    const scrollLeft = uiStore.bottom_scroll_pos;
    if (scrollAreaRef.scrollLeft !== scrollLeft) {
      scrollAreaRef.scrollLeft = scrollLeft;
    }
  });
  return (
    <div
      ref={(element) => {
        scrollAreaRef = element;
      }}
      class="size-full relative flex flex-row left-0 top-0 overflow-x-auto overflow-y-hidden cursor-default p-2"
      data-bottom-panel-scroll="accent"
      onScroll={(event) => {
        const scrollLeft = event.currentTarget.scrollLeft;
        if (uiStore.bottom_scroll_pos !== scrollLeft) {
          setUIStore("bottom_scroll_pos", scrollLeft);
        }
      }}
    >
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
