# Speaker Selection Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a grid dialog beside the preset speaker selector that selects a speaker's first style and closes immediately.

**Architecture:** A controlled `SpeakerSelectionDialog` presents metadata-owned speakers and reports a selected `CharacterMeta` without accessing application stores. `Sidebar` owns open state and routes the selected speaker's first `StyleId` through its existing `setStyleId` function so project identity fields and query-reset behavior remain centralized.

**Tech Stack:** SolidJS 1.9, TypeScript 5.9, Kobalte Dialog/Button, UnoCSS, Vitest, Solid Testing Library.

## Global Constraints

- Keep the existing speaker and style selectors in the preset Accordion.
- Every VOICEVOX speaker has at least one style; do not add disabled or empty-style speaker states.
- Select cards by stable `speaker_uuid`, not display name.
- Selecting a speaker uses `speaker.styles[0].id`, closes the dialog, and leaves later style selection to the Accordion.
- Preserve `setStyleId` as the only preset identity update path so `style_id`, `speaker_uuid`, `style_name`, and `query_is_modified` remain consistent.
- Keep English, Japanese, and Simplified Chinese translation keys synchronized.
- Do not change Rust commands, shared Rust types, the project schema, or generated `src/binding.ts`.
- Make one final commit only after all implementation and verification steps pass.

---

## File Structure

- Create `src/components/SpeakerSelectionDialog.tsx`: controlled, store-independent speaker-grid dialog.
- Modify `src/components/Dialogs.test.tsx`: isolated accessibility and selection-contract coverage for the dialog component.
- Modify `src/layout/Sidebar.tsx`: trigger placement, dialog state, and selection integration with `setStyleId`.
- Modify `src/layout/Sidebar.test.tsx`: end-to-end preset update and dismissal behavior through the provider stack.
- Modify `src/i18n/en.json`: English dialog and trigger copy.
- Modify `src/i18n/ja.json`: Japanese dialog and trigger copy.
- Modify `src/i18n/zh-CN.json`: Simplified Chinese dialog and trigger copy.
- Keep `docs/superpowers/specs/2026-08-01-speaker-selection-dialog-design.md` and this plan for the final commit.

---

### Task 1: Build the Store-Independent Speaker Dialog

**Files:**

- Create: `src/components/SpeakerSelectionDialog.tsx`
- Modify: `src/components/Dialogs.test.tsx`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/ja.json`
- Modify: `src/i18n/zh-CN.json`

**Interfaces:**

- Consumes: generated `CharacterMeta` from `src/binding.ts`, `AppDialogContent`, and `usei18n`.
- Produces:

```ts
export interface SpeakerSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  speakers: CharacterMeta[];
  selectedSpeakerUuid: string | null;
  onSelect: (speaker: CharacterMeta) => void;
}

