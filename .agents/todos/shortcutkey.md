# Keyboard shortcuts

This is the implementation plan for keyboard shortcuts in Azalea. The goal is
to make the editor fast to operate while preserving normal text editing and
browser/OS conventions.

## Implementation plan

### Step 1: essential application shortcuts (complete)

Keep the first step deliberately small and limited to modifier-based workflow
shortcuts. Do not introduce unmodified single-letter shortcuts.

| Shortcut             | Action                                      |
| -------------------- | ------------------------------------------- |
| `Ctrl/Cmd + S`       | Save the current project                    |
| `Ctrl/Cmd + Enter`   | Generate/play the selected cell and stay    |
| `Shift + Enter`      | Generate/play the selected cell, then advance |
| `Ctrl/Cmd + Space`   | Stop playback                               |

Implementation rules:

* Use `Cmd` on macOS and `Ctrl` on Windows/Linux.
* Ignore auto-repeat so holding a key cannot queue duplicate work.
* Preserve ordinary text input for all other keys.
* Do not run playback shortcuts while a dialog or non-editor form control has
  focus; saving remains available throughout the application.
* Reuse the same actions as the visible controls rather than duplicating their
  behavior.

Acceptance criteria:

* The shortcuts work while the selected text cell is being edited.
* Play shortcuts do nothing when the selected cell has no usable query/preset.
* `Shift + Enter` advances only after playback starts successfully and remains
  on the final cell when there is no next cell.
* Stop is harmless when nothing is playing.
* Frontend checks and Rust tests pass.

### Step 2: focus-safe cell operations

Add explicit, modifier-based cell creation, deletion, movement, and navigation.
Extract shared cell actions from `TextBlock` before wiring shortcuts so toolbar
buttons and keys use one implementation. Include accessible shortcut labels in
tooltips. Do not add multi-cell selection yet.

### Step 3: notebook command/edit interaction

Evaluate and implement the notebook-style command/edit model as a separate UX
change. Add visible state, `Enter`/`Esc` transitions, arrow navigation,
single-letter structural commands (`A`, `B`, `D D`, `C`, `X`, `V`), and
structural undo/redo. Preserve native editing shortcuts while text has focus.

### Step 4: multi-cell and advanced TTS workflows

Add range/toggle selection, batch generation/export, joining/splitting, playback
from the selection, parameter adjustment shortcuts, a command palette, and a
localized shortcut reference. Resolve clipboard and voice-selector conflicts as
part of this step.

## Shortcut backlog

The tables below are the candidate backlog for steps 2-4. Exact bindings should
be reviewed for platform and accessibility conflicts before implementation.

## Core shortcuts

| Shortcut                  | Action                                                 | Mode    |
| ------------------------- | ------------------------------------------------------ | ------- |
| `Enter`                   | Edit selected cell                                     | Command |
| `Esc`                     | Exit text editing / enter command mode                 | Edit    |
| `Shift + Enter`           | Generate/play current cell, then select next cell      | Both    |
| `Ctrl/Cmd + Enter`        | Generate/play current cell and stay on it              | Both    |
| `Alt/Option + Enter`      | Generate/play current cell and insert a new cell below | Both    |
| `A`                       | Insert cell above                                      | Command |
| `B`                       | Insert cell below                                      | Command |
| `D`, `D`                  | Delete selected cell                                   | Command |
| `Z`                       | Undo cell deletion or structural change                | Command |
| `Shift + Z`               | Redo structural change                                 | Command |
| `C`                       | Copy cell                                              | Command |
| `X`                       | Cut cell                                               | Command |
| `V`                       | Paste cell below                                       | Command |
| `Shift + V`               | Paste cell above                                       | Command |
| `↑` / `↓`                 | Select previous or next cell                           | Command |
| `Shift + ↑` / `Shift + ↓` | Extend multi-cell selection                            | Command |
| `Ctrl/Cmd + ↑`            | Move selected cell up                                  | Command |
| `Ctrl/Cmd + ↓`            | Move selected cell down                                | Command |
| `M`                       | Merge selected cells                                   | Command |
| `S` or `Ctrl/Cmd + S`     | Save project                                           | Both    |

## Text-editing shortcuts

