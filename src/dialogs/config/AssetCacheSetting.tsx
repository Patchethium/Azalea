import { commands } from "$binding";
import { ConfigItem } from "@dialogs/config/Item";
import { Button } from "@kobalte/core/button";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";

type AssetCacheStatus = "idle" | "loading" | "clearing" | "error";

function formatAssetSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}

export function AssetCacheSetting(props: { open: boolean }) {
  const { t1 } = usei18n()!;
  const { clearSpeakerIcons } = useMetaStore()!;
  const [size, setSize] = createSignal<number | null>(null);
  const [status, setStatus] = createSignal<AssetCacheStatus>("idle");
  let requestRevision = 0;
  let disposed = false;

  const requestIsCurrent = (revision: number) =>
    !disposed && props.open && revision === requestRevision;

  const refreshSize = async () => {
    const revision = ++requestRevision;
    setStatus("loading");
    try {
      const result = await commands.getAssetsSize();
      if (!requestIsCurrent(revision)) return;
      if (result.status === "error") {
        setStatus("error");
        return;
      }
      setSize(result.data);
      setStatus("idle");
    } catch {
      if (requestIsCurrent(revision)) setStatus("error");
    }
  };

  const clearCache = async () => {
    const revision = ++requestRevision;
    setStatus("clearing");
    try {
      const clearResult = await commands.clearAssets();
      if (clearResult.status === "error") {
        if (requestIsCurrent(revision)) setStatus("error");
        return;
      }
      clearSpeakerIcons();
      if (!requestIsCurrent(revision)) return;

      const sizeResult = await commands.getAssetsSize();
      if (!requestIsCurrent(revision)) return;
      if (sizeResult.status === "error") {
        setStatus("error");
        return;
      }
      setSize(sizeResult.data);
      setStatus("idle");
    } catch {
      if (requestIsCurrent(revision)) setStatus("error");
    }
  };

  createEffect(() => {
    if (!props.open) {
      requestRevision += 1;
      return;
    }
    void refreshSize();
  });

  onCleanup(() => {
    disposed = true;
    requestRevision += 1;
  });

  return (
    <ConfigItem label={t1("config.assets_cache")}>
      <div class="flex items-center gap2">
        <Show
          when={status() !== "error"}
          fallback={
            <span
              role="alert"
              aria-label={t1("config.assets_cache_error")}
              title={t1("config.assets_cache_error")}
              class="i-lucide:triangle-alert size-4 text-red-6 dark:text-red-4"
            />
          }
        >
          <output
            aria-live="polite"
            class="text-sm text-slate-6 dark:text-slate-3"
          >
            {status() === "loading"
              ? t1("config.assets_cache_loading")
              : size() === null
                ? "—"
                : formatAssetSize(size()!)}
          </output>
        </Show>
        <Button
          type="button"
          disabled={
            status() === "loading" ||
            status() === "clearing" ||
            (status() === "idle" && size() === 0)
          }
          aria-busy={status() === "clearing"}
          onClick={() => void clearCache()}
          class="shrink-0 flex items-center gap1 rounded-md b b-slate-2 bg-transparent px2 py1 text-sm outline-none hover:(b-red-5 bg-red-5 text-white) focus-visible:(ring-2 ring-primary-3) disabled:(cursor-not-allowed opacity-60) dark:b-slate-6 dark:hover:(b-red-5 bg-red-6 text-white)"
        >
          <div
            class={
              status() === "clearing"
                ? "i-lucide:loader-circle size-4 animate-spin"
                : "i-lucide:trash-2 size-4"
            }
          />
          {status() === "clearing"
            ? t1("config.clearing_assets_cache")
            : t1("config.clear_assets_cache")}
        </Button>
      </div>
    </ConfigItem>
  );
}
