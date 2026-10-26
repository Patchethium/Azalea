import type { ExtraPack } from "$binding";
import { AppButton } from "@components/button";
import { IconButton } from "@components/iconButton";
import { useToasts } from "@components/toast";
import { Progress } from "@kobalte/core/progress";
import { Show } from "solid-js";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";

const formatMegabytes = (bytes: number) =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;

/**
 * Stands in for a setting's control until its optional download is in place,
 * showing progress and a cancel button while it downloads.
 */
export function ExtraDownloadButton(props: { pack: ExtraPack; label: string }) {
  const { extras } = useConfigStore()!;
  const { t1, t2 } = usei18n()!;
  const toasts = useToasts();
  const downloadLabel = () =>
    t2("config.extra_download", {
      size: formatMegabytes(extras.status[props.pack]?.bytes ?? 0),
    });

  const start = async () => {
    const error = await extras.download(props.pack);
    if (error !== null) toasts.error(t1("config.extra_download_failed"), error);
  };

  return (
    <Show
      when={extras.progress[props.pack]}
      fallback={
        <AppButton
          size="sm"
          aria-label={`${props.label}: ${downloadLabel()}`}
          disabled={extras.status[props.pack] === undefined}
          onClick={() => void start()}
          class="shrink-0 flex items-center gap1"
        >
          <div aria-hidden="true" class="i-lucide:download size-4" />
          {downloadLabel()}
        </AppButton>
      }
    >
      {(progress) => (
        <div class="flex items-center gap2">
          <Progress
            value={progress().completed}
            maxValue={Math.max(progress().total, 1)}
            aria-label={`${props.label}: ${t1("config.extra_downloading")}`}
            class="flex w-32 flex-col gap1"
          >
            <Progress.ValueLabel class="text-xs text-slate-6 dark:text-slate-3" />
            <Progress.Track class="h2 overflow-hidden rounded bg-slate-2 dark:bg-slate-6">
              <Progress.Fill class="h-full w-[var(--kb-progress-fill-width)] bg-primary-5" />
            </Progress.Track>
          </Progress>
          <IconButton
            icon="i-lucide:x"
            size="sm"
            tone="danger"
            label={t1("config.extra_cancel")}
            onClick={() => extras.cancel(props.pack)}
          />
        </div>
      )}
    </Show>
  );
}
