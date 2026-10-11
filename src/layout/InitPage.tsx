import { AppButton } from "@components/button";
import { usei18n } from "@contexts/i18n";
import { useUIStore } from "@contexts/ui";

function InitPage() {
  const { t1 } = usei18n()!;
  const { setUIStore } = useUIStore()!;

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
      <AppButton
        onClick={() => setUIStore({ page: "config", configSection: "voice" })}
      >
        {t1("config.open")}
      </AppButton>
    </div>
  );
}

export default InitPage;
