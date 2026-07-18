import { Dialog } from "@kobalte/core/dialog";
import { Link } from "@kobalte/core/link";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import azaleaLogo from "../../icon/azalea.png";
import { usei18n } from "../contexts/i18n";
import { AppDialogContent } from "./AppDialogContent";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog(props: AboutDialogProps) {
  const { t1 } = usei18n()!;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("about.title")}
        closeLabel={t1("about.close")}
        class="w-[min(90vw,34rem)]"
      >
        <div class="relative overflow-hidden bg-gradient-to-br from-primary-5 via-primary-6 to-slate-9 px6 py6 text-white">
          <div class="absolute -right-8 -top-12 size-36 rounded-full bg-white/10" />
          <div class="absolute -bottom-20 right-16 size-48 rounded-full b b-white/10" />
          <div class="relative flex items-center gap4">
            <div class="size-18 shrink-0 rounded-2xl bg-white p2 shadow-xl rotate-3">
              <img
                src={azaleaLogo}
                alt="Azalea"
                class="size-full rounded-xl object-contain"
              />
            </div>
            <div class="min-w-0">
              <div class="text-2xl font-bold tracking-tight">Azalea</div>
              <div class="mt1 text-sm text-white/75">{t1("about.tagline")}</div>
            </div>
          </div>
        </div>
        <div class="flex flex-col gap4 px5 py5">
          <div class="grid grid-cols-2 gap3">
            <div class="rounded-xl b b-slate-2 dark:b-slate-6 bg-slate-1/70 dark:bg-slate-7/50 p3">
              <div class="mb2 flex items-center gap2 text-slate-6 dark:text-slate-3">
                <div class="i-lucide:tag size-4" />
                <span class="text-xs uppercase tracking-wider">
                  {t1("about.version")}
                </span>
              </div>
              <div class="font-mono text-lg font-semibold">0.1.0</div>
            </div>
            <div class="rounded-xl b b-slate-2 dark:b-slate-6 bg-slate-1/70 dark:bg-slate-7/50 p3">
              <div class="mb2 flex items-center gap2 text-slate-6 dark:text-slate-3">
                <div class="i-lucide:code-2 size-4" />
                <span class="text-xs uppercase tracking-wider">
                  {t1("about.license")}
                </span>
              </div>
              <div class="text-lg font-semibold">GPLv3</div>
            </div>
          </div>
          <Link
            onClick={() =>
              openExternal("https://github.com/Patchethium/Azalea")
            }
            class="group flex items-center gap3 rounded-xl bg-slate-1 px4 py3 text-slate-8 b b-slate-2 transition-colors hover:(bg-primary-5 text-white b-primary-5) dark:bg-slate-7 dark:text-slate-1 dark:b-slate-6"
          >
            <div class="flex size-9 items-center justify-center rounded-lg bg-white text-slate-8 shadow-sm group-hover:bg-white/20 group-hover:text-white dark:bg-slate-8 dark:text-white">
              <div class="i-lucide:github size-5" />
            </div>
            <div class="flex-1">
              <div class="font-semibold">{t1("about.github")}</div>
              <div class="text-xs opacity-70">Patchethium/Azalea</div>
            </div>
            <div class="i-lucide:arrow-up-right size-5 opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
