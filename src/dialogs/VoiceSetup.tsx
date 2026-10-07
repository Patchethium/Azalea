import {
  commands,
  events,
  type DownloadProgressEvent,
  type DownloadSetup,
  type SetupSource,
} from "$binding";
import { AppButton } from "@components/button";
import { AppDialogContent } from "@dialogs/AppContent";
import { Checkbox } from "@kobalte/core/checkbox";
import { Dialog } from "@kobalte/core/dialog";
import { Link } from "@kobalte/core/link";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import { Progress } from "@kobalte/core/progress";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useUIStore } from "@contexts/ui";

export function formatDownloadSize(bytes: number) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
}

export function VoiceSetup(props: { showModelManager?: boolean }) {
  const { t1 } = usei18n()!;
  const {
    config,
    setConfig,
    setupSource,
    setupChangePending,
    setDownloadedCore,
    coreError,
    setCoreError,
    reinitializeCore,
    activeSetupSource,
    coreSwitching,
    coreInitializeResource,
  } = useConfigStore()!;
  const { uiStore } = useUIStore()!;
  const [busy, setBusy] = createSignal(false);
  const [modelsOpen, setModelsOpen] = createSignal(false);
  let revision = 0;
  let disposed = false;

  const selectSource = async (source: string | null) => {
    if (source === null || source === setupSource()) return;
    const request = ++revision;
    setConfig("setup_source", source as SetupSource);
    setCoreError(null);
    if (source !== "Downloaded") {
      if (
        uiStore.coreInitialized &&
        config.core &&
        source !== activeSetupSource()
      )
        await reinitializeCore();
      return;
    }
    try {
      const result = await commands.getDownloadSetup();
      if (disposed || request !== revision) return;
      if (result.status === "ok") {
        setDownloadedCore(result.data.core_config);
        if (
          uiStore.coreInitialized &&
          result.data.core_config &&
          source !== activeSetupSource()
        )
          await reinitializeCore();
      } else setCoreError(result.error);
    } catch (cause) {
      if (!disposed && request === revision) setCoreError(String(cause));
    }
  };

  const pickInstallation = async () => {
    const request = ++revision;
    setBusy(true);
    try {
      const core = await commands.pickCore();
      if (disposed || request !== revision) return;
      if (core) {
        const reload = uiStore.coreInitialized;
        setConfig("core", core);
        if (reload) await reinitializeCore();
      } else
        console.warn(
          "User cancelled core picking or an invalid path is provided.",
        );
    } catch (cause) {
      if (!disposed && request === revision) setCoreError(String(cause));
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  onCleanup(() => {
    disposed = true;
    revision += 1;
  });

  return (
    <section class="flex flex-col gap2 py3">
      <div class="font-semibold">{t1("voice_setup.title")}</div>
      <ToggleGroup
        value={setupSource()}
        onChange={(source) => void selectSource(source)}
        aria-label={t1("voice_setup.title")}
        disabled={coreSwitching() || coreInitializeResource.loading}
        class="flex overflow-hidden rounded-md b b-slate-2 dark:b-slate-6"
      >
        <For each={["Downloaded", "ExistingInstallation"]}>
          {(source) => (
            <ToggleGroup.Item
              value={source}
              class="flex-1 bg-transparent px3 py2 text-sm outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-inset ring-primary-3) ui-pressed:(!bg-primary-5 !text-white) dark:hover:bg-slate-7 [&+button]:b-l [&+button]:b-slate-2 dark:[&+button]:b-slate-6"
            >
              {source === "Downloaded" ? t1("voice_setup.managed") : "VOICEVOX"}
            </ToggleGroup.Item>
          )}
        </For>
      </ToggleGroup>
      <Show when={coreInitializeResource.loading}>
        <p role="status" class="m0 text-sm">
          {t1("loading")}
        </p>
      </Show>
      <Show when={coreSwitching() || setupChangePending()}>
        <p role="status" class="m0 text-sm">
          {t1(
            coreSwitching()
              ? "voice_setup.switching"
              : "voice_setup.incomplete",
          )}
        </p>
      </Show>
      <Show when={coreError()}>
        <p role="alert" class="m0 text-sm text-red-6 dark:text-red-4">
          {coreError()}
        </p>
      </Show>
      <Show
        when={
          setupSource() === "ExistingInstallation" &&
          (!uiStore.coreInitialized || !config.core)
        }
      >
        <AppButton
          disabled={busy() || coreInitializeResource.loading}
          onClick={() => void pickInstallation()}
        >
          {t1("init_dialog.installed.button")}
        </AppButton>
      </Show>
      <Show when={props.showModelManager && setupSource() === "Downloaded"}>
        <AppButton onClick={() => setModelsOpen(true)}>
          {t1("voice_setup.manage")}
        </AppButton>
        <ModelManagerDialog open={modelsOpen()} onOpenChange={setModelsOpen} />
      </Show>
    </section>
  );
}

/** Installed packages and available downloads share the fixed CPU catalog. */
export function ModelManagerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t1 } = usei18n()!;
  const { setupChangePending, setDownloadedCore, coreError, reinitializeCore } =
    useConfigStore()!;
  const { uiStore } = useUIStore()!;
  const open = () => props.open;
  const [setup, setSetup] = createSignal<DownloadSetup | null>(null);
  const [selected, setSelected] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<DownloadProgressEvent | null>(
    null,
  );
  let revision = 0;
  let disposed = false;
  let operationId: string | null = null;

  const packages = createMemo(
    () => setup()?.components.filter((c) => c.id.endsWith(".vvm")) ?? [],
  );
  const required = createMemo(
    () => setup()?.components.filter((c) => !c.id.endsWith(".vvm")) ?? [],
  );
  const totalBytes = createMemo(
    () =>
      setup()
        ?.components.filter(
          (c) =>
            !c.installed &&
            (!c.id.endsWith(".vvm") || selected().includes(c.id)),
        )
        .reduce((total, c) => total + c.bytes, 0) ?? 0,
  );

  const refresh = async () => {
    const request = ++revision;
    setLoading(true);
    try {
      const result = await commands.getDownloadSetup();
      if (disposed || !open() || request !== revision) return;
      if (result.status === "error") {
        setSetup(null);
        setError(result.error);
      } else {
        setSetup(result.data);
        setSelected((ids) =>
          ids.filter(
            (id) => !result.data.components.find((c) => c.id === id)?.installed,
          ),
        );
      }
    } catch (cause) {
      if (!disposed && open() && request === revision) {
        setSetup(null);
        setError(String(cause));
      }
    } finally {
      if (!disposed && request === revision) setLoading(false);
    }
  };

  createEffect(() => {
    if (open()) {
      setError(null);
      setNotice(null);
      setProgress(null);
      void refresh();
    } else {
      revision += 1;
      if (operationId)
        void commands.cancelSetupDownload(operationId).catch(console.error);
    }
  });

  const download = async () => {
    const id = crypto.randomUUID();
    operationId = id;
    setBusy(true);
    setError(null);
    setNotice(null);
    setProgress(null);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await events.downloadProgressEvent.listen(({ payload }) => {
        if (!disposed && open() && operationId === payload.operation_id)
          setProgress(payload);
      });
      if (disposed || !open()) return;
      const result = await commands.downloadCpuSetup(id, selected());
      if (disposed || !open() || operationId !== id) return;
      if (result.status === "error") setError(result.error);
      else
        setNotice(
          result.data.cancelled
            ? t1("voice_setup.cancelled")
            : result.data.icon_errors.length
              ? t1("speaker_selection.icon_download_failed")
              : t1("voice_setup.complete"),
        );
      await refresh();
    } catch (cause) {
      if (!disposed && open() && operationId === id) setError(String(cause));
    } finally {
      unlisten?.();
      if (operationId === id) {
        operationId = null;
        if (!disposed) setBusy(false);
      }
    }
  };

  const cancel = async () => {
    try {
      const result = await commands.cancelSetupDownload(operationId!);
      if (result.status === "error") setError(result.error);
    } catch (cause) {
      if (!disposed) setError(String(cause));
    }
  };

  const activate = async () => {
    const reload = uiStore.coreInitialized;
    setDownloadedCore(setup()!.core_config);
    setProgress(null);
    setError(null);
    setBusy(true);
    try {
      if (reload && !(await reinitializeCore())) {
        if (!disposed) setError(coreError() ?? t1("voice_setup.incomplete"));
        return;
      }
      if (!disposed) props.onOpenChange(false);
    } catch (cause) {
      if (!disposed) setError(String(cause));
    } finally {
      if (!disposed) setBusy(false);
    }
  };

  onCleanup(() => {
    disposed = true;
    revision += 1;
    if (operationId)
      void commands.cancelSetupDownload(operationId).catch(console.error);
  });

  return (
    <Dialog open={open()} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("voice_setup.manage")}
        closeLabel={t1("voice_setup.close")}
        class="w-[min(90vw,48rem)]"
      >
        <div class="flex min-h-0 flex-1 flex-col gap3 overflow-auto p4">
          <p class="m0 text-sm">{t1("voice_setup.description")}</p>
          <Show when={setupChangePending()}>
            <p role="status" class="m0 text-sm">
              {t1("voice_setup.incomplete")}
            </p>
          </Show>
          <div class="flex flex-wrap gap3 text-sm">
            <For
              each={[
                {
                  href: "https://github.com/VOICEVOX/voicevox_vvm/blob/0.16.4/TERMS.txt",
                  label: "voice_setup.model_terms" as const,
                },
                {
                  href: "https://github.com/VOICEVOX/onnxruntime-builder/releases/tag/voicevox_onnxruntime-1.17.3",
                  label: "voice_setup.runtime_terms" as const,
                },
                {
                  href: "https://github.com/r9y9/open_jtalk/releases/tag/v1.11.1",
                  label: "voice_setup.dictionary_terms" as const,
                },
              ]}
            >
              {(terms) => (
                <Link
                  href={terms.href}
                  onClick={(event) => {
                    event.preventDefault();
                    void openExternal(terms.href).catch((cause) => {
                      if (!disposed) setError(String(cause));
                    });
                  }}
                  class="text-primary-6 underline outline-none focus-visible:ring-2 focus-visible:ring-primary-3"
                >
                  {t1(terms.label)}
                </Link>
              )}
            </For>
          </div>
          <Show when={loading()}>
            <p role="status" class="m0">
              {t1("voice_setup.loading")}
            </p>
          </Show>
          <Show when={error()}>
            <p role="alert" class="m0 text-sm text-red-6 dark:text-red-4">
              {error()}
            </p>
          </Show>
          <Show when={notice()}>
            <p role="status" class="m0 text-sm">
              {notice()}
            </p>
          </Show>
          <Show when={setup()}>
            <p class="m0 break-all text-xs text-slate-5">
              {setup()!.directory}
            </p>
            <For each={required()}>
              {(component) => (
                <div class="flex justify-between gap2 text-sm">
                  <span>
                    {component.id === "dictionary"
                      ? t1("voice_setup.dictionary")
                      : component.id === "TERMS.txt"
                        ? t1("voice_setup.model_terms")
                        : t1("voice_setup.runtime")}
                  </span>
                  <span>
                    {component.installed
                      ? t1("voice_setup.installed")
                      : formatDownloadSize(component.bytes)}
                  </span>
                </div>
              )}
            </For>
            <div class="flex flex-col gap2">
              <For each={[true, false]}>
                {(installed) => (
                  <Show
                    when={packages().some((c) => c.installed === installed)}
                  >
                    <h3 class="mb0 mt2 text-sm font-semibold">
                      {t1(
                        installed
                          ? "voice_setup.downloaded_models"
                          : "voice_setup.available_models",
                      )}
                    </h3>
                    <For
                      each={packages().filter((c) => c.installed === installed)}
                    >
                      {(component) => (
                        <Checkbox
                          checked={
                            component.installed ||
                            selected().includes(component.id)
                          }
                          disabled={component.installed || busy()}
                          onChange={(checked) =>
                            setSelected((ids) =>
                              checked
                                ? [...ids, component.id]
                                : ids.filter((id) => id !== component.id),
                            )
                          }
                          class="flex items-start gap2 rounded-md b b-slate-2 p3 dark:b-slate-6 ui-disabled:opacity-60"
                        >
                          <Checkbox.Input aria-label={component.id} />
                          <Checkbox.Control class="mt0.5 flex size-5 shrink-0 items-center justify-center rounded b b-slate-4 ui-checked:(b-primary-5 bg-primary-5 text-white) ui-focus-visible:ring-2 ui-focus-visible:ring-primary-3">
                            <Checkbox.Indicator>
                              <div class="i-lucide:check size-4" />
                            </Checkbox.Indicator>
                          </Checkbox.Control>
                          <Checkbox.Label class="min-w-0 flex-1 cursor-pointer text-sm">
                            <span class="flex justify-between gap2 font-semibold">
                              <span>{component.id}</span>
                              <span>
                                {component.installed
                                  ? t1("voice_setup.installed")
                                  : formatDownloadSize(component.bytes)}
                              </span>
                            </span>
                            <span
                              lang="ja"
                              class="mt1 block text-xs text-slate-6 dark:text-slate-3"
                            >
                              {component.entries
                                .map((e) => `${e.character} (${e.style})`)
                                .join("、")}
                            </span>
                          </Checkbox.Label>
                        </Checkbox>
                      )}
                    </For>
                  </Show>
                )}
              </For>
            </div>
          </Show>
        </div>
        <div class="flex shrink-0 flex-col gap3 b-t b-slate-2 p4 dark:b-slate-6">
          <Show when={setup()}>
            <p class="m0 text-sm">
              {t1("voice_setup.total")}: {formatDownloadSize(totalBytes())}
            </p>
          </Show>
          <Show when={progress()}>
            {(p) => (
              <Progress
                value={p().completed_bytes}
                maxValue={p().total_bytes}
                class="flex flex-col gap1"
              >
                <Progress.Label class="text-sm">
                  {p().component_id === "speaker-icons"
                    ? t1("speaker_selection.downloading_icons")
                    : `${p().component_id} — ${p().extracting ? t1("voice_setup.extracting") : formatDownloadSize(p().completed_bytes)}`}
                </Progress.Label>
                <Progress.Track class="h2 overflow-hidden rounded bg-slate-2 dark:bg-slate-6">
                  <Progress.Fill class="h-full w-[var(--kb-progress-fill-width)] bg-primary-5" />
                </Progress.Track>
              </Progress>
            )}
          </Show>
          <div class="flex flex-wrap gap2">
            <Show when={setup()}>
              <AppButton
                disabled={busy() || loading()}
                onClick={() => {
                  setError(null);
                  void refresh();
                }}
              >
                {t1("voice_setup.refresh")}
              </AppButton>
            </Show>
            <Show when={setup()}>
              <AppButton
                disabled={busy() || loading() || selected().length === 0}
                onClick={() => void download()}
              >
                {error() ? t1("voice_setup.retry") : t1("voice_setup.start")}
              </AppButton>
            </Show>
            <Show when={busy() && operationId}>
              <AppButton onClick={() => void cancel()}>
                {t1("voice_setup.cancel")}
              </AppButton>
            </Show>
            <Show when={!setup() && !loading()}>
              <AppButton onClick={() => void refresh()}>
                {t1("voice_setup.retry")}
              </AppButton>
            </Show>
            <AppButton
              disabled={busy() || loading() || !setup()?.core_config}
              onClick={() => void activate()}
            >
              {t1("voice_setup.use_downloaded")}
            </AppButton>
          </div>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
