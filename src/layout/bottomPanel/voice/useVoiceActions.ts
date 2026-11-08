import { useToasts } from "@components/toast";
import { usei18n } from "@contexts/i18n";
import { useTextStore } from "@contexts/text";
import { useVoiceImportStore } from "@contexts/voiceImport";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

/**
 * Recording and choosing a voice for the selected block, shared by the
 * toolbar and the voice tab's empty state. Errors are toasted.
 */
export function useVoiceActions(disabled: () => boolean) {
  const { t1 } = usei18n()!;
  const { selectedTextBlock } = useTextStore()!;
  const voices = useVoiceImportStore()!;
  const toasts = useToasts();

  const canImportVoice = () =>
    !disabled() && (selectedTextBlock()?.query?.accent_phrases.length ?? 0) > 0;
  /** The recording of the selected block, if any. */
  const voiceRecording = () => {
    const state = voices.voiceRecording();
    return state !== null && state.blockId === selectedTextBlock()?.id
      ? state
      : null;
  };
  const canStartRecording = () =>
    canImportVoice() && voices.voiceRecording() === null;
  const canChooseFile = () => canImportVoice() && voiceRecording() === null;
  const reportVoiceError = (error: string | null) => {
    if (error !== null) toasts.error(t1("voice_import.failed"), error);
  };
  const toggleVoiceRecording = async () => {
    if (voiceRecording() !== null) {
      reportVoiceError(await voices.stopVoiceRecording());
      return;
    }
    const block = selectedTextBlock();
    if (block === null) return;
    reportVoiceError(await voices.startVoiceRecording(block.id));
  };
  const chooseVoiceFile = async () => {
    const block = selectedTextBlock();
    if (block === null) return;
    const path = await openDialog({
      title: t1("bottom.voice_choose_file"),
      multiple: false,
      directory: false,
      filters: [
        {
          name: t1("voice_import.file_filter"),
          extensions: ["wav", "flac", "mp3", "ogg", "oga"],
        },
      ],
    });
    if (typeof path !== "string") return;
    reportVoiceError(await voices.loadVoiceFile(block.id, path));
  };

  return {
    voiceRecording,
    canStartRecording,
    canChooseFile,
    toggleVoiceRecording,
    chooseVoiceFile,
  };
}
