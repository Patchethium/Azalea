import { createSortable, SortableDropIndicator } from "@components/sortable";
import { usei18n } from "@contexts/i18n";
import Resizable from "@corvu/resizable";
import { PresetManagerDialog } from "@dialogs/PresetManager";
import { PresetCard } from "@layout/sidebar/preset/Card";
import { PresetEditor } from "@layout/sidebar/preset/Editor";
import { PresetToolbar } from "@layout/sidebar/preset/Toolbar";
import type { SidebarControls } from "@layout/sidebar/useSidebar";
import { batch, createSignal, For, onCleanup, onMount, Show } from "solid-js";

const PRESET_PANEL_MIN_HEIGHT = "30px";
const PRESET_PANEL_BORDER_HEIGHT = 3;
const RESIZE_EPSILON = 0.000001;

export function PresetSidebar(props: { controls: SidebarControls }) {
  const { t1 } = usei18n()!;
  const presetSortable = createSortable({
    count: () => props.controls.projectPresetStore.length,
    onMove: (from, to) => props.controls.movePreset(from, to),
  });
  const controls = props.controls;
  const [presetPanelSizes, setPresetPanelSizes] = createSignal([0.3, 0.7]);
  const [presetPanelMaxSize, setPresetPanelMaxSize] = createSignal(1);
  let presetSplitter: HTMLDivElement | undefined;
  let presetResizeHandle: HTMLButtonElement | undefined;
  let presetPanelHeader: HTMLHeadingElement | undefined;
  let presetPanelContent: HTMLDivElement | undefined;

  const updatePresetPanelMaxSize = () => {
    if (
      presetSplitter === undefined ||
      presetResizeHandle === undefined ||
      presetPanelHeader === undefined ||
      presetPanelContent === undefined
    ) {
      return;
    }

    const availableHeight =
      presetSplitter.offsetHeight - presetResizeHandle.offsetHeight;
    if (availableHeight <= 0) return;

    const contentHeight =
      presetPanelHeader.offsetHeight +
      presetPanelContent.scrollHeight +
      PRESET_PANEL_BORDER_HEIGHT;
    const maxSize = Math.min(contentHeight / availableHeight, 1);
    const currentSize = presetPanelSizes()[1];
    const previousMaxSize = presetPanelMaxSize();
    const followsContentHeight =
      currentSize !== 0 &&
      Math.abs(currentSize - previousMaxSize) <= RESIZE_EPSILON;
    const nextSize = followsContentHeight
      ? maxSize
      : Math.min(currentSize, maxSize);

    batch(() => {
      setPresetPanelMaxSize(maxSize);
      if (Math.abs(currentSize - nextSize) > RESIZE_EPSILON) {
        setPresetPanelSizes([1 - nextSize, nextSize]);
      }
    });
  };

  onMount(() => {
    const observer = new ResizeObserver(updatePresetPanelMaxSize);
    if (presetSplitter !== undefined) observer.observe(presetSplitter);
    if (presetPanelHeader !== undefined) observer.observe(presetPanelHeader);
    if (presetPanelContent !== undefined) observer.observe(presetPanelContent);
    queueMicrotask(updatePresetPanelMaxSize);
    onCleanup(() => observer.disconnect());
  });

  return (
    <>
      <PresetToolbar controls={controls} />
      <Resizable
        ref={(element) => {
          presetSplitter = element;
          updatePresetPanelMaxSize();
        }}
        orientation="vertical"
        sizes={presetPanelSizes()}
        onSizesChange={(sizes) => {
          if (sizes.length !== 2) return;
          const size = Math.min(sizes[1], presetPanelMaxSize());
          if (Math.abs(presetPanelSizes()[1] - size) > RESIZE_EPSILON) {
            setPresetPanelSizes([1 - size, size]);
          }
        }}
        class="size-full min-h-0"
      >
        <Resizable.Panel
          class="min-h-0 overflow-hidden"
          initialSize={0.3}
          minSize={0.1}
        >
          <div class="size-full flex flex-col overflow-hidden">
            <div class="size-full gap-1 overflow-auto pl-0 pr-2 pt-1">
              <For each={controls.projectPresetStore}>
                {(preset, index) => (
                  <div
                    ref={(element) =>
                      presetSortable.registerItem(element, index)
                    }
                    class="relative"
                    classList={{
                      "opacity-50": presetSortable.isDragging(index()),
                    }}
                  >
                    <SortableDropIndicator
                      sortable={presetSortable}
                      index={index()}
                    />
                    <PresetCard
                      presetIndex={index()}
                      selected={preset.id === controls.currentText()?.preset_id}
                      sortable={presetSortable}
                      onClick={() => controls.setTextPresetIdx(index())}
                    />
                  </div>
                )}
              </For>
            </div>
            <PresetManagerDialog
              open={controls.presetManagerOpen()}
              onOpenChange={controls.setPresetManagerOpen}
            />
          </div>
        </Resizable.Panel>
        <Resizable.Handle
          ref={(element) => {
            presetResizeHandle = element;
            updatePresetPanelMaxSize();
          }}
          aria-label={t1("preset.title")}
          data-preset-editor-resize-handle
          class="group basis-2 px-[2px] bg-transparent flex items-center justify-center"
        >
          <div class="w-full h-[1px] rounded motion-safe:transition-colors bg-transparent group-hover:bg-accent group-active:bg-accent" />
        </Resizable.Handle>
        <Resizable.Panel
          class="min-h-0 overflow-hidden"
          initialSize={0.7}
          minSize={PRESET_PANEL_MIN_HEIGHT}
          collapsible
          collapseThreshold={0.05}
        >
          <section class="size-full min-h-0 flex flex-col rounded-md bg-surface border border-border bg-transparent shadow-sm">
            <h2
              ref={(element) => {
                presetPanelHeader = element;
                updatePresetPanelMaxSize();
              }}
              data-preset-editor-header
              class="shrink-0 select-none cursor-default p1 px2"
            >
              {t1("preset.title")}
            </h2>
            <div class="min-h-0 flex-1 overflow-y-auto b-t b-border py0 px2 flex flex-col">
              <div
                ref={(element) => {
                  presetPanelContent = element;
                  updatePresetPanelMaxSize();
                }}
                data-preset-editor-content
                class="flex flex-col"
              >
                <Show
                  when={controls.currentPreset()}
                  fallback={
                    <div class="text-sm text-ink-subtle p1 select-none cursor-default">
                      {controls.projectPresetStore.length
                        ? t1("preset.no_preset_selected")
                        : t1("preset.get_started")}
                    </div>
                  }
                >
                  {(preset) => (
                    <PresetEditor
                      preset={preset()}
                      onChange={controls.updateCurrentPreset}
                    />
                  )}
                </Show>
              </div>
            </div>
          </section>
        </Resizable.Panel>
      </Resizable>
    </>
  );
}
