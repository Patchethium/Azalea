import { AppButton } from "@components/button";
import { usei18n } from "@contexts/i18n";
import { AppDialogContent } from "@dialogs/AppContent";
import { I18NSelect } from "@dialogs/config/Basics";
import { VoiceSetup } from "@dialogs/VoiceSetup";
import { Dialog } from "@kobalte/core/dialog";
import { createSignal } from "solid-js";

function InitPage() {
  const { t1 } = usei18n()!;
  const [open, setOpen] = createSignal(false);

  return (
    <div class="size-full flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div
        aria-hidden="true"
        class="i-lucide:audio-lines size-10 text-slate-4 dark:text-slate-5"
      />
      <div>
        <h2 class="font-semibold">{t1("init_dialog.intro")}</h2>
        <p class="mt-1 text-sm text-slate-5 dark:text-slate-4">
          {t1("init_dialog.before")}
        </p>
      </div>
      <AppButton onClick={() => setOpen(true)}>{t1("config.open")}</AppButton>
      <Dialog open={open()} onOpenChange={setOpen}>
        <AppDialogContent
          title={t1("voice_setup.title")}
          closeLabel={t1("voice_setup.close_setup")}
          class="w-[min(90vw,32rem)]"
        >
          <div class="overflow-auto px4 pb4 text-left">
            <VoiceSetup modelManager="inline" />
            <I18NSelect />
          </div>
        </AppDialogContent>
      </Dialog>
    </div>
  );
}

export default InitPage;
