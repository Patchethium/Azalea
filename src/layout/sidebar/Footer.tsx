import { AboutDialog } from "@dialogs/About";
import { LicensesDialog } from "@dialogs/Licenses";
import { DictionaryDialog } from "@dialogs/Dictionary";
import { ExportAllDialog } from "@dialogs/ExportAll";
import { UnsavedChangesDialog } from "@dialogs/UnsavedChanges";
import { Tooltip } from "@components/tooltip";
import { SURFACE_BUTTON_CLASS } from "@components/toolbarButton";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { ToggleGroup } from "@kobalte/core/toggle-group";
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
  let menuTrigger: HTMLButtonElement | undefined;
  return (
    <>
      <div class="flex flex-row items-center gap-1">
        <DropdownMenu
          open={controls.actionMenuOpen()}
          onOpenChange={controls.setActionMenuOpen}
        >
          <DropdownMenu.Trigger
            ref={(element) => {
              menuTrigger = element;
            }}
            disabled={!voicesReady()}
            aria-label={t1("menu.project_actions")}
            class={`${SURFACE_BUTTON_CLASS} data-[expanded]:(bg-accent text-on-accent)`}
          >
            <div aria-hidden="true" class="i-lucide:kanban size-full" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Arrow size={8} />
            <DropdownMenu.Content class="menu-panel">
              <DropdownMenu.Item
                class="menu-item"
                onClick={() => controls.requestProjectAction("new")}
              >
                {t1("menu.new_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="menu-item"
                onClick={() => controls.requestProjectAction("open")}
              >
                {t1("menu.load_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="menu-item"
                disabled={controls.previousProject() === null}
                onClick={controls.openPreviousProject}
              >
                {t1("menu.open_previous_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Sub overlap gutter={4}>
                <DropdownMenu.SubTrigger
                  class="menu-item"
                  disabled={controls.recentProjects().length === 0}
                >
                  {t1("menu.open_recent")}
                  <div class="i-lucide:chevron-right size-4 shrink-0" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent class="menu-panel max-w-[min(90vw,28rem)]">
                    <For each={controls.recentProjects()}>
                      {(path) => (
                        <DropdownMenu.Item
                          class="menu-item-stacked"
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
                    <DropdownMenu.Separator class="menu-separator" />
                    <DropdownMenu.Item
                      class="menu-item"
                      onClick={controls.clearRecentProjects}
                    >
                      {t1("menu.clear_recent")}
                    </DropdownMenu.Item>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Item
                class="menu-item"
                onClick={controls.saveProject}
              >
                {t1("menu.save_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="menu-item"
                onClick={controls.saveProjectAs}
              >
                {t1("menu.save_project_as")}
              </DropdownMenu.Item>
              <DropdownMenu.Separator class="menu-separator" />
              <DropdownMenu.Item class="menu-item" onClick={controls.importSrt}>
                {t1("menu.import_srt")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="menu-item"
                onClick={controls.importText}
              >
                {t1("menu.import_text")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="menu-item"
                disabled={controls.exportAllRunning()}
                onClick={() => void controls.exportAll()}
              >
                {t1("menu.export_all")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="menu-item"
                disabled={controls.exportCombinedRunning()}
                onClick={() => void controls.exportCombined()}
              >
                {t1("menu.export_all_combined")}
              </DropdownMenu.Item>
              <DropdownMenu.Separator class="menu-separator" />
              <DropdownMenu.Item
                class="menu-item"
                onClick={() => {
                  controls.setActionMenuOpen(false);
                  controls.setLicensesOpen(true);
                }}
              >
                {t1("menu.licenses")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="menu-item"
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
                class={`${SURFACE_BUTTON_CLASS} ui-pressed:(bg-accent text-on-accent)`}
              >
                <div
                  aria-hidden="true"
                  class="i-lucide:notebook-tabs size-full"
                />
              </ToggleGroup.Item>
            </Tooltip>
            <Tooltip content={t1("config.open")}>
              <ToggleGroup.Item
                value="config"
                aria-label={t1("config.open")}
                class={`${SURFACE_BUTTON_CLASS} ui-pressed:(bg-accent text-on-accent)`}
              >
                <div aria-hidden="true" class="i-lucide:cog size-full" />
              </ToggleGroup.Item>
            </Tooltip>
          </ToggleGroup>
        </div>
      </div>
      <AboutDialog
        open={controls.aboutOpen()}
        onOpenChange={controls.setAboutOpen}
      />
      <LicensesDialog
        open={controls.licensesOpen()}
        onOpenChange={(open) => {
          controls.setLicensesOpen(open);
          if (!open) menuTrigger?.focus();
        }}
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
