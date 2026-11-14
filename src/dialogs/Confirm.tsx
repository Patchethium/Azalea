import { AppDialogContent } from "@dialogs/AppContent";
import { AppButton } from "@components/button";
import { Dialog } from "@kobalte/core/dialog";
import { usei18n } from "@contexts/i18n";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before an action; closing the dialog cancels. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t1 } = usei18n()!;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <AppDialogContent
        title={props.title}
        closeLabel={t1("titlebar.close")}
        class="w-[min(90vw,24rem)]"
      >
        <div class="flex flex-col gap4 px5 py5">
          <p class="text-sm text-ink-muted">{props.message}</p>
          <div class="flex flex-wrap justify-end gap2">
            <AppButton onClick={props.onCancel}>{props.cancelLabel}</AppButton>
            <AppButton variant="primary" onClick={props.onConfirm}>
              {props.confirmLabel}
            </AppButton>
          </div>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
