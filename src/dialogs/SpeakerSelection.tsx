import {
  type CharacterMeta,
  commands,
  type SpeakerIconRequest,
} from "@binding";
import { Tooltip } from "@components/tooltip";
import { AppDialogContent } from "@dialogs/AppContent";
import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { usei18n } from "../contexts/i18n";
import { useMetaStore } from "../contexts/meta";

type IconStatus = "idle" | "loading-cache" | "downloading" | "error";

function representativeStyle(speaker: CharacterMeta) {
  return speaker.styles.reduce<CharacterMeta["styles"][number] | undefined>(
    (selected, style) => {
      if (selected === undefined) return style;
      const selectedOrder = selected.order ?? Number.POSITIVE_INFINITY;
      const styleOrder = style.order ?? Number.POSITIVE_INFINITY;
      return styleOrder < selectedOrder ? style : selected;
    },
    undefined,
  );
}

function iconRequests(speakers: CharacterMeta[]): SpeakerIconRequest[] {
  return speakers.flatMap((speaker) => {
    const style = representativeStyle(speaker);
    return style === undefined
      ? []
      : [
          {
            speaker_uuid: speaker.speaker_uuid,
            style_id: style.id,
          },
        ];
  });
}

interface SpeakerSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  speakers: CharacterMeta[];
  selectedSpeakerUuid: string | null;
  onSelect: (speaker: CharacterMeta) => void;
}

