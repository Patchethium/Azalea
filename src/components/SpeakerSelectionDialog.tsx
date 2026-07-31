import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import { For, Show } from "solid-js";
import type { CharacterMeta } from "../binding";
import { usei18n } from "../contexts/i18n";
import { AppDialogContent } from "./AppDialogContent";

interface SpeakerSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  speakers: CharacterMeta[];
  selectedSpeakerUuid: string | null;
  onSelect: (speaker: CharacterMeta) => void;
}

export function SpeakerSelectionDialog(props: SpeakerSelectionDialogProps) {
  const { t1 } = usei18n()!;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("speaker_selection.title")}
        closeLabel={t1("speaker_selection.close")}
        class="max-h-[80vh] w-[min(90vw,48rem)]"
      >
        <div class="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap3 overflow-y-auto p4">
          <For each={props.speakers}>
            {(speaker) => {
              const selected = () =>
                speaker.speaker_uuid === props.selectedSpeakerUuid;
              return (
                <Button
                  type="button"
                  aria-pressed={selected()}
                  onClick={() => props.onSelect(speaker)}
                  class="relative min-h-24 flex flex-col items-center justify-center gap2 rounded-xl b b-slate-2 bg-slate-1/70 p3 text-center outline-none transition-colors hover:(b-primary-5 bg-primary-1) focus-visible:(ring-2 ring-primary-3) dark:(b-slate-6 bg-slate-7/50) dark:hover:(b-primary-5 bg-slate-7)"
                  classList={{
                    "!b-primary-5 bg-primary-1 dark:bg-slate-7": selected(),
                  }}
                >
                  <div class="i-lucide:mic-2 size-7 text-primary-5" />
                  <span class="font-medium">{speaker.name}</span>
                  <Show when={selected()}>
                    <div class="absolute right2 top2 i-lucide:check size-4 text-primary-5" />
                  </Show>
                </Button>
              );
            }}
          </For>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
