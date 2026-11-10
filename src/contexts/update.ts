// In-app updates: checking for a newer release, downloading it and
// restarting into it.

import { type AvailableUpdate, commands, events } from "$binding";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";

/**
 * `available`: an update was found and nothing is in progress.
 * `ready`: the package is downloaded and verified; installing restarts.
 */
export type UpdatePhase =
  | "idle"
  | "available"
  | "downloading"
  | "ready"
  | "installing";

export interface UpdateProgress {
  completed: number;
  /** Null while the server has not announced the size. */
  total: number | null;
}

export type UpdateCheckResult =
  | { status: "available"; update: AvailableUpdate }
  | { status: "current" }
  | { status: "error"; error: string }
  /** Another check, a download or an installation is running. */
  | { status: "busy" };

interface UpdateStore {
  phase: UpdatePhase;
  update: AvailableUpdate | null;
  progress: UpdateProgress | null;
  /** Why the last download or installation failed. */
  error: string | null;
  dialogOpen: boolean;
}

/**
 * `autoCheck` is read once, when it first returns a boolean: whether to look
 * for an update at startup. It returns undefined until the saved setting is
 * known.
 */
export function createUpdater(autoCheck: () => boolean | undefined) {
  const [store, setStore] = createStore<UpdateStore>({
    phase: "idle",
    update: null,
    progress: null,
    error: null,
    dialogOpen: false,
  });
  // Development builds and unknown answers do not offer updates.
  const [supported, setSupported] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  let operation: string | undefined;
  let disposed = false;

  void commands
    .updatesSupported()
    .then((value) => {
      if (!disposed) setSupported(value === true);
    })
    .catch((cause) => {
      console.error("Failed to ask whether updates are supported:", cause);
    });

  const check = async (): Promise<UpdateCheckResult> => {
    if (
      checking() ||
      store.phase === "downloading" ||
      store.phase === "installing"
    )
      return { status: "busy" };
    setChecking(true);
    try {
      const result = await commands.checkForUpdate();
      if (disposed) return { status: "busy" };
      if (result.status === "error")
        return { status: "error", error: result.error };
      const update = result.data;
      if (update === null) {
        setStore({
          phase: "idle",
          update: null,
          progress: null,
          error: null,
          dialogOpen: false,
        });
        return { status: "current" };
      }
      // The backend keeps a package it already downloaded for this release.
      const downloaded =
        store.phase === "ready" &&
        update.installable &&
        store.update?.version === update.version;
      setStore({
        phase: downloaded ? "ready" : "available",
        update,
        progress: null,
        error: null,
        dialogOpen: true,
      });
      return { status: "available", update };
    } catch (cause) {
      return { status: "error", error: String(cause) };
    } finally {
      if (!disposed) setChecking(false);
    }
  };

  const download = async () => {
    if (store.phase !== "available" || !store.update?.installable) return;
    const id = crypto.randomUUID();
    operation = id;
    setStore({
      phase: "downloading",
      progress: { completed: 0, total: null },
      error: null,
    });
    let unlisten: (() => void) | undefined;
    let error: string | null = null;
    let downloaded = false;
    try {
      unlisten = await events.updateDownloadProgressEvent.listen(
        ({ payload }) => {
          if (!disposed && operation === payload.operation_id)
            setStore("progress", {
              completed: payload.completed_bytes,
              total: payload.total_bytes,
            });
        },
      );
      const result = await commands.downloadUpdate(id);
      if (result.status === "error") error = result.error;
      else downloaded = !result.data;
    } catch (cause) {
      error = String(cause);
    } finally {
      unlisten?.();
      if (operation === id) operation = undefined;
    }
    if (disposed) return;
    setStore({
      phase: downloaded ? "ready" : "available",
      progress: null,
      error,
    });
  };

  const cancelDownload = () => {
    if (operation !== undefined) void commands.cancelUpdateDownload(operation);
  };

  /** Installs the downloaded update; Azalea restarts when it succeeds. */
  const install = async () => {
    if (store.phase !== "ready") return;
    setStore({ phase: "installing", error: null, dialogOpen: true });
    let error: string;
    try {
      const result = await commands.installUpdate();
      // The backend restarts Azalea; stay busy until it does.
      if (result.status === "ok") return;
      error = result.error;
    } catch (cause) {
      error = String(cause);
    }
    if (!disposed) setStore({ phase: "ready", error });
  };

  /** Closes the prompt. A running download is cancelled, an installation is not interrupted. */
  const dismiss = () => {
    if (store.phase === "installing") return;
    cancelDownload();
    setStore("dialogOpen", false);
  };

  const show = () => {
    if (store.update !== null) setStore("dialogOpen", true);
  };

  let startupChecked = false;
  createEffect(() => {
    if (startupChecked || !supported()) return;
    const enabled = autoCheck();
    if (enabled === undefined) return;
    startupChecked = true;
    if (!enabled) return;
    void check().then((result) => {
      // Nobody asked for this check, so a failure is not worth a message.
      if (result.status === "error")
        console.error("Failed to check for updates:", result.error);
    });
  });

  onCleanup(() => {
    disposed = true;
  });

  return {
    store,
    supported,
    checking,
    check,
    download,
    cancelDownload,
    install,
    dismiss,
    show,
  };
}

export type Updater = ReturnType<typeof createUpdater>;