export function SpeakerSelectionDialog(props: SpeakerSelectionDialogProps) {
  const { t1 } = usei18n()!;
  const {
    speakerIconRevision,
    speakerIconUrl,
    speakerIconsAreHydrated,
    hydrateSpeakerIcons,
    mergeSpeakerIcons,
    removeSpeakerIcon,
  } = useMetaStore()!;
  const [iconStatus, setIconStatus] = createSignal<IconStatus>("idle");
  let requestRevision = 0;
  let disposed = false;

  const requests = createMemo(() => iconRequests(props.speakers));
  const missingIconCount = createMemo(
    () => requests().filter((request) => !speakerIconUrl(request)).length,
  );

  const requestIsCurrent = (revision: number) =>
    !disposed && revision === requestRevision;

  const loadCachedIcons = async (requests: SpeakerIconRequest[]) => {
    const revision = ++requestRevision;
    const iconRevision = speakerIconRevision();
    setIconStatus("loading-cache");
    try {
      const result = await commands.getCachedSpeakerIcons(requests);
      if (!requestIsCurrent(revision)) return;
      if (result.status === "error") {
        setIconStatus("error");
        return;
      }
      if (!hydrateSpeakerIcons(requests, result.data, iconRevision)) {
        setIconStatus("idle");
        return;
      }
      setIconStatus(
        result.data.some((icon) => icon.error !== null) ? "error" : "idle",
      );
    } catch {
      if (!requestIsCurrent(revision)) return;
      setIconStatus("error");
    }
  };

  const downloadMissingIcons = async () => {
    const missingRequests = requests().filter(
      (request) => !speakerIconUrl(request),
    );
    if (missingRequests.length === 0) {
      setIconStatus("error");
      return;
    }

    const revision = ++requestRevision;
    const iconRevision = speakerIconRevision();
    setIconStatus("downloading");
    try {
      const result = await commands.downloadSpeakerIcons(missingRequests);
      if (!requestIsCurrent(revision)) return;
      if (result.status === "error") {
        setIconStatus("error");
        return;
      }
      if (!mergeSpeakerIcons(missingRequests, result.data, iconRevision)) {
        setIconStatus("idle");
        return;
      }
      setIconStatus(
        result.data.some(
          (icon) => icon.error !== null || icon.data_url === null,
        )
          ? "error"
          : "idle",
      );
    } catch {
      if (requestIsCurrent(revision)) setIconStatus("error");
    }
  };

  const handleIconError = (request: SpeakerIconRequest) => {
    removeSpeakerIcon(request);
    setIconStatus("error");
  };

  createEffect(() => {
    const currentRequests = requests();
    if (speakerIconsAreHydrated(currentRequests)) {
      if (iconStatus() === "loading-cache") setIconStatus("idle");
      return;
    }
    void loadCachedIcons(currentRequests);
  });

  onCleanup(() => {
    disposed = true;
    requestRevision += 1;
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("speaker_selection.title")}
        closeLabel={t1("speaker_selection.close")}
        class="max-h-[80vh] w-[min(90vw,48rem)]"
      >
        <Show
          when={
            iconStatus() === "loading-cache" ||
            iconStatus() === "downloading" ||
            iconStatus() === "error" ||
            missingIconCount() > 0
          }
        >
          <div class="flex items-center gap2 b-b b-slate-2 px4 py2 dark:b-slate-6">
            <Show when={iconStatus() === "loading-cache"}>
              <div class="flex items-center gap2 text-sm text-slate-5 dark:text-slate-4">
                <div class="i-lucide:loader-circle size-4 animate-spin" />
                {t1("speaker_selection.loading_icons")}
              </div>
            </Show>
            <Show when={iconStatus() === "error"}>
              <span role="alert" class="text-sm text-red-6 dark:text-red-4">
                {t1("speaker_selection.icon_download_failed")}
              </span>
            </Show>
            <div class="flex-1" />
            <Show
              when={iconStatus() !== "loading-cache" && missingIconCount() > 0}
            >
              <Button
                type="button"
                disabled={iconStatus() === "downloading"}
                aria-busy={iconStatus() === "downloading"}
                onClick={() => void downloadMissingIcons()}
                class="shrink-0 flex items-center gap2 rounded-md b b-slate-2 bg-transparent px3 py1.5 text-sm outline-none hover:(b-primary-5 bg-primary-1) focus-visible:(ring-2 ring-primary-3) disabled:(cursor-wait opacity-60) dark:(b-slate-6 hover:bg-slate-7)"
              >
                <div
                  class={
                    iconStatus() === "downloading"
                      ? "i-lucide:loader-circle size-4 animate-spin"
                      : iconStatus() === "error"
                        ? "i-lucide:refresh-cw size-4"
                        : "i-lucide:download size-4"
                  }
                />
                {iconStatus() === "downloading"
                  ? t1("speaker_selection.downloading_icons")
                  : iconStatus() === "error"
                    ? t1("speaker_selection.retry_download_icons")
                    : t1("speaker_selection.download_icons")}
              </Button>
            </Show>
          </div>
        </Show>
        <div class="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap3 overflow-y-auto p4">
          <For each={props.speakers}>
            {(speaker) => {
              const style = representativeStyle(speaker);
              const iconRequest =
                style === undefined
                  ? undefined
                  : {
                      speaker_uuid: speaker.speaker_uuid,
                      style_id: style.id,
                    };
              const selected = () =>
                speaker.speaker_uuid === props.selectedSpeakerUuid;
              return (
                <Tooltip
                  content={speaker.name}
                  class="min-w-0 w-full"
                  onlyWhenOverflowing
                >
                  <Button
                    type="button"
                    aria-pressed={selected()}
                    onClick={() => props.onSelect(speaker)}
                    class="relative min-h-24 min-w-0 w-full flex flex-col items-center justify-center gap2 rounded-xl b b-slate-2 bg-slate-1/70 p3 text-center outline-none transition-colors hover:(b-primary-5 bg-primary-1) focus-visible:(ring-2 ring-primary-3) dark:(b-slate-6 bg-slate-7/50) dark:hover:(b-primary-5 bg-slate-7)"
                    classList={{
                      "!b-primary-5 bg-primary-1 dark:bg-slate-7": selected(),
                    }}
                  >
                    <div class="size-16 flex items-center justify-center">
                      <Show
                        when={
                          iconRequest === undefined
                            ? undefined
                            : speakerIconUrl(iconRequest)
                        }
                        fallback={
                          <div class="i-lucide:mic-2 size-7 text-primary-5" />
                        }
                      >
                        {(iconUrl) => (
                          <img
                            src={iconUrl()}
                            alt=""
                            class="size-16 object-contain"
                            onError={() => {
                              if (iconRequest !== undefined)
                                handleIconError(iconRequest);
                            }}
                          />
                        )}
                      </Show>
                    </div>
                    <span class="w-full truncate font-medium">
                      {speaker.name}
                    </span>
                    <Show when={selected()}>
                      <div class="absolute right2 top2 i-lucide:check size-4 text-primary-5" />
                    </Show>
                  </Button>
                </Tooltip>
              );
            }}
          </For>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
