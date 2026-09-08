import { AppDialogContent } from "@dialogs/AppContent";
import { Button } from "@kobalte/core/button";
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
          <p class="text-sm text-slate-7 dark:text-slate-3">
            {t1("unsaved.message")}
          </p>
          <div class="flex flex-wrap justify-end gap2">
            <Button
              class="rounded-lg bg-slate-2 px3 py2 text-sm font-medium outline-none hover:bg-slate-3 focus-visible:(ring-2 ring-primary-2) disabled:opacity-60 dark:bg-slate-7 dark:hover:bg-slate-6"
              disabled={props.busy}
              onClick={props.onCancel}
            >
              {t1("unsaved.cancel")}
            </Button>
            <Button
              class="rounded-lg bg-slate-2 px3 py2 text-sm font-medium outline-none transition-colors hover:(bg-red-5 text-white) active:(bg-red-6 text-white) focus-visible:(ring-2 ring-red-2) disabled:opacity-60 dark:bg-slate-7 dark:hover:(bg-red-5 text-white) dark:active:(bg-red-6 text-white)"
              disabled={props.busy}
              onClick={props.onDiscard}
            >
              {t1("unsaved.discard")}
            </Button>
            <Button
              class="rounded-lg bg-primary-5 px3 py2 text-sm font-medium text-white outline-none hover:bg-primary-6 focus-visible:(ring-2 ring-primary-2) disabled:opacity-60"
              disabled={props.busy}
              onClick={props.onSave}
            >
              {props.busy ? t1("unsaved.saving") : t1("unsaved.save")}
            </Button>
          </div>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
