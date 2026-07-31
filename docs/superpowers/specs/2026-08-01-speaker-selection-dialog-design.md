# Speaker Selection Dialog Design

## Goal

Add a fast, visual way to choose a VOICEVOX speaker while editing a preset. The existing speaker and style dropdowns remain available in the preset Accordion; the new dialog supplements the speaker dropdown without changing how styles are edited.

## User Experience

The speaker row in the preset editing Accordion gains an icon-only button immediately to the right of the existing speaker selector. Its localized accessible label describes opening the speaker browser.

Activating the button opens a modal titled “Select Speaker.” The dialog displays every speaker from the current VOICEVOX metadata in a responsive grid. Each grid card is a real button showing a generic speaker icon and the speaker name. The current preset speaker is visibly selected. The metadata does not expose portraits, so this feature does not add an image or backend asset pipeline.

Selecting a card immediately selects that speaker's first style and closes the dialog. The user can then choose another style from the existing style selector in the Accordion. Every VOICEVOX speaker is guaranteed to have at least one style, so the dialog does not add disabled or empty-style speaker states.

The dialog can also be dismissed without changing the preset using the close button, Escape, or the standard Kobalte dialog dismissal behavior.

## Component Design

Create `src/components/SpeakerSelectionDialog.tsx` as a focused controlled component. It receives:

- `open: boolean`
- `onOpenChange: (open: boolean) => void`
- `speakers: CharacterMeta[]`
- `selectedSpeakerUuid: string | null`
- `onSelect: (speaker: CharacterMeta) => void`

The component uses Kobalte `Dialog` and the existing `AppDialogContent` shell. It owns only presentation and selection notification; it does not access preset state directly. Speaker cards use `speaker_uuid` as their stable identity rather than the potentially non-unique display name.

`Sidebar` owns the dialog's open signal, passes the metadata and current speaker UUID, and handles a selected speaker. The speaker selector and its new button are arranged in one row, while the selector's existing label remains above that row. The generic `OptionSelector` may gain an optional adjacent-action slot or a small speaker-specific wrapper, whichever preserves the style selector without duplicated select markup.

## Metadata Ordering

`MetaProvider` normalizes ordering globally after it combines metadata entries with the same `speaker_uuid`. It first sorts each speaker's styles by ascending numeric style ID, then sorts the combined speaker list by each speaker's first style ID. Because every speaker has at least one style, the first style ID is also that speaker's minimum style ID.

The provider continues cloning incoming metadata before normalization, so it does not mutate the caller's collection. All consumers, including the existing speaker dropdown and the new dialog grid, receive the same deterministic speaker order. The dialog does not perform its own additional sorting.

## Data Flow

1. The user opens the dialog from the button beside the speaker selector.
2. `SpeakerSelectionDialog` renders the `metas` collection from `MetaProvider`.
3. Clicking a speaker card calls `onSelect` with that `CharacterMeta`.
4. `Sidebar` passes `speaker.styles[0].id` to its existing `setStyleId` function.
5. `setStyleId` updates `style_id`, `speaker_uuid`, and `style_name` together and clears `query_is_modified` on text blocks using the preset when the style changes.
6. `Sidebar` closes the dialog after the selection succeeds.

This preserves schema-version-1 preset identity behavior and keeps dropdown and dialog selection semantics identical.

## Accessibility and Localization

The trigger is a keyboard-focusable button with a localized `aria-label` and title. Each speaker card is a native or Kobalte button whose accessible name contains the speaker name and whose focus state is visible. The current speaker is conveyed both visually and with an accessible selected state such as `aria-pressed`.

Kobalte provides dialog naming, focus containment, Escape dismissal, and focus return through `AppDialogContent`. New dialog title, close label, and trigger label keys are added with synchronized English, Japanese, and Simplified Chinese translations.

## Testing

Add behavior-focused coverage to `src/layout/Sidebar.test.tsx` using the existing full provider harness and at least two speakers:

- The localized trigger opens a named dialog containing all speakers as simultaneously available buttons.
- The current speaker card exposes its selected state.
- Choosing another speaker selects that speaker's first style and updates `style_id`, `speaker_uuid`, and `style_name`.
- A speaker change clears `query_is_modified` for affected text blocks through the existing update path.
- The dialog closes after selection and the Accordion controls display the new speaker and style.
- Dismissing the dialog without selecting leaves the preset unchanged.

Extend the `MetaProvider` test in `src/contexts/providers.test.tsx` with speakers supplied in reverse minimum-style-ID order. Assert that duplicate speakers are still combined, each speaker's styles remain sorted, and the final speakers are ordered by their minimum style IDs. This regression test must fail against insertion-order behavior before the provider implementation changes.

The translation synchronization test must continue to pass. This is frontend-only work: it does not change Tauri commands or shared Rust types, so Rust tests and TypeScript binding regeneration are not required.

## Scope

This feature does not add speaker search, filtering, portraits, style selection inside the dialog, backend metadata changes, backend commands, or project schema changes.
