// Optional downloads (fonts and English reading models) kept out of the bundle.

import { commands, events, type ExtraPack, type ExtraStatus } from "$binding";
import { onCleanup } from "solid-js";
import { createStore } from "solid-js/store";

export interface ExtraProgress {
  completed: number;
  total: number;
}

export function createExtras() {
  const [status, setStatus] = createStore<
    Partial<Record<ExtraPack, ExtraStatus>>
  >({});
  const [progress, setProgress] = createStore<
    Partial<Record<ExtraPack, ExtraProgress>>
  >({});
  const operations: Partial<Record<ExtraPack, string>> = {};
  let refreshRevision = 0;
  let disposed = false;

  const installed = (pack: ExtraPack) => status[pack]?.installed ?? false;
  const downloading = (pack: ExtraPack) => progress[pack] !== undefined;

  const refresh = async () => {
    const revision = ++refreshRevision;
    try {
      const result = await commands.getExtrasStatus();
      if (disposed || revision !== refreshRevision) return;
      if (result.status === "error") {
        console.error("Failed to read download status:", result.error);
        return;
      }
      for (const entry of result.data) setStatus(entry.pack, entry);
    } catch (cause) {
      console.error("Failed to read download status:", cause);
    }
  };

  /** Downloads a pack; resolves to an error message, or null on success or cancellation. */
  const download = async (pack: ExtraPack): Promise<string | null> => {
    if (operations[pack] !== undefined) return null;
    const id = crypto.randomUUID();
    operations[pack] = id;
    setProgress(pack, { completed: 0, total: status[pack]?.bytes ?? 0 });
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await events.extraDownloadProgressEvent.listen(
        ({ payload }) => {
          if (!disposed && operations[pack] === payload.operation_id)
            setProgress(pack, {
              completed: payload.completed_bytes,
              total: payload.total_bytes,
            });
        },
      );
      const result = await commands.downloadExtra(id, pack);
      return result.status === "error" ? result.error : null;
    } catch (cause) {
      return String(cause);
    } finally {
      unlisten?.();
      if (operations[pack] === id) delete operations[pack];
      if (!disposed) {
        setProgress(pack, undefined);
        await refresh();
      }
    }
  };

  const cancel = (pack: ExtraPack) => {
    const id = operations[pack];
    if (id !== undefined) void commands.cancelExtraDownload(id);
  };

  onCleanup(() => {
    disposed = true;
  });

  return {
    status,
    progress,
    installed,
    downloading,
    refresh,
    download,
    cancel,
  };
}

export type Extras = ReturnType<typeof createExtras>;
