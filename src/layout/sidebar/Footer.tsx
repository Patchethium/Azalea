import { AboutDialog } from "@dialogs/About";
import { DictionaryDialog } from "@dialogs/Dictionary";
import { ExportAllDialog } from "@dialogs/ExportAll";
import { UnsavedChangesDialog } from "@dialogs/UnsavedChanges";
import { Tooltip } from "@components/tooltip";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import style from "@layout/sidebar/sidebar.module.css";
import type { SidebarControls } from "@layout/sidebar/useSidebar";
import { usei18n } from "@contexts/i18n";
import type { PageType } from "@contexts/ui";
import { useConfigStore } from "@contexts/config";
import { For } from "solid-js";

const projectFileName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function SidebarFooter(props: { controls: SidebarControls }) {
  const { t1 } = usei18n()!;
  const controls = props.controls;
  const { voicesReady } = useConfigStore()!;
  return (
    <>
      <div class="flex flex-row items-center gap-1">
        <DropdownMenu
          open={controls.actionMenuOpen()}
          onOpenChange={controls.setActionMenuOpen}
        >
          <DropdownMenu.Trigger
            disabled={!voicesReady()}
            aria-label={t1("menu.project_actions")}
            class="group p1 size-8 rounded-lg bg-white dark:bg-slate-8 shadow-md enabled:hover:bg-primary-5 disabled:(cursor-not-allowed grayscale) data-[expanded]:bg-primary-5 transition-transform outline-none"
          >
            <div class="i-lucide:kanban bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white group-data-[expanded]:!bg-white" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Arrow size={8} />
            <DropdownMenu.Content class="bg-slate-1 dark:bg-slate-7 p-1 outline-none rounded-md ring-1 ring-slate-3 dark:ring-slate-5 shadow-xl">
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
                disabled={controls.previousProject() === null}
                onClick={controls.openPreviousProject}
              >
                {t1("menu.open_previous_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Sub overlap gutter={4}>
                <DropdownMenu.SubTrigger
                  class={style.menu_item}
                  disabled={controls.recentProjects().length === 0}
                >
                  {t1("menu.open_recent")}
                  <div class="i-lucide:chevron-right size-4 shrink-0" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent class="max-w-[min(90vw,28rem)] bg-slate-1 dark:bg-slate-7 p-1 outline-none rounded-md ring-1 ring-slate-3 dark:ring-slate-5 shadow-xl">
                    <For each={controls.recentProjects()}>
                      {(path) => (
                        <DropdownMenu.Item
                          class={style.recent_item}
                          textValue={projectFileName(path)}
                          onClick={() => controls.openRecentProject(path)}
                        >
                          <span class="truncate text-sm">
                            {projectFileName(path)}
                          </span>
                          <span class="truncate text-xs opacity-70">
                            {path}
                          </span>
                        </DropdownMenu.Item>
                      )}
                    </For>
                    <DropdownMenu.Separator class="mx-2 my-1" />
                    <DropdownMenu.Item
                      class={style.menu_item}
                      onClick={controls.clearRecentProjects}
                    >
                      {t1("menu.clear_recent")}
                    </DropdownMenu.Item>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={controls.saveProject}
              >
                {t1("menu.save_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={controls.saveProjectAs}
              >
                {t1("menu.save_project_as")}
              </DropdownMenu.Item>
              <DropdownMenu.Separator class="mx-2 my-1" />
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={controls.importSrt}
              >
                {t1("menu.import_srt")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={style.menu_item}
                onClick={controls.importText}
              >
                {t1("menu.import_text")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={style.menu_item}
                disabled={controls.exportAllRunning()}
                onClick={() => void controls.exportAll()}
              >
                {t1("menu.export_all")}
              </DropdownMenu.Item>
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
        <div class="flex items-center">
          <ToggleGroup
            class="flex items-center justify-start p-2 pl-0 gap-1"
            value={controls.uiStore.page}
            onChange={(page) => controls.setUIStore("page", page as PageType)}
          >
            <Tooltip content={t1("dictionary.open")}>
              <ToggleGroup.Item
                value="dictionary"
                disabled={!voicesReady()}
                aria-label={t1("dictionary.open")}
                class="group size-8 p1 rounded-lg bg-white dark:bg-slate-8 shadow-md enabled:hover:bg-primary-5 disabled:(cursor-not-allowed grayscale) ui-pressed:bg-primary-5 transition-transform outline-none"
              >
                <div class="i-lucide:notebook-tabs bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white ui-pressed:!bg-white" />
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
      <UnsavedChangesDialog
        open={controls.uiStore.pendingProjectAction !== null}
        busy={controls.resolvingProjectAction()}
        onSave={() => void controls.resolveProjectAction("save")}
        onDiscard={() => void controls.resolveProjectAction("discard")}
        onCancel={() => void controls.resolveProjectAction("cancel")}
      />
      <ExportAllDialog
        open={controls.exportAllOpen()}
        running={controls.exportAllRunning()}
        cancelling={controls.exportAllCancelling()}
        finished={controls.exportAllFinished()}
        total={controls.exportAllTotal()}
        cancelled={controls.exportAllCancelled()}
        failures={controls.exportAllFailures()}
        outputDir={controls.exportAllOutputDir()}
        onCancel={controls.cancelExportAll}
        onClose={controls.closeExportAll}
      />
    </>
  );
}
