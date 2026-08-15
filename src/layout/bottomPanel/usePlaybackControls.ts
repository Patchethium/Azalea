import { commands } from "$binding";
import type {
  PlaybackSequence,
  WaveformSynthesisNotice,
} from "@layout/bottomPanel/types";
import { listen } from "@tauri-apps/api/event";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { unwrap } from "solid-js/store";
import { useConfigStore } from "@contexts/config";
import { useMetaStore } from "@contexts/meta";
import { useSystemStore } from "@contexts/system";
import { findPresetStyle, useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import {
  isPlaybackShortcutAllowed,
  isPlaybackToggleAllowed,
  matchesShortcut,
  resolveShortcut,
} from "../../shortcuts";
import { getModifiedQuery } from "$utils";

export function usePlaybackControls(
  onWaveformSynthesized: (notice: WaveformSynthesisNotice) => void,
) {
  const {
    textStore,
    projectPresetStore,
    selectedTextBlock,
    selectedTextBlockIndex,
    insertTextBlockBelow,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { setUIStore } = useUIStore()!;
  const { config } = useConfigStore()!;
  const { systemStore } = useSystemStore()!;
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [playRequestPending, setPlayRequestPending] = createSignal(false);
  let playbackShortcutFocus: HTMLElement | null = null;
  let activePlaybackSequence: PlaybackSequence | null = null;

  const clearPlaybackShortcutFocus = () => {
    playbackShortcutFocus?.removeAttribute("data-playback-shortcut-focus");
    playbackShortcutFocus = null;
  };

  const suppressPlaybackShortcutFocus = () => {
    clearPlaybackShortcutFocus();
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === document.body) return;
    focused.setAttribute("data-playback-shortcut-focus", "");
    playbackShortcutFocus = focused;
  };

  const queryExists = () => {
    const query = selectedTextBlock()?.query;
    return (
      query !== null && query !== undefined && query.accent_phrases.length > 0
    );
  };
  const prevExists = createMemo(
    () => selectedTextBlockIndex() > 0 && textStore.length > 1,
  );
  const nextExists = createMemo(
    () =>
      selectedTextBlockIndex() < textStore.length - 1 && textStore.length > 1,
  );

  const focusNext = (expectedBlockId?: string, createIfMissing = false) => {
    const index = selectedTextBlockIndex();
    if (
      expectedBlockId !== undefined &&
      textStore[index]?.id !== expectedBlockId
    ) {
      return;
    }
    if (index < textStore.length - 1) {
      setUIStore("selectedTextBlockIndex", index + 1);
    } else if (createIfMissing) {
      insertTextBlockBelow(index);
    }
  };

  const focusPrev = () => {
    const index = selectedTextBlockIndex();
    if (index > 0) setUIStore("selectedTextBlockIndex", index - 1);
  };

  const currentPreset = createMemo(() => {
    const presetId = selectedTextBlock()?.preset_id;
    if (projectPresetStore.length === 0 || presetId == null) return null;
    const preset = projectPresetStore[presetId];
    return preset !== undefined && findPresetStyle(preset, metas) !== null
      ? preset
      : null;
  });
  const canPlay = () => queryExists() && currentPreset() !== null;

  const focusSequenceItem = (itemIndex: number) => {
    const sequence = activePlaybackSequence;
    if (
      sequence === null ||
      !Number.isInteger(itemIndex) ||
      itemIndex < 0 ||
      itemIndex >= sequence.items.length ||
      (sequence.lastStartedIndex !== null &&
        itemIndex <= sequence.lastStartedIndex)
    ) {
      return;
    }
    sequence.lastStartedIndex = itemIndex;
    const item = sequence.items[itemIndex];
    const blockIndex = textStore.findIndex(
      (block) => block.id === item.blockId,
    );
    if (blockIndex !== -1) {
      setUIStore("selectedTextBlockIndex", blockIndex);
      onWaveformSynthesized(item);
    }
  };

  const stop = async () => {
    activePlaybackSequence = null;
    const result = await commands.stopAudio();
    if (result.status === "error")
      console.error("Failed to stop audio:", result.error);
    else setIsPlaying(false);
  };

  const speak = async () => {
    const block = selectedTextBlock();
    const preset = unwrap(currentPreset());
    if (block === null || preset == null || !queryExists()) return null;
    if (playRequestPending()) return null;
    setPlayRequestPending(true);
    try {
      if (isPlaying()) await stop();
      activePlaybackSequence = null;
      const audioQuery = getModifiedQuery(unwrap(block.query!), preset);
      const result = await commands.playAudio(audioQuery, preset.style_id);
      if (result.status === "ok") {
        setIsPlaying(true);
        onWaveformSynthesized({
          blockId: block.id,
          audioQuery,
          speakerId: preset.style_id,
        });
        return block.id;
      }
      console.error("Failed to play audio:", result.error);
      return null;
    } finally {
      setPlayRequestPending(false);
    }
  };

  const togglePlayback = () => (isPlaying() ? stop() : speak());

  onMount(() => {
    let disposed = false;
    let unlistenPlaybackFinished: (() => void) | undefined;
    let unlistenSequenceItemStarted: (() => void) | undefined;
    void listen("audio-playback-finished", () => {
      activePlaybackSequence = null;
      setIsPlaying(false);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenPlaybackFinished = unlisten;
    });
    void listen<number>("audio-sequence-item-started", ({ payload }) => {
      focusSequenceItem(payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenSequenceItemStarted = unlisten;
    });
    onCleanup(() => {
      disposed = true;
      unlistenPlaybackFinished?.();
      unlistenSequenceItemStarted?.();
      activePlaybackSequence = null;
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const playbackShortcutAllowed = isPlaybackShortcutAllowed(event);
      const playbackToggleAllowed = isPlaybackToggleAllowed(event);
      if (!playbackShortcutAllowed && !playbackToggleAllowed) return;
      const shortcuts = config.ui_config.shortcuts;
      const togglePlaybackShortcut =
        playbackToggleAllowed &&
        matchesShortcut(
          event,
          resolveShortcut(shortcuts, "toggle_playback"),
          systemStore.os,
        );
      const playAndStay = matchesShortcut(
        event,
        resolveShortcut(shortcuts, "play_current"),
        systemStore.os,
      );
      const playAndAdvance = matchesShortcut(
        event,
        resolveShortcut(shortcuts, "play_next"),
        systemStore.os,
      );
      if (togglePlaybackShortcut) {
        if (!isPlaying() && !canPlay()) return;
        event.preventDefault();
        event.stopPropagation();
        suppressPlaybackShortcutFocus();
        void togglePlayback();
      } else if (playbackShortcutAllowed && playAndStay) {
        clearPlaybackShortcutFocus();
        event.preventDefault();
        event.stopPropagation();
        void speak();
      } else if (playbackShortcutAllowed && playAndAdvance) {
        clearPlaybackShortcutFocus();
        event.preventDefault();
        event.stopPropagation();
        void speak().then((startedBlockId) => {
          if (!disposed && startedBlockId !== null) {
            focusNext(startedBlockId, true);
          }
        });
      } else {
        clearPlaybackShortcutFocus();
      }
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (event.target === playbackShortcutFocus) clearPlaybackShortcutFocus();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("focusout", handleFocusOut, true);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("focusout", handleFocusOut, true);
      clearPlaybackShortcutFocus();
    });
  });

  const playableFromSelection = createMemo(() =>
    textStore.slice(selectedTextBlockIndex()).flatMap((block) => {
      const preset =
        block.preset_id === null ? null : projectPresetStore[block.preset_id];
      if (
        block.query === null ||
        block.query.accent_phrases.length === 0 ||
        preset === undefined ||
        preset === null ||
        findPresetStyle(preset, metas) === null
      ) {
        return [];
      }
      return [
        {
          blockId: block.id,
          audioQuery: getModifiedQuery(unwrap(block.query), unwrap(preset)),
          speakerId: preset.style_id,
        },
      ];
    }),
  );

  const speakAllFromSelection = async () => {
    if (playRequestPending()) return;
    setPlayRequestPending(true);
    try {
      if (isPlaying()) await stop();
      const playable = playableFromSelection();
      if (playable.length === 0) return;
      const sequence: PlaybackSequence = {
        items: playable,
        lastStartedIndex: null,
      };
      activePlaybackSequence = sequence;
      const result = await commands.playAudioSequence(
        playable.map((item) => ({
          audio_query: item.audioQuery,
          speaker_id: item.speakerId,
        })),
      );
      if (result.status === "error") {
        if (activePlaybackSequence === sequence) activePlaybackSequence = null;
        console.error("Failed to play audio sequence:", result.error);
      } else if (activePlaybackSequence === sequence) {
        setIsPlaying(true);
        if (sequence.lastStartedIndex === null) focusSequenceItem(0);
      }
    } finally {
      setPlayRequestPending(false);
    }
  };

  return {
    isPlaying,
    playRequestPending,
    prevExists,
    nextExists,
    canPlay,
    focusPrev,
    focusNext,
    togglePlayback,
    playableFromSelection,
    speakAllFromSelection,
  };
}
