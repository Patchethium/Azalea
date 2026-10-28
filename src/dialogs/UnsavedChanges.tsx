import { AppDialogContent } from "@dialogs/AppContent";
import { AppButton } from "@components/button";
import { Dialog } from "@kobalte/core/dialog";
import { usei18n } from "@contexts/i18n";

interface UnsavedChangesDialogProps {
  open: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog(props: UnsavedChangesDialogProps) {
  const { t1 } = usei18n()!;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <AppDialogContent
        title={t1("unsaved.title")}
        closeLabel={t1("titlebar.close")}
        class="w-[min(90vw,28rem)]"
      >
        <div class="flex flex-col gap4 px5 py5">
          <p class="text-sm text-ink-muted">{t1("unsaved.message")}</p>
          <div class="flex flex-wrap justify-end gap2">
            <AppButton disabled={props.busy} onClick={props.onCancel}>
              {t1("unsaved.cancel")}
            </AppButton>
            <AppButton
              variant="danger"
              disabled={props.busy}
              onClick={props.onDiscard}
            >
              {t1("unsaved.discard")}
            </AppButton>
            <AppButton
              variant="primary"
              disabled={props.busy}
              onClick={props.onSave}
            >
              {props.busy ? t1("unsaved.saving") : t1("unsaved.save")}
            </AppButton>
          </div>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
