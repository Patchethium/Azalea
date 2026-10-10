import {
  commands,
  events,
  type DownloadProgressEvent,
  type DownloadSetup,
  type SetupSource,
} from "$binding";
import { AppButton } from "@components/button";
import { IconButton } from "@components/iconButton";
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

export function VoiceSetup(props: {
  /**
   * Renders the manage-models button for the managed setup. `inline` opens a
   * nested dialog (the setup wizard), `sidebar` switches to the shared sidebar
   * page and closes the surrounding dialog.
   */
  modelManager?: "inline" | "sidebar";
}) {
  const { t1 } = usei18n()!;
  const {
    config,
    setConfig,
    setupSource,
    setupSwitchPending,
    setSetupSwitchPending,
    setDownloadedCore,
    coreError,
    setCoreError,
    reinitializeCore,
    activeSetupSource,
    coreSwitching,
    coreInitializeResource,
  } = useConfigStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const [busy, setBusy] = createSignal(false);
  const [modelsOpen, setModelsOpen] = createSignal(false);
  let revision = 0;
  let disposed = false;

  const selectSource = async (source: string | null) => {
    // Hold the switch until the lookup and any core reinitialization settle.
    // Every managed lookup hashes the downloaded models, so overlapping
    // switches would stack heavy scans and freeze the app.
    if (source === null || source === setupSource() || setupSwitchPending())
      return;
    setSetupSwitchPending(true);
    const request = ++revision;
    try {
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
    } finally {
      setSetupSwitchPending(false);
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
        disabled={
          coreSwitching() ||
          setupSwitchPending() ||
          coreInitializeResource.loading
        }
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
      <Show when={props.modelManager && setupSource() === "Downloaded"}>
        <AppButton
          onClick={() =>
            props.modelManager === "sidebar"
              ? setUIStore("page", "models")
              : setModelsOpen(true)
          }
        >
          {t1("voice_setup.manage")}
        </AppButton>
        <Show when={props.modelManager === "inline"}>
          <ModelManagerDialog
            open={modelsOpen()}
            onOpenChange={setModelsOpen}
          />
        </Show>
      </Show>
    </section>
  );
}

/** Installed packages and available downloads share the fixed CPU catalog. */
export function ModelManagerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t1, t2 } = usei18n()!;
  const {
    setDownloadedCore,
    coreError,
    reinitializeCore,
    refreshCoreAfterModelDeletion,
    coreSwitching,
    setupSwitchPending,
  } = useConfigStore()!;
  const { uiStore } = useUIStore()!;
  const open = () => props.open;
  const [setup, setSetup] = createSignal<DownloadSetup | null>(null);
  const [selected, setSelected] = createSignal<string[]>([]);
  const [downloading, setDownloading] = createSignal<string[]>([]);
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
  const selectedDownloads = () =>
    packages()
      .filter((c) => selected().includes(c.id) && !c.installed)
      .map((c) => c.id);
  const selectedDeletes = () =>
    packages()
      .filter((c) => selected().includes(c.id) && c.installed)
      .map((c) => c.id);
  // Apply only when the running core would change: the managed setup is not
  // loaded yet, or the installed models differ from the loaded ones.
  const applyPending = createMemo(() => {
    const current = setup();
    if (!current?.core_config) return false;
    const loaded = current.loaded_models;
    return (
      !loaded || packages().some((c) => c.installed !== loaded.includes(c.id))
    );
  });
  const actionDisabled = () =>
    busy() || loading() || coreSwitching() || setupSwitchPending();
  const totalBytes = createMemo(
    () =>
      setup()
        ?.components.filter(
          (c) =>
            !c.installed &&
            (!c.id.endsWith(".vvm") ||
              (busy() && operationId ? downloading() : selected()).includes(
                c.id,
              )),
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
          ids.filter((id) => result.data.components.some((c) => c.id === id)),
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

  const download = async (ids: string[]) => {
    if (actionDisabled() || !ids.length) return;
    const id = crypto.randomUUID();
    operationId = id;
    setDownloading(ids);
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
      const result = await commands.downloadCpuSetup(id, ids);
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
        if (!disposed) {
          // The last event (often speaker icons) never reports completion.
          setProgress(null);
          setBusy(false);
        }
      }
    }
  };

  const deleteModels = async (ids: string[]) => {
    if (actionDisabled() || !ids.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setProgress(null);
    try {
      const result = await commands.deleteDownloadedModels(ids);
      // Deletion also rebuilds the running managed core, even if the dialog closed.
      await refreshCoreAfterModelDeletion();
      if (disposed || !open()) return;
      if (result.status === "error") setError(result.error);
      await refresh();
      if (!disposed && open()) setDownloadedCore(setup()?.core_config ?? null);
    } catch (cause) {
      if (!disposed && open()) setError(String(cause));
    } finally {
      if (!disposed) setBusy(false);
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

  const terms = [
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
  ];
  const requiredLabel = (id: string) =>
    id === "dictionary"
      ? t1("voice_setup.dictionary")
      : id === "TERMS.txt"
        ? t1("voice_setup.model_terms")
        : t1("voice_setup.runtime");
  const groupIds = (installed: boolean) =>
    packages()
      .filter((c) => c.installed === installed)
      .map((c) => c.id);
  const groupSelection = (installed: boolean) => {
    const ids = groupIds(installed);
    const count = ids.filter((id) => selected().includes(id)).length;
    return count === 0 ? "none" : count === ids.length ? "all" : "some";
  };
  const selectGroup = (installed: boolean, checked: boolean) => {
    const ids = groupIds(installed);
    setSelected((current) => [
      ...current.filter((id) => !ids.includes(id)),
      ...(checked ? ids : []),
    ]);
  };
  const toggleSelected = (id: string, checked: boolean) =>
    setSelected((ids) =>
      checked ? [...ids, id] : ids.filter((selectedId) => selectedId !== id),
    );

  return (
    <Dialog open={open()} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("voice_setup.manage")}
        closeLabel={t1("voice_setup.close")}
        class="w-[min(90vw,48rem)]"
      >
        <div class="flex min-h-0 flex-1 flex-col gap4 overflow-auto p4">
          <div class="flex items-start gap2">
            <p class="m0 flex-1 text-sm text-slate-6 dark:text-slate-3">
              {t1("voice_setup.description")}
            </p>
            <Show when={setup()}>
              <IconButton
                icon="i-lucide:refresh-cw"
                iconSize="sm"
                label={t1("voice_setup.refresh")}
                disabled={busy() || loading()}
                onClick={() => {
                  setError(null);
                  void refresh();
                }}
              />
            </Show>
          </div>
          <Show when={loading()}>
            <p role="status" class="m0 text-sm">
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
            <section class="flex flex-col gap2">
              <h3 class="m0 text-sm font-semibold">
                {t1("voice_setup.required_components")}
              </h3>
              <ul class="m0 flex flex-col list-none overflow-hidden rounded-md b b-slate-2 p0 dark:b-slate-6">
                <For each={required()}>
                  {(component) => (
                    <li class="flex items-center gap2 px3 py2 text-sm [&+li]:(b-t b-slate-2 dark:b-slate-6)">
                      <span class="flex-1">{requiredLabel(component.id)}</span>
                      <PackageStatus
                        installed={component.installed}
                        bytes={component.bytes}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </section>
            <For each={[true, false]}>
              {(installed) => (
                <Show when={packages().some((c) => c.installed === installed)}>
                  <section class="flex flex-col gap2">
                    <div class="flex items-center gap2 b b-transparent px3">
                      <Checkbox
                        checked={groupSelection(installed) === "all"}
                        indeterminate={groupSelection(installed) === "some"}
                        disabled={actionDisabled()}
                        onChange={(checked) => selectGroup(installed, checked)}
                        class="flex"
                      >
                        <Checkbox.Input
                          aria-label={t1(
                            installed
                              ? "voice_setup.select_all_downloaded"
                              : "voice_setup.select_all_available",
                          )}
                        />
                        <SelectionControl
                          indeterminate={groupSelection(installed) === "some"}
                        />
                      </Checkbox>
                      <h3 class="m0 text-sm font-semibold">
                        {t1(
                          installed
                            ? "voice_setup.downloaded_models"
                            : "voice_setup.available_models",
                        )}
                      </h3>
                      <span class="text-xs text-slate-5">
                        {
                          packages().filter((c) => c.installed === installed)
                            .length
                        }
                      </span>
                    </div>
                    <ul class="m0 flex flex-col list-none overflow-hidden rounded-md b b-slate-2 p0 dark:b-slate-6">
                      <For
                        each={packages().filter(
                          (c) => c.installed === installed,
                        )}
                      >
                        {(component) => (
                          <li class="flex items-center gap3 px3 py2 hover:bg-slate-50 dark:hover:bg-slate-7/50 [&+li]:(b-t b-slate-2 dark:b-slate-6)">
                            <Checkbox
                              checked={selected().includes(component.id)}
                              disabled={actionDisabled()}
                              onChange={(checked) =>
                                toggleSelected(component.id, checked)
                              }
                              class="min-w-0 flex flex-1 items-start gap2"
                            >
                              <Checkbox.Input aria-label={component.id} />
                              <SelectionControl class="mt0.5" />
                              <Checkbox.Label class="min-w-0 flex flex-1 flex-col gap0.5 cursor-pointer text-sm">
                                <span class="font-semibold">
                                  {component.id}
                                </span>
                                <span
                                  lang="ja"
                                  class="text-xs text-slate-6 dark:text-slate-3"
                                >
                                  {component.entries
                                    .map((e) => `${e.character}（${e.style}）`)
                                    .join("、")}
                                </span>
                              </Checkbox.Label>
                            </Checkbox>
                            <PackageStatus
                              installed={component.installed}
                              bytes={component.bytes}
                            />
                            <IconButton
                              icon={
                                component.installed
                                  ? "i-lucide:trash-2"
                                  : "i-lucide:download"
                              }
                              iconSize="sm"
                              size="md"
                              tone={component.installed ? "danger" : "primary"}
                              label={`${t1(component.installed ? "voice_setup.delete" : "voice_setup.download")} ${component.id}`}
                              disabled={actionDisabled()}
                              onClick={() =>
                                void (component.installed
                                  ? deleteModels([component.id])
                                  : download([component.id]))
                              }
                            />
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>
              )}
            </For>
            <div class="flex flex-col gap1 text-xs text-slate-5">
              <div class="flex flex-wrap gap3">
                <For each={terms}>
                  {(item) => (
                    <Link
                      href={item.href}
                      onClick={(event) => {
                        event.preventDefault();
                        void openExternal(item.href).catch((cause) => {
                          if (!disposed) setError(String(cause));
                        });
                      }}
                      class="text-primary-6 underline outline-none focus-visible:ring-2 focus-visible:ring-primary-3"
                    >
                      {t1(item.label)}
                    </Link>
                  )}
                </For>
              </div>
              <p class="m0 break-all">
                {t1("voice_setup.location")}: {setup()!.directory}
              </p>
            </div>
          </Show>
        </div>
        <div class="flex shrink-0 flex-col gap3 b-t b-slate-2 p4 dark:b-slate-6">
          <Show when={setup() && selected().length}>
            <div class="flex flex-wrap items-center gap2 rounded-md bg-slate-1 px3 py2 text-sm dark:bg-slate-7">
              <span class="flex-1">
                {t2("voice_setup.selected_count", {
                  count: selected().length,
                })}
              </span>
              <AppButton
                disabled={
                  actionDisabled() ||
                  (!selectedDownloads().length &&
                    required().every((c) => c.installed))
                }
                onClick={() =>
                  void download(
                    selectedDownloads().length
                      ? selectedDownloads()
                      : selected(),
                  )
                }
              >
                {t1("voice_setup.download_all")}
              </AppButton>
              <AppButton
                class="hover:(!b-red-5 !bg-red-5)"
                disabled={actionDisabled() || !selectedDeletes().length}
                onClick={() => void deleteModels(selectedDeletes())}
              >
                {t1("voice_setup.delete_all")}
              </AppButton>
              <AppButton
                disabled={actionDisabled()}
                onClick={() => setSelected([])}
              >
                {t1("voice_setup.clear_selection")}
              </AppButton>
            </div>
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
          <div class="flex flex-wrap items-center gap2">
            <Show when={setup()}>
              <p class="m0 text-sm">
                {t1("voice_setup.total")}: {formatDownloadSize(totalBytes())}
              </p>
            </Show>
            <div class="flex-1" />
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
              variant="primary"
              disabled={busy() || loading() || !applyPending()}
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

/** Shared box for model checkboxes, with a dash for partial group selection. */
function SelectionControl(props: { class?: string; indeterminate?: boolean }) {
  return (
    <Checkbox.Control
      class={`flex size-5 shrink-0 items-center justify-center rounded b b-slate-4 ui-checked:(b-primary-5 bg-primary-5 text-white) ui-indeterminate:(b-primary-5 bg-primary-5 text-white) ui-focus-visible:ring-2 ui-focus-visible:ring-primary-3 ui-disabled:opacity-50 ${props.class ?? ""}`}
    >
      <Checkbox.Indicator>
        <div
          class={`${props.indeterminate ? "i-lucide:minus" : "i-lucide:check"} size-4`}
        />
      </Checkbox.Indicator>
    </Checkbox.Control>
  );
}

function PackageStatus(props: { installed: boolean; bytes: number }) {
  const { t1 } = usei18n()!;
  return (
    <Show
      when={props.installed}
      fallback={
        <span class="shrink-0 whitespace-nowrap text-sm tabular-nums text-slate-6 dark:text-slate-3">
          {formatDownloadSize(props.bytes)}
        </span>
      }
    >
      <span class="flex shrink-0 items-center gap1 whitespace-nowrap text-sm text-green-7 dark:text-green-4">
        <div aria-hidden="true" class="i-lucide:circle-check size-4" />
        {t1("voice_setup.installed")}
      </span>
    </Show>
  );
}
