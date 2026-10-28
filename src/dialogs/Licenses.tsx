import { commands, type DependencyLicense } from "$binding";
import { AppButton } from "@components/button";
import { IconButton } from "@components/iconButton";
import { usei18n } from "@contexts/i18n";
import { AppDialogContent } from "@dialogs/AppContent";
import { Dialog } from "@kobalte/core/dialog";
import { Listbox } from "@kobalte/core/listbox";
import { TextField } from "@kobalte/core/text-field";
import { createVirtualizer, observeElementRect } from "@tanstack/solid-virtual";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onMount,
  Show,
} from "solid-js";

interface LibraryLicenses {
  key: string;
  name: string;
  versions: string[];
  licenses: DependencyLicense[];
}

interface LicensesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LicensesDialog(props: LicensesDialogProps) {
  const { t1 } = usei18n()!;
  const [requested, setRequested] = createSignal(false);
  const [licenses, { refetch }] = createResource(
    () => props.open || requested(),
    async () => {
      setRequested(true);
      return commands.getDependencyLicenses();
    },
  );
  const libraries = createMemo(() => {
    const entries = licenses.error ? [] : (licenses.latest ?? []);
    const packages = new Map<
      string,
      {
        name: string;
        version: string;
        licenses: Map<string, DependencyLicense>;
      }
    >();
    for (const license of entries) {
      const licenseKey = JSON.stringify([license.id, license.text]);
      for (const pkg of license.packages) {
        const key = JSON.stringify([pkg.name, pkg.version]);
        const library = packages.get(key) ?? { ...pkg, licenses: new Map() };
        library.licenses.set(licenseKey, license);
        packages.set(key, library);
      }
    }
    const groups = new Map<string, Omit<LibraryLicenses, "key">>();
    for (const pkg of packages.values()) {
      // Compare complete sets, including copyright variants and extra notices.
      const signature = JSON.stringify([
        pkg.name,
        [...pkg.licenses.keys()].sort(),
      ]);
      const group = groups.get(signature) ?? {
        name: pkg.name,
        versions: [],
        licenses: [...pkg.licenses.values()],
      };
      group.versions.push(pkg.version);
      groups.set(signature, group);
    }
    return [...groups.values()]
      .map((group) => {
        group.versions.sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        );
        return {
          ...group,
          key: encodeURIComponent(JSON.stringify([group.name, group.versions])),
        };
      })
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          a.versions[0].localeCompare(b.versions[0], undefined, {
            numeric: true,
          }),
      );
  });
  const [search, setSearch] = createSignal("");
  let searchInput: HTMLInputElement | undefined;
  const filteredLibraries = createMemo(() => {
    const query = search().trim().toLowerCase();
    return libraries().filter((library) =>
      `${library.name} ${library.versions.join(", ")}`
        .toLowerCase()
        .includes(query),
    );
  });
  const [selectedKey, setSelectedKey] = createSignal<string>();
  const selectedLibrary = createMemo(
    () =>
      filteredLibraries().find((library) => library.key === selectedKey()) ??
      filteredLibraries()[0],
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("licenses.title")}
        closeLabel={t1("licenses.close")}
        class="w-[min(90vw,56rem)]"
      >
        <div class="min-h-0 flex flex-col">
          <Show when={licenses.loading}>
            <p role="status" class="px5 py4">
              {t1("licenses.loading")}
            </p>
          </Show>
          <Show when={licenses.error}>
            <div role="alert" class="flex items-center gap3 px5 py4">
              <p>{t1("licenses.error")}</p>
              <AppButton onClick={() => void refetch()}>
                {t1("licenses.retry")}
              </AppButton>
            </div>
          </Show>
          <Show when={!licenses.error && libraries().length > 0}>
            <div class="h-[65vh] min-h-0 flex">
              <div class="w-1/3 max-w-64 min-h-0 shrink-0 flex flex-col b-r b-slate-2 dark:b-slate-6">
                <div class="shrink-0 flex items-center gap2 px3 py3">
                  <h3 class="shrink-0 text-sm font-semibold">
                    {t1("licenses.libraries")}
                  </h3>
                  <TextField
                    value={search()}
                    onChange={setSearch}
                    class="min-w-0 flex-1"
                  >
                    <div class="flex items-center gap1.5 rounded-lg b b-border bg-surface px2 focus-within:b-focus-ring dark:bg-surface-raised">
                      <div
                        aria-hidden="true"
                        class="i-lucide:search pointer-events-none size-3.5 shrink-0 text-ink-subtle"
                      />
                      <TextField.Input
                        ref={(element) => {
                          searchInput = element;
                        }}
                        type="search"
                        aria-label={t1("licenses.search")}
                        placeholder={t1("licenses.search_placeholder")}
                        class="w-full min-w-0 flex-1 appearance-none bg-transparent py1 text-xs outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                      />
                      <Show when={search().length > 0}>
                        <IconButton
                          icon="i-lucide:x"
                          size="xs"
                          label={t1("licenses.clear_search")}
                          onClick={() => {
                            setSearch("");
                            searchInput?.focus();
                          }}
                        />
                      </Show>
                    </div>
                  </TextField>
                </div>
                <Show
                  when={filteredLibraries().length > 0}
                  fallback={
                    <p role="status" class="px3 py2 text-sm text-slate-5">
                      {t1("licenses.no_matches")}
                    </p>
                  }
                >
                  <LibraryList
                    libraries={filteredLibraries()}
                    selectedKey={selectedLibrary()?.key}
                    onChange={setSelectedKey}
                    label={t1("licenses.libraries")}
                  />
                </Show>
              </div>
              <Show when={selectedLibrary()} keyed>
                {(library) => (
                  <section
                    class="min-w-0 flex-1 overflow-y-auto px5 py4 select-text outline-none focus-visible:ring-2 ring-inset ring-primary-3"
                    tabindex="0"
                    aria-label={`${library.name} ${library.versions.join(", ")}`}
                  >
                    <h3 class="text-lg font-semibold break-words">
                      {library.name} {library.versions.join(", ")}
                    </h3>
                    <div class="mt4 flex flex-col gap6">
                      <For each={library.licenses}>
                        {(license) => (
                          <div>
                            <h4 class="text-base font-semibold">
                              {license.name} ({license.id})
                            </h4>
                            <pre class="mt3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                              {license.text}
                            </pre>
                          </div>
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </Show>
            </div>
          </Show>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}

function LibraryList(props: {
  libraries: LibraryLicenses[];
  selectedKey: string | undefined;
  onChange: (key: string | undefined) => void;
  label: string;
}) {
  const [listScrollElement, setListScrollElement] =
    createSignal<HTMLDivElement>();
  const [mounted, setMounted] = createSignal(false);
  onMount(() => setMounted(true));
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
    get enabled() {
      return mounted();
    },
    get count() {
      return props.libraries.length;
    },
    getScrollElement: () => listScrollElement() ?? null,
    getItemKey: (index) => props.libraries[index].key,
    estimateSize: () => 60,
    overscan: 5,
    initialRect: { width: 1, height: 1 },
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) => {
        if (rect.height > 0) callback(rect);
      }),
  });
  createEffect(
    on(
      () => props.libraries,
      () => {
        virtualizer.scrollToOffset(0);
      },
    ),
  );

  return (
    <div
      ref={setListScrollElement}
      class="min-h-0 flex-1 overflow-y-auto px2 pb2"
    >
      <Listbox<LibraryLicenses>
        aria-label={props.label}
        options={props.libraries}
        optionValue="key"
        optionTextValue={(library) =>
          `${library.name} ${library.versions.join(", ")}`
        }
        selectionMode="single"
        disallowEmptySelection
        selectOnFocus
        value={props.selectedKey ? [props.selectedKey] : []}
        onChange={(keys) => props.onChange([...keys][0])}
        virtualized
        scrollRef={listScrollElement}
        scrollToItem={(key) => {
          const index = props.libraries.findIndex(
            (library) => library.key === key,
          );
          if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
        }}
        class="relative outline-none"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {(items) => (
          <For each={virtualizer.getVirtualItems()}>
            {(row) => (
              <Show when={items().getItem(String(row.key))} keyed>
                {(item) => (
                  <Listbox.Item
                    item={item}
                    ref={(element) => virtualizer.measureElement(element)}
                    data-index={row.index}
                    style={{
                      position: "absolute",
                      top: "0",
                      left: "0",
                      width: "100%",
                      transform: `translateY(${row.start}px)`,
                    }}
                    class="cursor-pointer select-none rounded-md px3 py2 outline-none hover:bg-slate-1 dark:hover:bg-slate-7 data-[selected]:(!bg-primary-5 text-white) data-[highlighted]:ring-2 ring-inset ring-primary-3"
                  >
                    <Listbox.ItemLabel class="break-words text-sm">
                      {item.rawValue.name}
                    </Listbox.ItemLabel>
                    <Listbox.ItemDescription class="mt1 break-words text-xs opacity-70">
                      {item.rawValue.versions.join(", ")}
                    </Listbox.ItemDescription>
                  </Listbox.Item>
                )}
              </Show>
            )}
          </For>
        )}
      </Listbox>
    </div>
  );
}
