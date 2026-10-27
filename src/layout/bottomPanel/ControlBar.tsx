import { Separator } from "@kobalte/core/separator";
import { Tooltip } from "@components/tooltip";
import { NumberField } from "@components/numberField";
import { ToolbarButton } from "@components/toolbarButton";
import { useConfigStore } from "@contexts/config";
import { useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import { useShortcutsStore } from "@contexts/shortcuts";
import { PlaybackTimeline } from "@layout/bottomPanel/PlaybackTimeline";
import { TuningMenu } from "@layout/bottomPanel/tuning/TuningMenu";
import type { WaveformSynthesisNotice } from "@layout/bottomPanel/types";
import { usePlaybackControls } from "@layout/bottomPanel/usePlaybackControls";
import { useQueryReset } from "@layout/bottomPanel/useQueryReset";
import { usei18n } from "@contexts/i18n";
import { onCleanup, onMount, Show } from "solid-js";

export function ControlBar(props: {
  disabled?: boolean;
  onWaveformSynthesized: (notice: WaveformSynthesisNotice) => void;
}) {
  const { t1 } = usei18n()!;
  const {
    playbackTimelineEnabled,
    pitchNoiseActive,
    pitchCompletionAvailable,
    pitchCompletionActive,
    togglePitchCompletionLock,
  } = useConfigStore()!;
  const {
    matchesShortcut,
    formatShortcut,
    isApplicationShortcutAllowed,
    isPlaybackToggleAllowed,
  } = useShortcutsStore()!;
  const {
    selectedTextBlock,
    selectedTextBlockIndex,
    setTextStore,
    commitPitchNoiseSeed,
    canStepSeedHistory,
    stepSeedHistory,
    canStepPostHistory,
    stepPostHistory,
  } = useTextStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const controls = usePlaybackControls(
    props.onWaveformSynthesized,
    () => props.disabled ?? false,
  );
  const { canReset, resetEdits, resetLabel } = useQueryReset();
  // Undo and redo step through the post edits while the post tab is shown,
  // leaving text fields their own undo.
  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        props.disabled ||
        uiStore.page !== null ||
        uiStore.bottomPanel !== "post" ||
        !isPlaybackToggleAllowed(event)
      )
        return;
      const direction = matchesShortcut(event, "undo")
        ? "undo"
        : matchesShortcut(event, "redo")
          ? "redo"
          : null;
      if (direction === null) return;
      event.preventDefault();
      stepPostHistory(selectedTextBlockIndex(), direction);
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });
  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        props.disabled ||
        uiStore.page !== null ||
        !pitchCompletionAvailable() ||
        !isApplicationShortcutAllowed(event) ||
        !matchesShortcut(event, "toggle_pitch_completion")
      )
        return;
      event.preventDefault();
      togglePitchCompletionLock();
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });
  // The tuning panel is orthogonal to the accent panel: the noise seed
  // controls track only duration and pitch edits.
  const tuningModified = () => {
    const block = selectedTextBlock();
    return (
      block !== null &&
      (block.duration_is_modified === true || block.pitch_is_modified === true)
    );
  };

  return (
    <div class="w-full flex flex-col b-b b-slate-3 dark:b-slate-6 select-none">
      <div class="h-8 w-full flex m-l-auto flex-row items-center justify-center">
        <div class="flex-1" />
        <ToolbarButton
          icon="i-lucide:skip-back"
          label={t1("bottom.previous")}
          onClick={controls.focusPrev}
          disabled={!controls.prevExists()}
        />
        <ToolbarButton
          icon={
            controls.playRequestPending()
              ? "i-lucide:loader-circle animate-spin"
              : controls.isPlaying()
                ? "i-lucide:square"
                : "i-lucide:play"
          }
          label={
            controls.playRequestPending()
              ? t1("loading")
              : t1(controls.isPlaying() ? "bottom.stop" : "bottom.play")
          }
          ariaBusy={controls.playRequestPending()}
          onClick={controls.togglePlayback}
          disabled={
            controls.playRequestPending() ||
            (!controls.isPlaying() && !controls.canPlay())
          }
        />
        <ToolbarButton
          icon="i-lucide:skip-forward"
          label={t1("bottom.next")}
          onClick={() => controls.focusNext()}
          disabled={!controls.nextExists()}
        />
        <div class="flex flex-1 items-center justify-end">
          <Show
            when={
              pitchCompletionAvailable() && uiStore.bottomPanel === "tuning"
            }
          >
            <ToolbarButton
              icon={
                pitchCompletionActive() ? "i-lucide:unlock" : "i-lucide:lock"
              }
              label={t1("config.pitch_completion_enabled")}
              ariaPressed={pitchCompletionActive()}
              tooltip={
                <>
                  <div>{`${t1("config.pitch_completion_enabled")} (${formatShortcut("toggle_pitch_completion").join("+")})`}</div>
                  <div>
                    {pitchCompletionActive() ? t1("enabled") : t1("disabled")}
                  </div>
                </>
              }
              onClick={togglePitchCompletionLock}
            />
          </Show>
          <Show when={pitchNoiseActive() && uiStore.bottomPanel === "tuning"}>
            <ToolbarButton
              icon="i-lucide:chevron-left"
              label={t1("bottom.previous_pitch_noise_seed")}
              disabled={
                tuningModified() ||
                !canStepSeedHistory(selectedTextBlockIndex(), -1)
              }
              onClick={() => stepSeedHistory(selectedTextBlockIndex(), -1)}
            />
            <ToolbarButton
              icon="i-lucide:dices"
              label={t1("bottom.regenerate_pitch_noise_seed")}
              disabled={tuningModified()}
              onClick={() => {
                const seed = Math.floor(Math.random() * 2 ** 32);
                commitPitchNoiseSeed(
                  selectedTextBlockIndex(),
                  seed === selectedTextBlock()?.pitch_noise_seed
                    ? (seed + 1) % 2 ** 32
                    : seed,
                );
              }}
            />
            <NumberField
              minValue={0}
              maxValue={4294967295}
              step={1}
              value={selectedTextBlock()?.pitch_noise_seed}
              disabled={tuningModified()}
              onRawValueChange={(seed) => {
                if (Number.isInteger(seed) && seed >= 0 && seed <= 4294967295) {
                  setTextStore(
                    selectedTextBlockIndex(),
                    "pitch_noise_seed",
                    seed,
                  );
                }
              }}
              format={false}
              class="mr1 flex items-center text-xs ui-disabled:cursor-not-allowed"
            >
              <Tooltip content={t1("config.pitch_noise_seed")}>
                <NumberField.Input
                  aria-label={t1("config.pitch_noise_seed")}
                  class="h-6 w-24 rounded b b-slate-2 px1 outline-none focus:b-primary-3 dark:(b-slate-6 bg-slate-8)"
                  // Typed seeds apply live but join the history only once
                  // committed, not once per keystroke.
                  onBlur={() => commitPitchNoiseSeed(selectedTextBlockIndex())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      commitPitchNoiseSeed(selectedTextBlockIndex());
                  }}
                />
              </Tooltip>
            </NumberField>
            <ToolbarButton
              icon="i-lucide:chevron-right"
              label={t1("bottom.next_pitch_noise_seed")}
              disabled={
                tuningModified() ||
                !canStepSeedHistory(selectedTextBlockIndex(), 1)
              }
              onClick={() => stepSeedHistory(selectedTextBlockIndex(), 1)}
            />
            <Separator
              orientation="vertical"
              class="mx1 h-4 b-0 b-l b-slate-3 dark:b-slate-5"
            />
          </Show>
          <Show when={uiStore.bottomPanel === "post"}>
            <ToolbarButton
              icon="i-lucide:undo-2"
              label={t1("bottom.post_undo")}
              tooltip={`${t1("bottom.post_undo")} (${formatShortcut("undo").join("+")})`}
              disabled={!canStepPostHistory(selectedTextBlockIndex(), "undo")}
              onClick={() => stepPostHistory(selectedTextBlockIndex(), "undo")}
            />
            <ToolbarButton
              icon="i-lucide:redo-2"
              label={t1("bottom.post_redo")}
              tooltip={`${t1("bottom.post_redo")} (${formatShortcut("redo").join("+")})`}
              disabled={!canStepPostHistory(selectedTextBlockIndex(), "redo")}
              onClick={() => stepPostHistory(selectedTextBlockIndex(), "redo")}
            />
            <Separator
              orientation="vertical"
              class="mx1 h-4 b-0 b-l b-slate-3 dark:b-slate-5"
            />
            <ToolbarButton
              icon="i-lucide:pencil"
              label={t1("bottom.post_pencil")}
              ariaPressed={uiStore.postTool === "pencil"}
              highlightPressed
              onClick={() => setUIStore("postTool", "pencil")}
            />
            <ToolbarButton
              icon="i-lucide:slash"
              label={t1("bottom.post_line")}
              ariaPressed={uiStore.postTool === "line"}
              highlightPressed
              onClick={() => setUIStore("postTool", "line")}
            />
            <ToolbarButton
              icon="i-lucide:move-horizontal"
              label={t1("bottom.post_time")}
              ariaPressed={uiStore.postTool === "time"}
              highlightPressed
              onClick={() => setUIStore("postTool", "time")}
            />
            <ToolbarButton
              icon="i-lucide:audio-waveform"
              label={t1("bottom.post_draw_unvoiced")}
              ariaPressed={uiStore.postDrawUnvoiced}
              highlightPressed
              tooltip={
                <>
                  <div>{t1("bottom.post_draw_unvoiced")}</div>
                  <div>
                    {uiStore.postDrawUnvoiced ? t1("enabled") : t1("disabled")}
                  </div>
                </>
              }
              onClick={() =>
                setUIStore("postDrawUnvoiced", !uiStore.postDrawUnvoiced)
              }
            />
            <Separator
              orientation="vertical"
              class="mx1 h-4 b-0 b-l b-slate-3 dark:b-slate-5"
            />
          </Show>
          <ToolbarButton
            icon="i-lucide:rotate-ccw"
            label={resetLabel()}
            onClick={() => void resetEdits()}
            disabled={!canReset()}
          />
          <ToolbarButton
            icon="i-lucide:list-video"
            label={t1("bottom.play_all_from_selection")}
            onClick={controls.speakAllFromSelection}
            disabled={controls.playableFromSelection().length === 0}
          />
          <Show when={uiStore.bottomPanel === "tuning"}>
            <TuningMenu />
          </Show>
        </div>
      </div>
      {/* The post tab has its own free playback-start timeline. */}
      <Show when={playbackTimelineEnabled() && uiStore.bottomPanel !== "post"}>
        <PlaybackTimeline
          phrases={controls.playbackPhrases()}
          anchorIndex={controls.playbackAnchorIndex()}
          setAnchorIndex={controls.setPlaybackAnchorIndex}
        />
      </Show>
    </div>
  );
}
