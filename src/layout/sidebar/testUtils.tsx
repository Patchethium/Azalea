import Sidebar from "@layout/sidebar";
import { useSidebar } from "@layout/sidebar/useSidebar";
import { MultiProvider } from "@solid-primitives/context";
import { render } from "@solidjs/testing-library";
import { type Component, onMount } from "solid-js";
import { ConfigProvider, useConfigStore } from "../../contexts/config";
import { i18nProvider } from "../../contexts/i18n";
import { MetaProvider, useMetaStore } from "../../contexts/meta";
import { SystemProvider } from "../../contexts/system";
import { TextProvider, useTextStore } from "../../contexts/text";
import { UIProvider } from "../../contexts/ui";

export type SidebarTestStores = {
  config: NonNullable<ReturnType<typeof useConfigStore>>;
  meta: NonNullable<ReturnType<typeof useMetaStore>>;
  text: NonNullable<ReturnType<typeof useTextStore>>;
};

export function renderSidebar(setup: (stores: SidebarTestStores) => void) {
  const Harness: Component = () => {
    const stores = {
      config: useConfigStore()!,
      meta: useMetaStore()!,
      text: useTextStore()!,
    };
    onMount(() => setup(stores));
    return <Sidebar />;
  };
  return render(() => (
    <main>
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, null],
          [SystemProvider, null],
          [i18nProvider, null],
          [TextProvider, null],
        ]}
      >
        <Harness />
      </MultiProvider>
    </main>
  ));
}

export function renderSidebarHook(setup: (stores: SidebarTestStores) => void) {
  let controls!: ReturnType<typeof useSidebar>;
  const Harness: Component = () => {
    controls = useSidebar();
    const stores = {
      config: useConfigStore()!,
      meta: useMetaStore()!,
      text: useTextStore()!,
    };
    onMount(() => setup(stores));
    return (
      <div ref={controls.setPresetSplitter}>
        <button ref={controls.setPresetResizeHandle} type="button" />
        <h2 ref={controls.setPresetPanelHeader}>Preset</h2>
        <div ref={controls.setPresetPanelContent} />
      </div>
    );
  };
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
  return { ...result, getControls: () => controls };
}
