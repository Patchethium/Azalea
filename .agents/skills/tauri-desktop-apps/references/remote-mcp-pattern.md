# Remote MCP Server Pattern

## Problem
MCP server binds to `127.0.0.1` by default — only localhost access. For remote access (e.g., Hermes webUI connecting to a desktop app), need `0.0.0.0`.

## Solution

### Rust (mcp.rs)

```rust
pub fn start(app: tauri::AppHandle, remote: bool) -> Option<u16> {
    let bind_addr = if remote { "0.0.0.0" } else { "127.0.0.1" };
    let server = tiny_http::Server::http((bind_addr, MCP_PORT)).ok()?;
    // ... rest of server setup
}
```

### Caller (lib.rs)

```rust
// Local only:
match mcp::start(app.handle().clone(), false) { ... }

// Remote access:
match mcp::start(app.handle().clone(), true) { ... }
```

### Settings UI

Add a toggle in Settings → MCP Server:
- "Local only (127.0.0.1)" — default, secure
- "Remote access (0.0.0.0)" — allows LAN connections

### Security
- Token auth is ALWAYS required (already implemented)
- Warn user when enabling remote mode
- Consider TLS for production use

## Why not WebSocket?
- MCP spec is HTTP-based (JSON-RPC over HTTP POST)
- WebSocket adds complexity without benefit for request-response
- Current tiny_http implementation is sufficient
