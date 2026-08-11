import { AboutDialog } from "@dialogs/About";
import { ShortcutReferenceDialog } from "@dialogs/ShortcutReference";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import style from "@layout/sidebar/sidebar.module.css";
import type { SidebarControls } from "@layout/sidebar/useSidebar";
import { usei18n } from "../../contexts/i18n";
import type { PageType } from "../../contexts/ui";

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
            class="group p1 size-8 rounded-lg bg-white dark:bg-slate-8 shadow-md hover:bg-primary-5 ui-expanded:bg-primary-5 transition-transform outline-none"
          >
            <div class="i-lucide:kanban bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white ui-expanded:!bg-white" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Arrow size={8} />
            <DropdownMenu.Content class="bg-white dark:bg-slate-8 p-1 outline-none shadow-md rounded-md b b-slate-2 dark:b-slate-6">
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={controls.newProject}
              >
                {t1("menu.new_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={controls.loadProject}
              >
                {t1("menu.load_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={controls.saveProject}
              >
                {t1("menu.save_project")}
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
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <div class="flex items-center justify-start p-2 pl-0 gap-1">
          <ShortcutReferenceDialog />
          <ToggleGroup
            class="flex items-center"
            value={controls.uiStore.page}
            onChange={(page) => controls.setUIStore("page", page as PageType)}
          >
            <ToggleGroup.Item
              value="config"
              class="group size-8 p1 rounded-lg bg-white dark:bg-slate-8 shadow-md hover:bg-primary-5 ui-pressed:bg-primary-5 transition-transform"
            >
              <div class="i-lucide:cog bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white ui-pressed:!bg-white" />
            </ToggleGroup.Item>
          </ToggleGroup>
        </div>
      </div>
      <AboutDialog
        open={controls.aboutOpen()}
        onOpenChange={controls.setAboutOpen}
      />
    </>
  );
}
