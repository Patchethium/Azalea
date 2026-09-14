# Tuning demo provenance

These are copies of the desktop components at commit
`c87964a710ccb103e8b58130b91f856b5ba878b4`, adapted for a browser-only example.

| Demo file                                       | Original                                                |
| ----------------------------------------------- | ------------------------------------------------------- |
| `tuning/Panel.tsx`                              | `src/layout/bottomPanel/tuning/Panel.tsx`               |
| `tuning/Timeline.tsx` (`TuningItem`)            | `src/layout/bottomPanel/tuning/Timeline.tsx`            |
| `tuning/usePanel.ts`                            | `src/layout/bottomPanel/tuning/usePanel.ts`             |
| `IconButton.tsx`                                | `src/components/iconButton/index.tsx`                   |
| `Tooltip.tsx`                                   | `src/components/tooltip/index.tsx`                      |
| `../TuningPreview.tsx` (panel shell/tab/header) | `src/layout/bottomPanel/index.tsx` and `ControlBar.tsx` |

The copied timeline keeps the application's Kobalte pitch sliders, virtualized
duration layout, phoneme cells, zoom slider, and UnoCSS classes. The landing
UnoCSS config enables the same variant-group transformer and Kobalte preset.
Container sizing is adapted to the full-width landing section.

`usePanel.ts` replaces project/configuration stores with a local Solid store
and preserves pitch, duration-drag, and Ctrl-wheel zoom behavior. Reset restores
the sample, zoom, and scroll position. The phoneme cells additionally expose
keyboard duration adjustments and labels for assistive technology.

Native playback, file operations, synthesis jobs, spectrogram computation,
caches, and event subscriptions are pruned. The spectrogram canvas is omitted
because this demo has no synthesized waveform. `sample.ts` contains editable
demonstration values, not a recording. Type-only imports reuse the application's
query schema without bundling Tauri bindings.

When updating the app's tuning UI, compare the source files above with these
copies. Preserve their visual structure; keep desktop side effects outside the
landing bundle. Run `pnpm test:landing`, `pnpm check:landing`, and
`pnpm build:landing` from the repository root.