export function SpeakerSelectionDialog(
  props: SpeakerSelectionDialogProps,
): JSX.Element;
```

- [ ] **Step 1: Add the failing accessible-grid and dismissal test**

Add imports for `CharacterMeta`, `createSignal`, `vi`, `metas`, and `SpeakerSelectionDialog` to `src/components/Dialogs.test.tsx`. Define a second speaker with a first style whose ID is distinct:

```ts
const secondSpeaker: CharacterMeta = {
  name: "Second Speaker",
  speaker_uuid: "speaker-2",
  version: "1.0.0",
  order: 1,
  styles: [
    { id: 10, name: "Normal", order: 0, type: "talk" },
    { id: 11, name: "Happy", order: 1, type: "talk" },
  ],
};
```

Add a test that renders a controlled open dialog under `ConfigProvider` and `i18nProvider`, then checks the dialog name, both accessible speaker buttons, current selection, and cancellation:

```tsx
it("presents an accessible dismissible speaker grid", async () => {
  const onSelect = vi.fn();
  const [open, setOpen] = createSignal(true);

  render(() => (
    <MultiProvider
      values={[
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <SpeakerSelectionDialog
        open={open()}
        onOpenChange={setOpen}
        speakers={[...metas, secondSpeaker]}
        selectedSpeakerUuid="speaker-1"
        onSelect={onSelect}
      />
    </MultiProvider>
  ));

  expect(
    await screen.findByRole("dialog", { name: "Select Speaker" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Speaker" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("button", { name: "Second Speaker" }),
  ).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(
    screen.getByRole("button", { name: "Close speaker selection" }),
  );
  await waitFor(() => expect(open()).toBe(false));
  expect(onSelect).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```sh
pnpm test:run src/components/Dialogs.test.tsx
```

Expected: FAIL because `SpeakerSelectionDialog` does not exist.

- [ ] **Step 3: Add synchronized translation copy**

Add this top-level group after `preset` in each translation file:

```json
// src/i18n/en.json
"speaker_selection": {
  "title": "Select Speaker",
  "open": "Browse speakers",
  "close": "Close speaker selection"
}
```

```json
// src/i18n/ja.json
"speaker_selection": {
  "title": "話者を選択",
  "open": "話者一覧を開く",
  "close": "話者選択を閉じる"
}
```

```json
// src/i18n/zh-CN.json
"speaker_selection": {
  "title": "选择说话人",
  "open": "浏览说话人",
  "close": "关闭说话人选择"
}
```

Use ordinary JSON without the explanatory comments shown above.

- [ ] **Step 4: Implement the minimal accessible dialog grid**

Create `src/components/SpeakerSelectionDialog.tsx`:

```tsx
import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import { For, Show, type JSX } from "solid-js";
import type { CharacterMeta } from "../binding";
import { usei18n } from "../contexts/i18n";
import { AppDialogContent } from "./AppDialogContent";

export interface SpeakerSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  speakers: CharacterMeta[];
  selectedSpeakerUuid: string | null;
  onSelect: (speaker: CharacterMeta) => void;
}

export function SpeakerSelectionDialog(
  props: SpeakerSelectionDialogProps,
): JSX.Element {
  const { t1 } = usei18n()!;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("speaker_selection.title")}
        closeLabel={t1("speaker_selection.close")}
        class="w-[min(90vw,48rem)] max-h-[80vh]"
      >
        <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap3 overflow-y-auto p4">
          <For each={props.speakers}>
            {(speaker) => {
              const selected = () =>
                speaker.speaker_uuid === props.selectedSpeakerUuid;
              return (
                <Button
                  type="button"
                  aria-pressed={selected()}
                  class="relative min-h-24 flex flex-col items-center justify-center gap2 rounded-xl b b-slate-2 bg-slate-1/70 p3 text-center outline-none transition-colors hover:(b-primary-5 bg-primary-1) focus-visible:(ring-2 ring-primary-3) dark:(b-slate-6 bg-slate-7/50) dark:hover:(b-primary-5 bg-slate-7)"
                  classList={{ "!b-primary-5 bg-primary-1 dark:bg-slate-7": selected() }}
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
```

- [ ] **Step 5: Run the component test and translation synchronization test**

Run:

```sh
pnpm test:run src/components/Dialogs.test.tsx src/i18n/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add the failing selection-contract test**

Add a second focused test to `src/components/Dialogs.test.tsx`:

```tsx
it("reports the speaker selected from the grid", async () => {
  const onSelect = vi.fn();

  render(() => (
    <MultiProvider
      values={[
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <SpeakerSelectionDialog
        open
        onOpenChange={() => {}}
        speakers={[...metas, secondSpeaker]}
        selectedSpeakerUuid="speaker-1"
        onSelect={onSelect}
      />
    </MultiProvider>
  ));

  fireEvent.click(
    await screen.findByRole("button", { name: "Second Speaker" }),
  );
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith(secondSpeaker);
});
```

The Step 4 card intentionally has no click handler yet, so this test fails for the intended missing behavior.

- [ ] **Step 7: Verify the selection-contract test turns green**

Run:

```sh
pnpm test:run src/components/Dialogs.test.tsx
```

First run the command and confirm it FAILS because `onSelect` was not called. Then add the following property to the speaker `Button` and rerun the command:

```tsx
onClick={() => props.onSelect(speaker)}
```

Expected after adding the click handler: PASS.

---

### Task 2: Integrate the Dialog with Preset Editing

**Files:**

- Modify: `src/layout/Sidebar.tsx`
- Modify: `src/layout/Sidebar.test.tsx`

**Interfaces:**

- Consumes: `SpeakerSelectionDialogProps`, `metas`, `curMeta()`, and `setStyleId(styleId: StyleId): void`.
- Produces: localized `Browse speakers` trigger beside only the speaker selector and immediate first-style selection followed by dialog closure.

- [ ] **Step 1: Add the failing Sidebar integration test**

Import `CharacterMeta` in `src/layout/Sidebar.test.tsx`, define the same `secondSpeaker`, and add a test using the existing full provider stack. Initialize two blocks on preset `0` with `query_is_modified: true`. The flow must assert cancellation and selection:

```tsx
it("selects a speaker's first style from the preset dialog", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  const allSpeakers: CharacterMeta[] = [...metas, secondSpeaker];

  const Harness: Component = () => {
    text = useTextStore()!;
    const meta = useMetaStore()!;
    onMount(() => {
      batch(() => {
        meta.setMetas(allSpeakers);
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
          {
            id: "current-block",
            text: "Current block",
            query: audioQuery(),
            query_is_modified: true,
            preset_id: 0,
          },
          {
            id: "related-block",
            text: "Related block",
            query: audioQuery(),
            query_is_modified: true,
            preset_id: 0,
          },
        ]);
      });
    });
    return <Sidebar />;
  };

  render(() => (
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

  await user.click(
    await screen.findByRole("button", { name: "Browse speakers" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Select Speaker" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Speaker" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await user.click(
    screen.getByRole("button", { name: "Close speaker selection" }),
  );
  expect(text.projectPresetStore[0]).toMatchObject({
    style_id: 1,
    speaker_uuid: "speaker-1",
    style_name: "Normal",
  });

  await user.click(screen.getByRole("button", { name: "Browse speakers" }));
  await user.click(
    await screen.findByRole("button", { name: "Second Speaker" }),
  );

  expect(text.projectPresetStore[0]).toMatchObject({
    style_id: 10,
    speaker_uuid: "speaker-2",
    style_name: "Normal",
  });
  expect(text.textStore.map((block) => block.query_is_modified)).toEqual([
    false,
    false,
  ]);
  expect(
    screen.getByRole("dialog", { name: "Select Speaker" }),
  ).toHaveAttribute("data-closed");
});
```

- [ ] **Step 2: Run the integration test and verify the expected failure**

Run:

```sh
pnpm test:run src/layout/Sidebar.test.tsx
```

Expected: FAIL because the `Browse speakers` button is absent.

- [ ] **Step 3: Extend `OptionSelector` with an optional adjacent action**

Add `action?: JSX.Element` to `OptionSelector` props. Keep `Select.Label` unchanged and wrap the trigger plus optional action:

```tsx
<Select.Label class="text-sm select-none cursor-default">
  {props.name}
</Select.Label>
<div class="flex w-full items-center gap1">
  <Select.Trigger
    class="flex flex-1 min-w-0 flex-row items-center justify-between px2 bg-white dark:bg-slate-8 h-8 bg-transparent border border-slate-2 rounded-md hover:(bg-slate-1 dark:bg-slate-7) dark:border-slate-6"
  >
    <Select.Value<string>>
      {(state) => state.selectedOption()}
    </Select.Value>
    <Select.Icon>
      <div class="size-4 i-lucide:chevrons-up-down" />
    </Select.Icon>
  </Select.Trigger>
  {props.action}
</div>
```

The style `OptionSelector` passes no action and remains full width.

- [ ] **Step 4: Add the Sidebar trigger and controlled dialog**

Import `SpeakerSelectionDialog`, add `speakerSelectionOpen` beside the existing dialog signals, and pass this action only to the speaker selector:

```tsx
action={
  <Button
    type="button"
    aria-label={t1("speaker_selection.open")}
    title={t1("speaker_selection.open")}
    class="size-8 shrink-0 flex items-center justify-center rounded-md b b-slate-2 bg-transparent outline-none hover:(b-primary-5 bg-primary-1) focus-visible:(ring-2 ring-primary-3) dark:(b-slate-6 hover:bg-slate-7)"
    onClick={() => setSpeakerSelectionOpen(true)}
  >
    <div class="i-lucide:layout-grid size-4" />
  </Button>
}
```

Mount the controlled dialog near the other Sidebar dialogs:

```tsx
<SpeakerSelectionDialog
  open={speakerSelectionOpen()}
  onOpenChange={setSpeakerSelectionOpen}
  speakers={metas}
  selectedSpeakerUuid={curMeta()?.speaker_uuid ?? null}
  onSelect={(speaker) => {
    setStyleId(speaker.styles[0].id);
    setSpeakerSelectionOpen(false);
  }}
/>
```

- [ ] **Step 5: Run the focused tests and verify green**

Run:

```sh
pnpm test:run src/layout/Sidebar.test.tsx src/components/Dialogs.test.tsx src/i18n/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Refactor while keeping behavior green**

Remove duplicated second-speaker fixture data by exporting a `speaker(overrides)` factory from `src/test/fixtures.ts` only if both test files need more than the single shared constant. Do not refactor unrelated Sidebar code.

Run the focused tests again after any refactor:

```sh
pnpm test:run src/layout/Sidebar.test.tsx src/components/Dialogs.test.tsx src/i18n/index.test.ts
```

Expected: PASS.

---

### Task 3: Verify and Create the Single Final Commit

**Files:**

- Verify all changed frontend and documentation files.
- Do not modify `src/binding.ts` or Rust sources.

**Interfaces:**

- Consumes: completed Tasks 1 and 2.
- Produces: one formatted, tested, buildable frontend change and one final commit.

- [ ] **Step 1: Run formatting and lint checks**

Run:

```sh
pnpm check
```

Expected: PASS with no Biome diagnostics. If Biome reports formatting-only issues, run `pnpm exec biome check --write ./src/`, inspect the diff, and rerun `pnpm check`.

- [ ] **Step 2: Run the frontend build**

Run:

```sh
pnpm build
```

Expected: PASS with a successful Vite production bundle.

- [ ] **Step 3: Run the complete deterministic frontend suite**

Run:

```sh
pnpm test:run
```

Expected: all Vitest files and tests PASS with no unhandled errors.

- [ ] **Step 4: Inspect the final diff and generated-file boundary**

Run:

```sh
git status --short
git diff --check
git diff --stat
git diff -- src/binding.ts src-tauri
```

Expected: no whitespace errors and no changes to `src/binding.ts` or `src-tauri/`.

- [ ] **Step 5: Create the only commit for this feature**

Following the repository staging preference, stage the complete reviewed change and commit once:

```sh
git add .
git commit -m "feat: add speaker selection dialog"
```

- [ ] **Step 6: Confirm the final repository state**

Run:

```sh
git status --short
git log -1 --oneline
```

Expected: the worktree is clean and the latest commit is `feat: add speaker selection dialog`.

---

### Task 4: Normalize Global Speaker Order by Minimum Style ID

**Files:**

- Modify: `src/contexts/providers.test.tsx`
- Modify: `src/contexts/meta.ts`
- Modify: `docs/superpowers/specs/2026-08-01-speaker-selection-dialog-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-speaker-selection-dialog.md`

**Interfaces:**

- Consumes: `CharacterMeta.styles`, where every speaker is guaranteed to have at least one globally unique numeric style ID.
- Produces: `MetaProvider.metas` with duplicate UUIDs combined, each speaker's styles sorted by ascending ID, and speakers sorted by their minimum style ID.

- [ ] **Step 1: Strengthen the provider normalization test**

Replace the current `MetaProvider` test fixture with two speakers supplied in reverse minimum-style-ID order. Keep the second speaker's styles unsorted and include a duplicate entry for the first speaker:

```tsx
it("combines duplicate speakers and sorts speakers and styles by ID", () => {
  let store!: MetaStore;
  const Probe: Component = () => {
    store = useMetaStore()!;
    return null;
  };
  render(() => (
    <MultiProvider values={[[MetaProvider, []]]}>
      <Probe />
    </MultiProvider>
  ));

  const largerMinimum = {
    ...metas[0],
    name: "Larger minimum",
    speaker_uuid: "speaker-larger",
    styles: [
      { id: 6, name: "Six", order: 2, type: "talk" as const },
      { id: 4, name: "Four", order: 0, type: "talk" as const },
    ],
  };
  const smallerMinimum = {
    ...metas[0],
    name: "Smaller minimum",
    speaker_uuid: "speaker-smaller",
    styles: [
      { id: 10, name: "Ten", order: 1, type: "talk" as const },
      { id: 2, name: "Two", order: 0, type: "talk" as const },
    ],
  };
  const largerMinimumDuplicate = {
    ...largerMinimum,
    styles: [{ id: 5, name: "Five", order: 1, type: "talk" as const }],
  };

  expect(
    store.setMetas([
      largerMinimum,
      smallerMinimum,
      largerMinimumDuplicate,
    ]),
  ).toBeUndefined();
  expect(store.metas.map((speaker) => speaker.name)).toEqual([
    "Smaller minimum",
    "Larger minimum",
  ]);
  expect(store.availableStyleIds()).toEqual([2, 10, 4, 5, 6]);
  expect(store.setMetas(metas)).toEqual(
    new Error("Metas are read-only and we already have some"),
  );
});
```

This test catches insertion-order rendering, sorting speakers before their styles, failure to combine duplicate UUIDs, and loss of the provider's read-only contract.

- [ ] **Step 2: Run the provider test and verify RED**

Run:

```sh
pnpm exec vitest run ./src/contexts/providers.test.tsx --exclude '.worktrees/**'
```

Expected: FAIL because the current provider leaves `Larger minimum` before `Smaller minimum`.

- [ ] **Step 3: Sort combined speakers after sorting their styles**

In `src/contexts/meta.ts`, retain the existing per-speaker style normalization, then sort the cloned combined collection:

```ts
combinedMetas.forEach((meta) => {
  meta.styles.sort((a, b) => (a.id < b.id ? -1 : 1));
});
combinedMetas.sort((a, b) => a.styles[0].id - b.styles[0].id);
_setMetas(combinedMetas);
```

Do not sort `newMetas` directly and do not add a second dialog-local sort.

- [ ] **Step 4: Verify GREEN and related speaker behavior**

Run:

```sh
pnpm exec vitest run ./src/contexts/providers.test.tsx ./src/layout/Sidebar.test.tsx --exclude '.worktrees/**'
```

Expected: both provider normalization and dialog behavior PASS.

- [ ] **Step 5: Run fresh complete frontend verification**

Run:

```sh
pnpm check
pnpm build
pnpm exec vitest run --exclude '.worktrees/**'
```

Expected: Biome, the Vite production build, and every test in the current checkout PASS.

- [ ] **Step 6: Review and create one follow-up commit**

Run:

```sh
git status --short
git diff --check
git diff -- src/binding.ts src-tauri
git add .
git commit -m "fix: sort speakers by minimum style id"
```

Expected: only provider normalization, its test, and the approved design/plan update are included; no Rust or generated-binding changes exist.
