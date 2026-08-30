import { MultiProvider } from "@solid-primitives/context";
import { render } from "@solidjs/testing-library";
import type { Component } from "solid-js";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider, useMetaStore } from "@contexts/meta";
import {
  SpectrogramProvider,
  useSpectrogramStore,
} from "@contexts/spectrogram";
import {
  ShortcutsProvider,
  useShortcutsStore,
} from "@contexts/shortcuts";
import { SystemProvider } from "@contexts/system";
import { TextProvider, useTextStore } from "@contexts/text";
import { UIProvider, useUIStore } from "@contexts/ui";

export function renderMetaStore() {
  let store!: NonNullable<ReturnType<typeof useMetaStore>>;
  const Probe: Component = () => {
    store = useMetaStore()!;
    return null;
  };
  const rendered = render(() => (
    <MultiProvider values={[[MetaProvider, []]]}>
      <Probe />
    </MultiProvider>
  ));
  return { ...rendered, store };
}

export function renderSpectrogramStore() {
  let store!: NonNullable<ReturnType<typeof useSpectrogramStore>>;
  const Probe: Component = () => {
    store = useSpectrogramStore()!;
    return null;
  };
  render(() => (
    <MultiProvider values={[[SpectrogramProvider, null]]}>
      <Probe />
    </MultiProvider>
  ));
  return store;
}

export function renderConfigStore() {
  let store!: NonNullable<ReturnType<typeof useConfigStore>>;
  const Probe: Component = () => {
    store = useConfigStore()!;
    return null;
  };
  render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
      ]}
    >
      <Probe />
    </MultiProvider>
  ));
  return store;
}

export function renderShortcutsStore() {
  let shortcuts!: NonNullable<ReturnType<typeof useShortcutsStore>>;
  let config!: NonNullable<ReturnType<typeof useConfigStore>>;
  const Probe: Component = () => {
    shortcuts = useShortcutsStore()!;
    config = useConfigStore()!;
    return null;
  };
  const rendered = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [ShortcutsProvider, null],
      ]}
    >
      <Probe />
    </MultiProvider>
  ));
  return { ...rendered, shortcuts, config };
}

export function renderTextStores() {
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  let ui!: NonNullable<ReturnType<typeof useUIStore>>;
  let meta!: NonNullable<ReturnType<typeof useMetaStore>>;
  const Probe: Component = () => {
    text = useTextStore()!;
    ui = useUIStore()!;
    meta = useMetaStore()!;
    return null;
  };
  render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [SpectrogramProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <Probe />
    </MultiProvider>
  ));
  return { text, ui, meta };
}