| Shortcut                   | Action                        |
| -------------------------- | ----------------------------- |
| `Ctrl/Cmd + Z`             | Undo text edit                |
| `Ctrl/Cmd + Shift + Z`     | Redo text edit                |
| `Ctrl/Cmd + A`             | Select all text in cell       |
| `Ctrl/Cmd + C/X/V`         | Copy, cut, paste text         |
| `Ctrl/Cmd + F`             | Find text                     |
| `Ctrl/Cmd + H`             | Find and replace              |
| `Ctrl/Cmd + D`             | Select next occurrence        |
| `Alt/Option + ↑/↓`         | Move current line             |
| `Alt/Option + Shift + ↑/↓` | Duplicate current line        |
| `Ctrl/Cmd + /`             | Toggle comment or annotation  |
| `Tab`                      | Indent or accept autocomplete |
| `Shift + Tab`              | Outdent                       |
| `Ctrl/Cmd + Backspace`     | Delete previous word          |
| `Ctrl/Cmd + →/←`           | Move by word                  |
| `Home` / `End`             | Move to line start or end     |

## TTS-specific shortcuts

These can make the editor feel purpose-built rather than merely notebook-like.

| Shortcut                  | Suggested action                               |
| ------------------------- | ---------------------------------------------- |
| `Space`                   | Play or pause selected cell in command mode    |
| `Shift + Space`           | Play from selected cell onward                 |
| `Ctrl/Cmd + Space`        | Stop playback                                  |
| `R`                       | Regenerate audio for selected cell             |
| `Shift + R`               | Regenerate all selected cells                  |
| `P`                       | Preview selected cell without saving output    |
| `[` / `]`                 | Decrease or increase speaking rate             |
| `Shift + [` / `Shift + ]` | Decrease or increase pitch                     |
| `-` / `=`                 | Decrease or increase volume                    |
| `L`                       | Loop selected cell                             |
| `G`                       | Generate audio for selected cells              |
| `E`                       | Export selected cell audio                     |
| `Shift + E`               | Export all generated audio                     |
| `V`                       | Open voice selector, unless reserved for paste |
| `Ctrl/Cmd + Shift + V`    | Open voice selector                            |
| `T`                       | Insert pause or timing marker                  |
| `Ctrl/Cmd + K`            | Open command palette                           |
| `Ctrl/Cmd + Shift + P`    | Open command palette, VS Code style            |
| `?`                       | Show keyboard shortcut reference               |

## Multi-cell actions

For a notebook-style TTS workflow, cell selection is especially useful:

| Shortcut                | Action                                   |
| ----------------------- | ---------------------------------------- |
| `Shift + Click`         | Select a range of cells                  |
| `Ctrl/Cmd + Click`      | Add or remove a cell from selection      |
| `Ctrl/Cmd + A`          | Select all cells when in command mode    |
| `Shift + Enter`         | Generate selected cells sequentially     |
| `Backspace` or `Delete` | Delete selected cells after confirmation |
| `Ctrl/Cmd + G`          | Generate all selected cells              |
| `Ctrl/Cmd + E`          | Export selected cells                    |
| `Ctrl/Cmd + J`          | Join selected text cells                 |
| `Ctrl/Cmd + Shift + S`  | Split cell at cursor                     |

## Recommended conflict rules

Because the same key can mean different things, make the current mode visually obvious.

* In **edit mode**, preserve standard browser and OS text shortcuts.
* In **command mode**, single-letter shortcuts such as `A`, `B`, `D`, and `R` are safe.
* Avoid overriding `Ctrl/Cmd + R`, because browsers use it for reload.
* Avoid overriding `Ctrl/Cmd + W`, `Ctrl/Cmd + T`, and `Ctrl/Cmd + N`.
* Use `Cmd` on macOS and `Ctrl` on Windows/Linux.
* Ignore single-letter command shortcuts while focus is inside text fields, dropdowns, or dialogs.
* Consider requiring `D`, `D` or a confirmation for destructive actions.

A strong minimal first release would include: `Enter`, `Esc`, `Shift + Enter`, `Ctrl/Cmd + Enter`, `A`, `B`, `D D`, `C`, `X`, `V`, arrow-key navigation, save, play/pause, regenerate, stop, and a command palette.
