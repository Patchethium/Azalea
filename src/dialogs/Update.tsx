import { AppButton } from "@components/button";
import { AppDialogContent } from "@dialogs/AppContent";
import { Dialog } from "@kobalte/core/dialog";
import { Link } from "@kobalte/core/link";
import { Progress } from "@kobalte/core/progress";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Match, Show, Switch } from "solid-js";
import { useConfigStore } from "@contexts/config";
import type { UpdateProgress } from "@contexts/update";
import { usei18n } from "@contexts/i18n";
import { useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";

const formatMegabytes = (bytes: number) =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;

/** What was received, of the total once the server has announced it. */
const progressLabel = (progress: UpdateProgress) =>
  progress.total === null
    ? formatMegabytes(progress.completed)
    : `${formatMegabytes(progress.completed)} / ${formatMegabytes(progress.total)}`;

/** Offers a newer release: downloads it, then restarts into it. */
export function UpdateDialog() {
  const { t1, t2 } = usei18n()!;
  const { updater } = useConfigStore()!;
  const { isProjectDirty } = useTextStore()!;
  const { setUIStore } = useUIStore()!;

  const openReleasePage = (url: string) => {
    void openExternal(url).catch((error) => {
      console.error("Failed to open the release page:", error);
    });
  };

  // Installing restarts Azalea, so unsaved changes are settled first.
  const install = () => {
    if (isProjectDirty()) setUIStore("pendingProjectAction", "install_update");
    else void updater.install();
  };

  return (
    <Dialog
      open={updater.store.dialogOpen && updater.store.update !== null}
      onOpenChange={(open) => {
        if (!open) updater.dismiss();
      }}
    >
      <AppDialogContent
        title={t1("update.title")}
        closeLabel={t1("update.close")}
        class="w-[min(90vw,28rem)]"
      >
        <Show when={updater.store.update}>
          {(update) => (
            <div class="flex flex-col gap4 px5 py5">
              <div class="flex flex-col gap2 text-sm">
                <p>
                  {t2("update.message", {
                    version: update().version,
                    current: update().current_version,
                  })}
                </p>
                <Show when={!update().installable}>
                  <p class="text-ink-muted">{t1("update.manual")}</p>
                </Show>
                <Show when={updater.store.phase === "ready"}>
                  <p class="text-ink-muted">{t1("update.ready")}</p>
                </Show>
                <Show when={updater.store.phase === "installing"}>
                  <p role="status" class="text-ink-muted">
                    {t1("update.installing")}
                  </p>
                </Show>
                <Show when={update().installable}>
                  <Link
                    onClick={() => openReleasePage(update().release_url)}
                    class="flex w-fit cursor-pointer items-center gap1 rounded text-accent outline-none hover:underline focus-visible:(ring-2 ring-focus-ring)"
                  >
                    {t1("update.release_notes")}
                    <div
                      aria-hidden="true"
                      class="i-lucide:arrow-up-right size-4"
                    />
                  </Link>
                </Show>
              </div>
              <Show when={updater.store.progress}>
                {(progress) => (
                  <Progress
                    value={progress().completed}
                    maxValue={Math.max(
                      progress().total ?? 0,
                      progress().completed,
                      1,
                    )}
                    indeterminate={progress().total === null}
                    getValueLabel={() => progressLabel(progress())}
                    class="flex flex-col gap1"
                  >
                    <div class="flex justify-between text-xs text-ink-muted">
                      <Progress.Label>
                        {t1("update.downloading")}
                      </Progress.Label>
                      <span>{progressLabel(progress())}</span>
                    </div>
                    <Progress.Track class="h2 overflow-hidden rounded bg-track">
                      <Progress.Fill class="h-full w-[var(--kb-progress-fill-width)] bg-accent ui-indeterminate:(w-full opacity-50)" />
                    </Progress.Track>
                  </Progress>
                )}
              </Show>
              <Show when={updater.store.error}>
                {(error) => (
                  <p role="alert" class="break-words text-sm text-danger">
                    {t1(
                      updater.store.phase === "ready"
                        ? "update.install_failed"
                        : "update.download_failed",
                    )}{" "}
                    {error()}
                  </p>
                )}
              </Show>
              <div class="flex flex-wrap justify-end gap2">
                <Switch>
                  <Match when={!update().installable}>
                    <AppButton onClick={updater.dismiss}>
                      {t1("update.later")}
                    </AppButton>
                    <AppButton
                      variant="primary"
                      onClick={() => openReleasePage(update().release_url)}
                    >
                      {t1("update.open_release_page")}
                    </AppButton>
                  </Match>
                  <Match when={updater.store.phase === "downloading"}>
                    <AppButton onClick={updater.cancelDownload}>
                      {t1("update.cancel")}
                    </AppButton>
                  </Match>
                  <Match
                    when={
                      updater.store.phase === "ready" ||
                      updater.store.phase === "installing"
                    }
                  >
                    <AppButton
                      disabled={updater.store.phase === "installing"}
                      onClick={updater.dismiss}
                    >
                      {t1("update.later")}
                    </AppButton>
                    <AppButton
                      variant="primary"
                      disabled={updater.store.phase === "installing"}
                      onClick={install}
                    >
                      {t1("update.restart")}
                    </AppButton>
                  </Match>
                  <Match when={true}>
                    <AppButton onClick={updater.dismiss}>
                      {t1("update.later")}
                    </AppButton>
                    <AppButton
                      variant="primary"
                      onClick={() => void updater.download()}
                    >
                      {t1("update.download")}
                    </AppButton>
                  </Match>
                </Switch>
              </div>
            </div>
          )}
        </Show>
      </AppDialogContent>
    </Dialog>
  );
}
