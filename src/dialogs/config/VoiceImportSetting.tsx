import type { VoiceAligner } from "$binding";
import {
  ExtraDownloadProgress,
  formatMegabytes,
} from "@components/extraDownload";
import { AppSelect } from "@components/select";
import { useToasts } from "@components/toast";
import { ConfirmDialog } from "@dialogs/Confirm";
import { createSignal, Show } from "solid-js";
import { useConfigStore } from "@contexts/config";
import { voiceAlignerPack } from "@contexts/extras";
import { usei18n } from "@contexts/i18n";

type Choice = "None" | VoiceAligner;
const CHOICES: Choice[] = ["None", "Snfa", "Pydomino"];
const ALIGNER_NAMES: Record<VoiceAligner, string> = {
  Snfa: "snfa",
  Pydomino: "pydomino",
};

/**
 * Chooses voice import's aligner, or none to switch the feature off. An
 * aligner whose model is not downloaded shows its size and downloads it
 * after a confirmation; the setting changes once the download verifies.
 */
export function VoiceImportSetting() {
  const { setConfig, extras, voiceAligner, voiceImportEnabled } =
    useConfigStore()!;
  const { t1, t2 } = usei18n()!;
  const toasts = useToasts();
  const [pending, setPending] = createSignal<VoiceAligner | null>(null);
  const [downloading, setDownloading] = createSignal<VoiceAligner | null>(null);

  const size = (aligner: VoiceAligner) =>
    formatMegabytes(extras.status[voiceAlignerPack(aligner)]?.bytes ?? 0);
  const label = (choice: Choice) => {
    if (choice === "None") return t1("config.voice_import_none");
    const name = ALIGNER_NAMES[choice];
    return extras.installed(voiceAlignerPack(choice))
      ? name
      : `${name} (${size(choice)})`;
  };
  const select = (aligner: VoiceAligner) => {
    setConfig("ui", "voice_aligner", aligner);
    setConfig("ui", "voice_import", true);
  };

  const choose = (choice: Choice) => {
    if (choice === "None") setConfig("ui", "voice_import", false);
    else if (extras.installed(voiceAlignerPack(choice))) select(choice);
    else if (extras.status[voiceAlignerPack(choice)] !== undefined)
      setPending(choice);
  };

  const download = async (aligner: VoiceAligner) => {
    const pack = voiceAlignerPack(aligner);
    setDownloading(aligner);
    const error = await extras.download(pack);
    setDownloading(null);
    if (error !== null) toasts.error(t1("config.extra_download_failed"), error);
    // A cancelled download resolves without an error and without the files.
    else if (extras.installed(pack)) select(aligner);
  };

  return (
    <>
      <Show
        when={downloading()}
        fallback={
          <AppSelect<Choice>
            options={CHOICES}
            value={voiceImportEnabled() ? voiceAligner() : "None"}
            onChange={choose}
            getOptionLabel={label}
            label={t1("config.voice_import")}
            class="w-44 shrink-0"
          />
        }
      >
        {(aligner) => (
          <ExtraDownloadProgress
            pack={voiceAlignerPack(aligner())}
            label={t1("config.voice_import")}
          />
        )}
      </Show>
      <ConfirmDialog
        open={pending() !== null}
        title={t1("config.voice_import")}
        message={
          pending() === null
            ? ""
            : t2("config.extra_confirm_message", {
                name: ALIGNER_NAMES[pending()!],
                size: size(pending()!),
              })
        }
        confirmLabel={t1("config.extra_confirm")}
        cancelLabel={t1("config.extra_confirm_cancel")}
        onConfirm={() => {
          const aligner = pending();
          setPending(null);
          if (aligner !== null) void download(aligner);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
