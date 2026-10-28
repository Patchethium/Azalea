import { commands } from "$binding";
import { AppButton } from "@components/button";
import { createResource, createSignal, onCleanup, Show } from "solid-js";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";

interface SpeakerPortraitPanelProps {
  speakerUuid: string;
  styleId: number;
  alt: string;
  /** Every available speaker; the download button fetches all of them. */
  speakerUuids: string[];
  class?: string;
}

/**
 * Shows a cached character portrait, preferring the style's own variant, or
 * a button that downloads the portraits of every available speaker.
 */
export function SpeakerPortraitPanel(props: SpeakerPortraitPanelProps) {
  const { t1 } = usei18n()!;
  const { speakerPortraitRevision, invalidateSpeakerPortraits } =
    useMetaStore()!;
  const [status, setStatus] = createSignal<"idle" | "downloading" | "error">(
    "idle",
  );
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const [portrait] = createResource(
    () => ({
      speaker_uuid: props.speakerUuid,
      style_id: props.styleId,
      revision: speakerPortraitRevision(),
    }),
    async ({ speaker_uuid, style_id }) => {
      try {
        const result = await commands.getSpeakerPortrait({
          speaker_uuid,
          style_id,
        });
        if (result.status === "ok") return result.data;
        console.error("Failed to load speaker portrait:", result.error);
      } catch (error) {
        console.error("Failed to load speaker portrait:", error);
      }
      return null;
    },
  );

  const download = async () => {
    setStatus("downloading");
    try {
      const result = await commands.downloadSpeakerPortraits(
        props.speakerUuids,
      );
      // Saved portraits are shared, so reload them even after unmounting.
      invalidateSpeakerPortraits();
      if (disposed) return;
      setStatus(
        result.status === "error" ||
          result.data.some((speaker) => speaker.error !== null)
          ? "error"
          : "idle",
      );
    } catch {
      if (!disposed) setStatus("error");
    }
  };

  return (
    <div class={props.class}>
      <Show
        when={portrait.latest}
        fallback={
          <Show
            when={
              status() === "downloading" ||
              (!portrait.loading && portrait.latest === null)
            }
          >
            <div class="flex flex-col items-center gap2 text-center">
              <Show when={status() === "error"}>
                <p role="alert" class="m0 text-sm text-danger-ink">
                  {t1("portrait.download_failed")}
                </p>
              </Show>
              <AppButton
                variant="surface"
                class="flex items-center gap2"
                disabled={status() === "downloading"}
                aria-busy={status() === "downloading"}
                onClick={() => void download()}
              >
                <div
                  aria-hidden="true"
                  class={
                    status() === "downloading"
                      ? "i-lucide:loader-circle size-4 animate-spin"
                      : status() === "error"
                        ? "i-lucide:refresh-cw size-4"
                        : "i-lucide:download size-4"
                  }
                />
                {status() === "downloading"
                  ? t1("portrait.downloading")
                  : t1("portrait.download")}
              </AppButton>
            </div>
          </Show>
        }
      >
        {(src) => (
          <img
            src={src()}
            alt={props.alt}
            draggable={false}
            class="pointer-events-none max-h-full max-w-full select-none object-contain"
          />
        )}
      </Show>
    </div>
  );
}
