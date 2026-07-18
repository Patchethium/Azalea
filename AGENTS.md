# Repository Guidelines

## Project Structure & Module Organization

Azalea is a Tauri 2 desktop application. The SolidJS/TypeScript frontend lives in `src/`: reusable UI belongs in `components/`, pages in `layout/`, shared state in `contexts/`, and translations in `i18n/`. Styles use colocated CSS modules; UnoCSS is configured in `uno.config.ts`.

The Rust backend is under `src-tauri/`. Tauri commands are grouped in `src-tauri/src/commands/`, configuration handling in `config/`, and audio code in `audio/`. Rust integration tests and fixtures live in `src-tauri/tests/`. Application icons are in `src-tauri/icons/`; project artwork is in `icon/`. Treat `src/binding.ts` as generated bindings and avoid hand-editing it.

## Build, Test, and Development Commands

- `pnpm install` installs frontend and Tauri CLI dependencies.
- `pnpm tauri dev` runs the complete desktop app with hot reload.
- `pnpm dev` starts only the Vite frontend server.
- `pnpm build` creates the frontend bundle with Vite.
- `pnpm tauri build` creates a production desktop package.
- `pnpm check` runs Biome linting and formatting checks on `src/`.
- `cd src-tauri && cargo test` runs all Rust unit and integration tests.
- `cd src-tauri && cargo fmt --check` verifies Rust formatting.

Linux development also requires the Tauri prerequisites, `clang`, and `mold`. The development core path is stored in `config_dev/config.toml`.

## Coding Style & Naming Conventions

Use two-space indentation in both TypeScript and Rust, as configured by Biome and `rustfmt.toml`. Keep TypeScript strict and prefer focused Solid components. Name components and pages in `PascalCase.tsx`, context and utility modules in `camelCase.ts`, and CSS modules `*.module.css`. Rust modules, functions, and test files use `snake_case`; types use `PascalCase`. Run `pnpm check` and `cargo fmt` before submitting changes. Keep English and Japanese translation keys synchronized.

## Testing Guidelines

Add Rust integration coverage in `src-tauri/tests/`, using descriptive `snake_case` test names. Place small fixtures beside those tests. There is currently no frontend test framework or stated coverage threshold; for UI changes, manually verify the affected flow with `pnpm tauri dev` and describe that verification in the pull request.

## Commit & Pull Request Guidelines

Recent commits use short imperative, Conventional Commit-style prefixes such as `feat:`, `fix:`, and `chores:`. Keep each commit scoped to one concern. Open an issue before substantial work, as requested in the README. Pull requests should explain the problem and solution, link the issue, list validation commands, and include screenshots or recordings for visible UI changes. Avoid committing local core assets, generated build output, or machine-specific configuration.
