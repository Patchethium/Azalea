# MCP Tool Addition Pattern for Tauri Apps

## Quick Reference

To add a new MCP tool to `src-tauri/src/mcp.rs`:

### 1. tool_defs() — Add tool definition

```rust
// Find: // --- history
// Insert before it:
tool(
    "analyze_frame",
    "Description here",
    json!({
        "asset_id": str_("asset id from get_media_pool"),
        "time_us": int("time in microseconds (default 0)"),
    }),
    &["asset_id"], Kind::Read,
),
```

### 2. call_tool() — Add dispatch

```rust
// Find: "undo" => finish(
// Insert before it:
"analyze_frame" => finish((|| {
    let asset_id = args.id("asset_id")?;
    let time_us = args.i64("time_us").unwrap_or(0);
    // ... do work ...
    Ok(json!({ "result": value }))
})()),
```

## Gotchas (from real debugging)

1. **`format!` inside `json!{}`** — FAILS at compile time. Move to variable first:
   ```rust
   let ss_str = format!("{:.6}", time_sec);
   // Then use &ss_str in json! or .args()
   ```

2. **`path.to_str()` on String** — `asset.path` is `String` not `PathBuf`. Use `path.clone()`.

3. **`args.id()` returns `Result`** — OK inside `finish((|| { ... })())` because it returns `Result<Value, String>`.

4. **`project.asset(id)` returns `Option`** — use `.ok_or("not found")?`

5. **`let-else` pattern** — requires Rust 2021+, may not work in all Tauri setups. Use `if let` instead.

6. **`tool_error()` returns `Value`** — use `return tool_error("msg")` inside closures that return `Value`.

7. **Duplicate tool definitions** — Python/sed scripts often insert tool_defs in the WRONG function. Always verify with `grep -c "tool_name" file.rs` — should be exactly 2 (one def, one dispatch).

## Reference: analyze_frame tool

```rust
// tool_defs:
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

// dispatch:
"analyze_frame" => finish((|| {
    let asset_id = args.id("asset_id")?;
    let time_us = args.i64("time_us").unwrap_or(0);
    let prompt = args.str("prompt").unwrap_or("Describe the image");

    let store = state.store.lock().unwrap();
    let asset = store.project.asset(asset_id).ok_or("asset not found")?;
    let path = asset.path.clone();
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
