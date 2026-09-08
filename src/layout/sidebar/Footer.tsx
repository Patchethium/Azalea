import { AboutDialog } from "@dialogs/About";
import { DictionaryDialog } from "@dialogs/Dictionary";
import { ShortcutReferenceDialog } from "@dialogs/ShortcutReference";
import { UnsavedChangesDialog } from "@dialogs/UnsavedChanges";
import { Tooltip } from "@components/tooltip";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import style from "@layout/sidebar/sidebar.module.css";
import type { SidebarControls } from "@layout/sidebar/useSidebar";
import { usei18n } from "@contexts/i18n";
import type { PageType } from "@contexts/ui";

export function SidebarFooter(props: { controls: SidebarControls }) {
  const { t1 } = usei18n()!;
  const controls = props.controls;
  return (
    <>
      <div class="flex flex-row items-center gap-1">
        <DropdownMenu
          open={controls.actionMenuOpen()}
          onOpenChange={controls.setActionMenuOpen}
        >
          <DropdownMenu.Trigger
            aria-label={t1("menu.project_actions")}
            class="group p1 size-8 rounded-lg bg-white dark:bg-slate-8 shadow-md hover:bg-primary-5 data-[expanded]:bg-primary-5 transition-transform outline-none"
          >
            <div class="i-lucide:kanban bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white group-data-[expanded]:!bg-white" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Arrow size={8} />
            <DropdownMenu.Content class="bg-slate-1 dark:bg-slate-7 p-1 outline-none rounded-md ring-1 ring-slate-3 dark:ring-slate-5 shadow-xl shadow-slate-9/25 dark:shadow-slate-1/15">
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={() => controls.requestProjectAction("new")}
              >
                {t1("menu.new_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={() => controls.requestProjectAction("open")}
              >
                {t1("menu.load_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={controls.saveProject}
              >
                {t1("menu.save_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={controls.importSrt}
              >
                {t1("menu.import_srt")}
              </DropdownMenu.Item>
              <DropdownMenu.Separator class="mx-2 my-1" />
              <DropdownMenu.CheckboxItem
                checked={controls.autoSave()}
                onChange={controls.setAutoSave}
                class={style.menu_item}
              >
                {t1("menu.auto_save")}
                <DropdownMenu.ItemIndicator class="size-4">
                  <div class="i-lucide:check size-full" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.Separator class="mx-2 my-1" />
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={() => controls.setAboutOpen(true)}
              >
                {t1("menu.about")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={() => controls.requestProjectAction("quit")}
              >
                {t1("menu.quit")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <div class="flex items-center">
          <ToggleGroup
            class="flex items-center justify-start p-2 pl-0 gap-1"
            value={controls.uiStore.page}
            onChange={(page) => controls.setUIStore("page", page as PageType)}
          >
            <Tooltip content={t1("dictionary.open")}>
              <ToggleGroup.Item
                value="dictionary"
                aria-label={t1("dictionary.open")}
                class="group size-8 p1 rounded-lg bg-white dark:bg-slate-8 shadow-md hover:bg-primary-5 ui-pressed:bg-primary-5 transition-transform outline-none"
              >
                <div class="i-lucide:notebook-tabs bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white ui-pressed:!bg-white" />
              </ToggleGroup.Item>
            </Tooltip>
            <Tooltip content={t1("shortcuts.open")}>
              <ToggleGroup.Item
                value="shortcuts"
                aria-label={t1("shortcuts.open")}
                class="group size-8 p1 rounded-lg bg-white dark:bg-slate-8 shadow-md hover:bg-primary-5 ui-pressed:bg-primary-5 transition-transform outline-none"
              >
                <div class="i-lucide:keyboard bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white ui-pressed:!bg-white" />
              </ToggleGroup.Item>
            </Tooltip>
            <Tooltip content={t1("config.open")}>
              <ToggleGroup.Item
                value="config"
                aria-label={t1("config.open")}
                class="group size-8 p1 rounded-lg bg-white dark:bg-slate-8 shadow-md hover:bg-primary-5 ui-pressed:bg-primary-5 transition-transform outline-none"
              >
                <div class="i-lucide:cog bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white ui-pressed:!bg-white" />
              </ToggleGroup.Item>
            </Tooltip>
          </ToggleGroup>
        </div>
      </div>
      <AboutDialog
        open={controls.aboutOpen()}
        onOpenChange={controls.setAboutOpen}
      />
      <DictionaryDialog
        open={controls.uiStore.page === "dictionary"}
        onOpenChange={(open) =>
          controls.setUIStore("page", open ? "dictionary" : null)
        }
      />
      <ShortcutReferenceDialog
        open={controls.uiStore.page === "shortcuts"}
        onOpenChange={(open) =>
          controls.setUIStore("page", open ? "shortcuts" : null)
        }
      />
      <UnsavedChangesDialog
        open={controls.uiStore.pendingProjectAction !== null}
        busy={controls.resolvingProjectAction()}
        onSave={() => void controls.resolveProjectAction("save")}
        onDiscard={() => void controls.resolveProjectAction("discard")}
        onCancel={() => void controls.resolveProjectAction("cancel")}
      />
    </>
  );
}
