# Adding MCP Tools to Tauri Rust Projects

## Architecture

MCP tools in Tauri have TWO parts that must BOTH be present:

1. **Tool definition** in `tool_defs()` — JSON describing the tool to the MCP protocol
2. **Dispatch** in the tool-call handler — the actual Rust implementation

If either is missing, the build fails or the tool silently doesn't work.

## Adding a New MCP Tool (Step by Step)

### Step 1: Add tool definition to `tool_defs()`

Find the `tool_defs()` function (returns `Value` — a JSON array of tool definitions). Add BEFORE the history section (`undo`/`redo`):

```rust
tool(
    "your_tool_name",
    "Description of what the tool does.",
    json!({
        "param_name": str_("description"),
        "optional_param": int("description (default 0)"),
    }),
    &["required_param"],  // required params
    Kind::Read,           // or Kind::Edit, Kind::Destructive
),
```

### Step 2: Add dispatch to the call handler

Find the match arm for tool calls (after `"tools/list"` dispatch). Add BEFORE the history section:

```rust
"your_tool_name" => finish((|| {
    let required = args.id("required")?;  // args.id() returns Result
    let optional = args.i64("optional").unwrap_or(0);
    // ... implementation ...
    Ok(json!({ "result": value }))
})()),
```

### Step 3: Register in invoke_handler (if Tauri command)

If the tool also needs to be callable from the frontend via `invoke()`:

```rust
// In .invoke_handler():
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    your_command,  // must match #[tauri::command] fn name
])
```

## Key Patterns

### `args.id()` returns `Result<Id, String>`, use `?`
```rust
let id = args.id("clip_id")?;  // ✅
```

### `project.asset()` returns `Option`, not `Result`
```rust
let asset = store.project.asset(id).ok_or("asset not found")?;  // ✅
```

### `finish((|| { ... })())` pattern for dispatch
The dispatch function returns `Value`, not `Result`. Use `finish()` to wrap closures that return `Result`:
```rust
"tool_name" => finish((|| {
    // ? works inside here
    Ok(json!({ "ok": true }))
})()),
```

### `format!` outside `json!` macro
```rust
// ✅ WRONG — format! inside json! causes cryptic errors
json!({ "path": format!("{:.6}", time_sec) })

// ✅ CORRECT — compute first, then reference
let ss_str = format!("{:.6}", time_sec);
json!({ "path": ss_str })
```

### `text_result()` and `tool_error()` helpers
```rust
text_result(json!({ "data": value }))        // success response
tool_error("something went wrong")            // error response
```

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Tool def in dispatch section | `expected pattern, found {` | Tool defs go in `tool_defs()`, dispatch goes in call handler |
| `format!` inside `json!` macro | `expected pattern, found {` | Compute format! first, pass result to json! |
| `args.id()` treated as `Option` | `no method named map_err` | It returns `Result`, use `?` |
| `project.asset()` treated as `Result` | `no method named ok_or` | It returns `Option`, use `.ok_or()` |
| Missing tool def OR dispatch | Tool not listed or silently fails | Must add BOTH |
| Python script to modify Rust | Accidentally deletes functions, corrupts structure | Never use Python to modify Rust code — use manual edits or `patch` tool |
| `let-else` in Rust 2015/2021 | `expected pattern` error | Use `if let` / `match` instead |
| `reqwest` not in Cargo.toml | `unresolved import reqwest` | Add `reqwest = { version = "0.12", features = ["json"] }` to Cargo.toml |
| `asset.path` is `String` not `PathBuf` | `no method named to_str/to_string_lossy` | Use `.clone()` — it's already a `String` |
| `call_tool()` function missing | Build succeeds but MCP calls panic | Function must exist in mcp.rs — check upstream if accidentally deleted |

## Why Python Scripts to Modify Rust Are Dangerous

Repeated pattern: Python string replacement on Rust files caused:
1. Tool definitions inserted INSIDE wrong functions (tool_defs vs call_tool)
2. Function definitions accidentally deleted (call_tool removed entirely)
3. Brace imbalances from partial replacements
4. Multi-hour debugging loops

**Rule**: Never use Python/sed to modify complex Rust code. Use manual edits or the `patch` tool for precise, verifiable changes.

## Reference: analyze_frame MCP Tool

Complete working example of a read-only MCP tool that extracts a video frame as base64 JPEG. This pattern is used for AI vision analysis (color correction, perspective detection, etc.).

```rust
// In tool_defs():
tool(
    "analyze_frame",
    "Extract a frame from a video/image asset at a given time and return it as base64 JPEG for AI analysis.",
    json!({
        "asset_id": str_("asset id from get_media_pool"),
        "time_us": int("time in microseconds (default 0)"),
        "prompt": str_("what to analyze"),
    }),
    &["asset_id"], Kind::Read,
),

// In call_tool dispatch:
"analyze_frame" => finish((|| {
    let asset_id = args.id("asset_id")?;
    let time_us = args.i64("time_us").unwrap_or(0);
    let prompt = args.str("prompt").unwrap_or("Describe the image in detail");

    let store = state.store.lock().unwrap();
    let asset = store.project.asset(asset_id).ok_or("asset not found")?;
    let path = asset.path.clone();  // String, not PathBuf!
    drop(store);

    let time_sec = time_us as f64 / 1_000_000.0;
    let ss_str = format!("{:.6}", time_sec);
    let output = std::process::Command::new("ffmpeg")
        .args(["-ss", &ss_str, "-i", &path, "-frames:v", "1",
               "-f", "image2", "-c:v", "mjpeg", "-q:v", "5",
               "-vf", "scale=512:-1", "pipe:1"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg failed: {e}"))?;

    if !output.status.success() {
        return Err("ffmpeg frame extraction failed".into());
    }

    let b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD, &output.stdout);

    Ok(json!({
        "frame_base64": b64,
        "mime_type": "image/jpeg",
        "prompt": prompt,
        "time_us": time_us,
    }))
})()),
```

## Reference: Recovering from Accidentally Deleted Functions

When Python scripts or sed commands accidentally delete functions (like `call_tool()`), recovery pattern:

```bash
# 1. Check if the function exists locally
grep -c "fn call_tool" src-tauri/src/mcp.rs  # 0 = deleted

# 2. Add upstream remote
git remote add upstream https://github.com/original-owner/repo.git
git fetch upstream main

# 3. Restore the specific file from upstream
git show upstream/main:src-tauri/src/mcp.rs > src-tauri/src/mcp.rs

# 4. Verify function exists
grep -c "fn call_tool" src-tauri/src/mcp.rs  # 1 = restored

# 5. Then add your new tool on top
```

**Critical**: After restoring from upstream, always re-apply your changes manually — never use Python scripts for this.
