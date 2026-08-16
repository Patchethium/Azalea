import { DEFAULT_BOTTOM_SCALE } from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useUIStore } from "@contexts/ui";
import type { PlaybackPhraseAnchor } from "@layout/bottomPanel/types";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

const ANCHOR_SCROLL_PADDING_PX = 8;

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const decimals = safeSeconds < 10 ? 1 : 0;
  const roundedSeconds = Number(safeSeconds.toFixed(decimals));
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds - minutes * 60;
  return `${minutes}:${remainingSeconds
    .toFixed(decimals)
    .padStart(decimals === 0 ? 2 : 4, "0")}`;
}

export function PlaybackTimeline(props: {
  phrases: PlaybackPhraseAnchor[];
  anchorIndex: number | null;
  setAnchorIndex: (index: number | null) => void;
}) {
  const { t1, t2 } = usei18n()!;
  const { config } = useConfigStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  let scrollAreaRef!: HTMLDivElement;
  const [overflowDirection, setOverflowDirection] = createSignal<
    "left" | "right" | null
  >(null);

  const tuningScale = () =>
    config.ui_config.bottom_scale ?? DEFAULT_BOTTOM_SCALE;
  const phraseWidth = (phrase: PlaybackPhraseAnchor) =>
    uiStore.bottomPanel === "tuning"
      ? `${phrase.duration * tuningScale()}px`
      : `${phrase.moraCount * 3 + 2}rem`;
  const geometryFingerprint = () =>
    [
      props.anchorIndex,
      uiStore.bottomPanel,
      tuningScale(),
      ...props.phrases.flatMap((phrase) => [phrase.duration, phrase.moraCount]),
    ].join(":");

  const updateOverflowIndicator = () => {
    const anchorIndex = props.anchorIndex;
    if (anchorIndex === null || scrollAreaRef.clientWidth <= 0) {
      setOverflowDirection(null);
      return;
    }
    const anchor = scrollAreaRef.querySelector<HTMLElement>(
      `[data-accent-phrase-index="${anchorIndex}"]`,
    );
    if (anchor === null) {
      setOverflowDirection(null);
      return;
    }
    const viewportStart = scrollAreaRef.scrollLeft;
    const viewportEnd = viewportStart + scrollAreaRef.clientWidth;
    if (anchor.offsetLeft < viewportStart) {
      setOverflowDirection("left");
    } else if (anchor.offsetLeft >= viewportEnd) {
      setOverflowDirection("right");
    } else {
      setOverflowDirection(null);
    }
  };

  const jumpToAnchor = () => {
    const anchor = scrollAreaRef.querySelector<HTMLElement>(
      `[data-accent-phrase-index="${props.anchorIndex}"]`,
    )!;
    const maxScrollLeft = Math.max(
      0,
      scrollAreaRef.scrollWidth - scrollAreaRef.clientWidth,
    );
    const scrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, anchor.offsetLeft - ANCHOR_SCROLL_PADDING_PX),
    );
    scrollAreaRef.scrollLeft = scrollLeft;
    setUIStore("bottom_scroll_pos", scrollAreaRef.scrollLeft);
    updateOverflowIndicator();
  };

  createEffect(() => {
    const expectedGeometry = geometryFingerprint();
    const scrollLeft = uiStore.bottom_scroll_pos;
    if (scrollAreaRef.scrollLeft !== scrollLeft) {
      scrollAreaRef.scrollLeft = scrollLeft;
    }
    queueMicrotask(() => {
      if (geometryFingerprint() === expectedGeometry) {
        updateOverflowIndicator();
      }
    });
  });

  onMount(() => {
    const resizeObserver = new ResizeObserver(updateOverflowIndicator);
    resizeObserver.observe(scrollAreaRef);
    onCleanup(() => resizeObserver.disconnect());
  });

  return (
    <div class="relative h-6 w-full b-t b-slate-3 dark:b-slate-6 ">
      <div
        ref={(element) => {
          scrollAreaRef = element;
        }}
        role="group"
        aria-label={t1("bottom.playback_timeline")}
        title={t1("bottom.playback_timeline_hint")}
        class="size-full overflow-x-auto overflow-y-hidden bg-slate-50 text-slate-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:(bg-slate-9 text-slate-4)"
        data-bottom-panel-scroll="timeline"
        data-playback-anchor={props.anchorIndex ?? "unset"}
        onScroll={(event) => {
          const scrollLeft = event.currentTarget.scrollLeft;
          if (uiStore.bottom_scroll_pos !== scrollLeft) {
            setUIStore("bottom_scroll_pos", scrollLeft);
          }
          updateOverflowIndicator();
        }}
      >
        <div class="flex h-full min-w-full w-max items-stretch">
          <Show when={uiStore.bottomPanel === "accent"}>
            <div class="w-2 flex-none" />
          </Show>
          <For each={props.phrases}>
            {(phrase, index) => {
              const selected = () => props.anchorIndex === index();
              return (
                <button
                  type="button"
                  class="group relative h-full flex-none overflow-hidden b-r b-slate-3 px-1 text-left outline-none hover:bg-primary-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-5 dark:(b-slate-6 hover:bg-primary-9)"
                  classList={{
                    "bg-primary-1 dark:bg-primary-9": selected(),
                    "bg-transparent": !selected(),
                  }}
                  style={{ width: phraseWidth(phrase) }}
                  aria-label={t2("bottom.playback_phrase_anchor", {
                    index: index() + 1,
                  })}
                  aria-pressed={selected()}
                  tabIndex={-1}
                  data-accent-phrase-index={index()}
                  onClick={(event) => {
                    props.setAnchorIndex(selected() ? null : index());
                    event.currentTarget.blur();
                  }}
                >
                  <Show when={selected()}>
                    <span class="pointer-events-none absolute inset-y-0 left-0 w-1px bg-primary-5">
                      <span class="absolute left-0 top-0 size-0 border-l-5 border-y-4 border-l-primary-5 border-y-transparent" />
                    </span>
                  </Show>
                  <span class="pointer-events-none flex h-full items-end justify-between pb-0.5 text-9px tabular-nums">
                    <span>{index() + 1}</span>
                    <span>{formatTime(phrase.startSeconds)}</span>
                  </span>
                </button>
              );
            }}
          </For>
          <Show when={uiStore.bottomPanel === "accent"}>
            <div class="w-2 flex-none" />
          </Show>
        </div>
      </div>
      <Show when={overflowDirection()}>
        {(direction) => (
          <button
            type="button"
            aria-label={t1("bottom.jump_to_playback_anchor")}
            title={t1("bottom.jump_to_playback_anchor")}
            tabIndex={-1}
            class={`group absolute inset-y-0 z-2 flex w-6 items-center bg-slate-50 dark:bg-slate-9 hover:bg-primary-2 dark:hover:bg-primary-5 justify-center outline-none`}
            classList={{
              "left-0": direction() === "left",
              "right-0": direction() === "right",
            }}
            data-playback-anchor-overflow={direction()}
            onClick={(event) => {
              jumpToAnchor();
              event.currentTarget.blur();
            }}
          >
            <span
              class="pointer-events-none size-4 bg-slate-5 transition-colors group-hover:bg-primary-5 group-active:bg-primary-5 dark:bg-slate-4 dark:group-hover:bg-primary-3"
              classList={{
                "i-lucide:chevron-left": direction() === "left",
                "i-lucide:chevron-right": direction() === "right",
              }}
            />
          </button>
        )}
      </Show>
    </div>
  );
}
