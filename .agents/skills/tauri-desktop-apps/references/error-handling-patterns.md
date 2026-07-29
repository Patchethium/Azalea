# Error Handling Patterns in Tauri 2 (Rust)

## Core Principle

Rust `Result<T, E>` propagated via `?` operator. Tauri commands return `Result<T, String>`.

## Pattern 1: Simple String Errors (Most Common)

```rust
#[tauri::command]
fn simple_command() -> Result<String, String> {
    let value = some_operation()
        .map_err(|e| format!("operation failed: {e}"))?;
    Ok(value)
}
```

## Pattern 2: Custom Error Type

```rust
// src-tauri/src/error.rs
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Database(rusqlite::Error),
    Network(String),
    NotFound(String),
    PermissionDenied(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "IO error: {e}"),
            Self::Json(e) => write!(f, "JSON error: {e}"),
            Self::Database(e) => write!(f, "Database error: {e}"),
            Self::Network(msg) => write!(f, "Network error: {msg}"),
            Self::NotFound(msg) => write!(f, "Not found: {msg}"),
            Self::PermissionDenied(msg) => write!(f, "Permission denied: {msg}"),
        }
    }
}

impl std::error::Error for AppError {}

// Auto-convert from source errors
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self { Self::Io(e) }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self { Self::Json(e) }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self { Self::Database(e) }
}

// Tauri commands need String errors
impl From<AppError> for String {
    fn from(e: AppError) -> String { e.to_string() }
}
```

### Use Custom Error in Commands

```rust
#[tauri::command]
fn complex_operation(id: i64) -> Result<Data, String> {
    let data = load_data(id)?;     // AppError → String automatically
    let processed = process(data)?; // AppError → String automatically
    Ok(processed)
}
```

## Pattern 3: finish() Pattern (MCP Tools)

```rust
// MCP tool dispatch returns Value, not Result
// Use finish() wrapper to use ? inside closures

fn call_tool(tool_name: &str, args: &Args, state: &State) -> Value {
    match tool_name {
        "my_tool" => finish((|| {
            let id = args.id("asset_id")?;              // Result → ?
            let asset = store.asset(id)
                .ok_or("asset not found")?;              // Option → ?
            let data = std::fs::read(&asset.path)
                .map_err(|e| format!("read failed: {e}"))?; // io::Error → ?
            Ok(json!({ "data": data }))
        })()),
        _ => tool_error("unknown tool"),
    }
}

// finish() converts Result<Value, String> to Value
fn finish(result: Result<Value, String>) -> Value {
    match result {
        Ok(v) => v,
        Err(e) => tool_error(&e),
    }
}
```

## Pattern 4: Option Handling

```rust
// Use .ok_or() to convert Option to Result
let asset = store.project.asset(id)
    .ok_or("asset not found")?;          // Option → Result

// Use .ok_or_else() for lazy error message
let config = load_config()
    .ok_or_else(|| format!("config not found at {}", path.display()))?;

// Pattern matching
match store.project.asset(id) {
    Some(asset) => { /* use asset */ }
    None => return Err("asset not found".into()),
}
```

## Pattern 5: Mutex Poison Recovery

```rust
#[tauri::command]
fn access_state(state: tauri::State<'_, AppState>) -> Result<String, String> {
    // Mutex::lock() returns Result (Err = poisoned)
    let data = state.data.lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;

    Ok(data.clone())
}
```

## Pattern 6: Async Error Handling

```rust
#[tauri::command]
pub async fn async_operation(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();

    let resp = client.get(&url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }

    let body = resp.text().await
        .map_err(|e| format!("failed to read response: {e}"))?;

    Ok(body)
}
```

## Pattern 7: Error Aggregation

```rust
use std::collections::HashMap;

#[tauri::command]
fn validate_all(inputs: Vec<ValidationInput>) -> Result<Vec<ValidationError>, String> {
    let errors: Vec<ValidationError> = inputs.iter()
        .filter_map(|input| validate_single(input).err())
        .collect();

    if errors.is_empty() {
        Ok(errors) // Empty = all valid
    } else {
        Ok(errors) // Frontend checks length
    }
}
```

## Pattern 8: Propagation in Loops

```rust
#[tauri::command]
fn process_all_items(items: Vec<Item>) -> Result<Vec<Result>, String> {
    let mut results = Vec::new();

    for item in items {
        match process_item(&item) {
            Ok(result) => results.push(result),
            Err(e) => {
                // Log but don't abort
                eprintln!("Failed to process item {}: {e}", item.id);
                continue;
            }
        }
    }

    Ok(results)
}
```

## Error Mapping Table

| Source Error | Mapping | Use |
|-------------|---------|-----|
| `io::Error` | `map_err(\|e\| format!("IO: {e}"))` | File operations |
| `reqwest::Error` | `map_err(\|e\| format!("HTTP: {e}"))` | Network requests |
| `serde_json::Error` | `map_err(\|e\| format!("JSON: {e}"))` | Serialization |
| `rusqlite::Error` | `map_err(\|e\| format!("DB: {e}"))` | Database |
| `Option::None` | `.ok_or("not found")?` | Missing values |
| `Mutex::PoisonError` | `.map_err(\|e\| format!("lock: {e}"))` | State access |
| `base64::Error` | `.map_err(\|e\| format!("encode: {e}"))` | Encoding |

## Pitfalls

| Problem | Fix |
|---------|-----|
| `?` in `json!{}` macro | Extract to variable first, then use in `json!` |
| Error message too generic | Include context: `format!("failed to load {path}: {e}")` |
| `unwrap()` in production code | Replace with `?` or `.unwrap_or_else()` |
| Panic from `Mutex::lock()` | Use `.lock().map_err(...)?` instead |
| Error not visible to frontend | Return `Result<T, String>` from Tauri commands |
| `unwrap_or_default()` hides errors | Log the error, then use default |
