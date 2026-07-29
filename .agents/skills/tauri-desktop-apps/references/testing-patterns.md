# Testing Patterns in Tauri 2

## Rust Unit Tests

### In-File Tests

```rust
// src-tauri/src/db.rs
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_db() -> Database {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT NOT NULL
        );").unwrap();
        Database { conn: Mutex::new(conn) }
    }

    #[test]
    fn test_get_setting_empty() {
        let db = test_db();
        let result = db.get_setting("nonexistent").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_set_get_roundtrip() {
        let db = test_db();
        db.set_setting("theme", "dark").unwrap();
        let value = db.get_setting("theme").unwrap();
        assert_eq!(value, Some("dark".to_string()));
    }

    #[test]
    fn test_overwrite_setting() {
        let db = test_db();
        db.set_setting("key", "value1").unwrap();
        db.set_setting("key", "value2").unwrap();
        assert_eq!(db.get_setting("key").unwrap(), Some("value2".to_string()));
    }
}
```

### Run Rust Tests

```bash
# Run all tests
cargo test

# Run specific test module
cargo test db::tests

# Run single test
cargo test test_set_get_roundtrip

# With output
cargo test -- --nocapture

# Run in specific package
cargo test -p my-package
```

## Tauri Command Tests

```rust
// src-tauri/src/lib.rs
#[cfg(test)]
mod command_tests {
    use super::*;

    #[test]
    fn test_validate_config() {
        // Test pure functions without Tauri state
        assert!(validate_url("http://localhost:8080").is_ok());
        assert!(validate_url("not-a-url").is_err());
    }

    #[test]
    fn test_input_validation() {
        assert!(validate_key("valid_key_123").is_ok());
        assert!(validate_key "").is_err()); // empty
        assert!(validate_key(&"x".repeat(256)).is_err()); // too long
    }
}
```

## TypeScript/Vitest Frontend Tests

### Setup

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

### Setup File

```typescript
// src/test/setup.ts
import '@testing-library/jest-dom';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));
```

### Component Tests

```typescript
// src/components/__tests__/ConnectionScreen.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ConnectionScreen } from '../ConnectionScreen';
import { invoke } from '@tauri-apps/api/core';

describe('ConnectionScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input fields', () => {
    render(<ConnectionScreen />);
    expect(screen.getByPlaceholderText('http://10.1.1.20:9119')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('API Key')).toBeInTheDocument();
  });

  it('disables button when fields empty', () => {
    render(<ConnectionScreen />);
    const btn = screen.getByRole('button', { name: /connect/i });
    expect(btn).toBeDisabled();
  });

  it('calls invoke on connect', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    render(<ConnectionScreen />);

    fireEvent.change(screen.getByPlaceholderText('http://10.1.1.20:9119'), {
      target: { value: 'http://localhost:8080' },
    });
    fireEvent.change(screen.getByPlaceholderText('API Key'), {
      target: { value: 'test-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('connect_gateway', {
        gatewayUrl: 'http://localhost:8080',
        apiKey: 'test-key',
      });
    });
  });
});
```

### Store Tests

```typescript
// src/store/__tests__/appStore.test.ts
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '../appStore';
import { invoke } from '@tauri-apps/api/core';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({ connected: false, messages: [] });
    vi.clearAllMocks();
  });

  it('connects successfully', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAppStore());

    await act(async () => {
      await result.current.connect('http://localhost:8080', 'key');
    });

    expect(result.current.connected).toBe(true);
  });

  it('handles connect failure', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce('Connection refused');
    const { result } = renderHook(() => useAppStore());

    await act(async () => {
      try {
        await result.current.connect('http://bad:8080', 'key');
      } catch {}
    });

    expect(result.current.connected).toBe(false);
  });
});
```

## E2E Testing with WebDriver

### Tauri WebDriver Setup

```toml
# Cargo.toml
[dev-dependencies]
tauri-driver = "0.1"  # For E2E tests
```

### E2E Test Script

```typescript
// e2e/connection.test.ts
// Uses WebDriver protocol to control the Tauri app

import { until, WebDriver } from 'selenium-webdriver';

async function runE2E() {
  const driver = new WebDriver('http://127.0.0.1:4444');

  // Wait for connection screen
  const urlInput = await driver.wait(
    until.elementLocated({ css: 'input[placeholder*="localhost"]' }),
    10000
  );
  await urlInput.sendKeys('http://localhost:8080');

  const keyInput = await driver.findElement({ css: 'input[type="password"]' });
  await keyInput.sendKeys('test-key');

  const connectBtn = await driver.findElement({ css: 'button' });
  await connectBtn.click();

  // Wait for navigation
  await driver.wait(until.titleContains('My App'), 10000);
}

runE2E().catch(console.error);
```

### GitHub Actions E2E

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: push
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/setup-node@v4
        with: { node-version: 20 }

      - run: npm ci
      - run: npm run build

      - name: Build Tauri app
        run: npx tauri build

      - name: Start WebDriver
        run: |
          npx tauri-driver &

      - name: Run E2E tests
        run: npm run test:e2e
```

## Test Patterns by Concern

| What to Test | How | Where |
|--------------|-----|-------|
| Pure Rust functions | `cargo test` | `#[cfg(test)]` in .rs files |
| Tauri commands (logic) | Mock state, test command fn | Rust unit tests |
| React components | Render + fireEvent | Vitest + Testing Library |
| Zustand stores | renderHook + act | Vitest |
| SSE streaming | Mock fetch, test parser | Vitest |
| Database queries | In-memory SQLite | Rust unit tests |
| Full user flow | WebDriver | E2E tests |
| CI/CD builds | GitHub Actions | Workflow files |

## Pitfalls

| Problem | Fix |
|---------|-----|
| `cargo test` fails with Tauri deps | Use `#[cfg(test)]` mock for Tauri types |
| Vitest can't find `@tauri-apps/api` | Mock it in setup file |
| E2E WebDriver won't connect | Ensure `tauri-driver` running on correct port |
| Tests are slow | Use `cargo test --release` for Rust, parallel Vitest |
| Mock doesn't match real behavior | Keep mocks simple, test real integration separately |
