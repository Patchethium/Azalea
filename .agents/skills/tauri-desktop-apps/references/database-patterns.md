# Database Patterns in Tauri 2 (SQLite)

## Using rusqlite (Direct SQLite)

### Cargo.toml

```toml
[dependencies]
rusqlite = { version = "0.32", features = ["bundled"] }
```

### Rust: Database Layer

```rust
// src-tauri/src/db.rs
use rusqlite::{Connection, params, Result as SqlResult};
use std::sync::Mutex;
use tauri::Manager;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app: &tauri::AppHandle) -> SqlResult<Self> {
        let db_path = app.path().app_data_dir()
            .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?
            .join("app.db");

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(&db_path)?;

        // Enable WAL mode for better concurrent performance
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

        // Create tables
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );
        ")?;

        Ok(Database { conn: Mutex::new(conn) })
    }

    pub fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get(0))?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)",
            params![key, value],
        )?;
        Ok(())
    }
}
```

### Register Database in Tauri

```rust
// src-tauri/src/lib.rs
mod db;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database = db::Database::new(app.handle())
                .expect("Failed to initialize database");
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_setting,
            set_setting,
            save_chat_message,
            get_chat_history,
        ])
        .run(tauri::generate_context!())
        .expect("error");
}
```

### Tauri Commands

```rust
#[tauri::command]
fn get_setting(
    database: tauri::State<'_, db::Database>,
    key: String,
) -> Result<Option<String>, String> {
    database.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(
    database: tauri::State<'_, db::Database>,
    key: String,
    value: String,
) -> Result<(), String> {
    database.set_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_chat_message(
    database: tauri::State<'_, db::Database>,
    project_id: Option<i64>,
    role: String,
    content: String,
) -> Result<i64, String> {
    let conn = database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chat_history (project_id, role, content) VALUES (?1, ?2, ?3)",
        params![project_id, role, content],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_chat_history(
    database: tauri::State<'_, db::Database>,
    project_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, String> {
    let conn = database.conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(100);
    let mut stmt = conn.prepare(
        "SELECT role, content, created_at FROM chat_history \
         WHERE project_id IS ?1 ORDER BY id DESC LIMIT ?2"
    ).map_err(|e| e.to_string())?;

    let messages = stmt.query_map(params![project_id, limit], |row| {
        Ok(ChatMessage {
            role: row.get(0)?,
            content: row.get(1)?,
            created_at: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    Ok(messages)
}
```

## Using Tauri Plugin SQLite

### Cargo.toml + npm

```toml
[dependencies]
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

```bash
npm install @tauri-apps/plugin-sql
```

### Register Plugin

```rust
mod db;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default()
            .add_migrations("sqlite:app.db", vec![
                tauri_plugin_sql::Migration {
                    version: 1,
                    description: "create tables",
                    sql: "CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    );",
                    kind: tauri_plugin_sql::MigrationKind::Up,
                },
            ])
            .build())
        .run(tauri::generate_context!())
        .expect("error");
}
```

### Frontend: SQL Queries

```typescript
import Database from '@tauri-apps/plugin-sql';

const db = await Database.load('sqlite:app.db');

// Insert
await db.execute(
  'INSERT INTO settings (key, value) VALUES ($1, $2)',
  ['theme', 'dark']
);

// Select
const rows = await db.select<{ key: string; value: string }[]>(
  'SELECT * FROM settings WHERE key = $1',
  ['theme']
);

// Update
await db.execute(
  'UPDATE settings SET value = $1 WHERE key = $2',
  ['light', 'theme']
);

// Close when done
await db.close();
```

## When to Use Which

| Approach | When |
|----------|------|
| `rusqlite` (direct) | Full control, complex queries, migrations |
| `tauri-plugin-sql` | Simple apps, want JS-side queries |
| `tauri-plugin-store` | Simple key-value, no relational data |
| SQLite WAL mode | Concurrent reads from UI + background |

## Migration Pattern

```rust
pub fn run_migrations(conn: &Connection) -> SqlResult<()> {
    // Check current version
    let version: i32 = conn.query_row(
        "PRAGMA user_version", [], |row| row.get(0)
    )?;

    if version < 1 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            PRAGMA user_version = 1;
        ")?;
    }

    if version < 2 {
        conn.execute_batch("
            ALTER TABLE settings ADD COLUMN category TEXT DEFAULT 'general';
            PRAGMA user_version = 2;
        ")?;
    }

    Ok(())
}
```

## Pitfalls

| Problem | Fix |
|---------|-----|
| Database locked error | Use WAL mode: `PRAGMA journal_mode=WAL` |
| Concurrent access panics | Use `Mutex<Connection>` |
| DB file not found on packaged app | Use `app.path().app_data_dir()` for path |
| Migrations run out of order | Use `PRAGMA user_version` for versioning |
| Plugin SQL not connecting | Ensure plugin registered before commands |
| Large result sets slow | Add LIMIT, use pagination |
