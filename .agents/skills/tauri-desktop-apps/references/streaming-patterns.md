# Streaming Patterns in Tauri 2

## SSE (Server-Sent Events) Chat Streaming

### Rust Backend (HTTP Handler)

```rust
// For apps with an internal HTTP server (MCP, API)
use tiny_http::{Server, Response};
use std::io::Read;

fn handle_chat_stream(request: &mut tiny_http::Request) {
    let mut body = String::new();
    request.as_reader().read_to_string(&mut body).ok();

    let headers = vec![
        "Content-Type: text/event-stream".to_string(),
        "Cache-Control: no-cache".to_string(),
        "Connection: keep-alive".to_string(),
        "Access-Control-Allow-Origin: tauri://localhost".to_string(),
    ];

    // Send SSE response
    let response = Response::from_string(
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n\
         data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n\
         data: [DONE]\n\n"
    ).with_header(
        tiny_http::Header::from_bytes(
            &b"Content-Type"[..],
            &b"text/event-stream"[..]
        ).unwrap()
    );

    request.respond(response).ok();
}
```

### Rust: SSE via reqwest (Proxy to External API)

```rust
#[tauri::command]
pub async fn stream_chat(
    messages: Vec<ChatMessage>,
    gateway_url: String,
    api_key: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/v1/chat/completions", gateway_url.trim_end_matches('/'));

    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "default",
            "messages": messages,
            "stream": true,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let mut full_response = String::new();
    let mut buffer = String::new();
    let mut stream = resp.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    return Ok(full_response);
                }
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                        full_response.push_str(content);
                        // Emit event to frontend
                        app.emit("chat-chunk", content).ok();
                    }
                }
            }
        }
    }

    Ok(full_response)
}
```

### Frontend: SSE via Event Listener

```typescript
// src/components/ChatStream.tsx
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState, useRef } from 'react';

export function ChatStream() {
  const [streaming, setStreaming] = useState('');
  const [fullResponse, setFullResponse] = useState('');
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Listen for SSE chunks from Rust backend
    listen<string>('chat-chunk', (event) => {
      setStreaming(prev => prev + event.payload);
    }).then(fn => { unlistenRef.current = fn; });

    return () => { unlistenRef.current?.(); };
  }, []);

  const sendMessage = async (content: string) => {
    setStreaming('');
    setFullResponse('');
    try {
      const response = await invoke<string>('stream_chat', {
        messages: [{ role: 'user', content }],
        gatewayUrl: useAppStore.getState().gatewayUrl,
        apiKey: useAppStore.getState().apiKey,
      });
      setFullResponse(response);
      setStreaming('');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      {streaming && <div className="bg-bg2 rounded p-4">{streaming}<span className="animate-pulse">▌</span></div>}
      {fullResponse && !streaming && <div className="bg-bg2 rounded p-4">{fullResponse}</div>}
    </div>
  );
}
```

### Frontend: Direct Fetch SSE (No Rust Proxy)

```typescript
// src/lib/streamSSE.ts
export async function streamSSE(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  onChunk: (text: string) => void,
  onDone: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') { onDone(); return; }
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch { /* skip */ }
    }
  }
  onDone();
}
```

## WebSocket Streaming

### Rust WebSocket Server (for real-time features)

```toml
# Cargo.toml
tokio-tungstenite = "0.24"
futures-util = "0.3"
```

```rust
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use futures_util::{SinkExt, StreamExt};

pub async fn start_ws_server(port: u16) {
    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .unwrap();

    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let mut ws = accept_async(stream).await.unwrap();
            while let Some(Ok(msg)) = ws.next().await {
                if msg.is_text() {
                    let text = msg.to_text().unwrap();
                    // Process and respond
                    let response = process_message(text).await;
                    ws.send(tungstenite::Message::Text(response.into())).await.ok();
                }
            }
        });
    }
}
```

### Frontend: WebSocket Client

```typescript
// src/lib/wsClient.ts
export class WsClient {
  private ws: WebSocket | null = null;
  private onMessage: (data: string) => void;

  constructor(url: string, onMessage: (data: string) => void) {
    this.onMessage = onMessage;
    this.connect(url);
  }

  private connect(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => this.onMessage(e.data);
    this.ws.onclose = () => {
      // Auto-reconnect after 2s
      setTimeout(() => this.connect(url), 2000);
    };
  }

  send(data: Record<string, unknown>) {
    this.ws?.send(JSON.stringify(data));
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}

// Usage:
const client = new WsClient('ws://127.0.0.1:8765', (data) => {
  const parsed = JSON.parse(data);
  // Handle real-time updates
});
```

## Tauri Events (IPC Streaming)

For Rust→Frontend push without HTTP:

```rust
// Rust: Emit events
use tauri::Manager;

app.emit("progress", serde_json::json!({
    "percent": 75,
    "message": "Processing frames..."
})).ok();
```

```typescript
// Frontend: Listen
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen<{ percent: number; message: string }>(
  'progress',
  (event) => {
    console.log(`${event.payload.percent}% - ${event.payload.message}`);
  }
);
// Cleanup: unlisten()
```

## Streaming Progress Pattern

```rust
#[tauri::command]
pub async fn long_running_task(
    app: tauri::AppHandle,
) -> Result<String, String> {
    for i in 0..100 {
        // Do work...
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Emit progress
        app.emit("task-progress", serde_json::json!({
            "percent": i,
            "message": format!("Step {}/100", i + 1)
        })).ok();
    }

    app.emit("task-complete", serde_json::json!({
        "result": "done"
    })).ok();

    Ok("completed".into())
}
```

```typescript
// Frontend
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

listen('task-progress', (e) => {
  setProgress(e.payload.percent);
  setMessage(e.payload.message);
});

listen('task-complete', () => {
  showToast('Task completed!', 'success');
});

await invoke('long_running_task');
```

## Pitfalls

| Problem | Fix |
|---------|-----|
| SSE stream stops mid-response | Ensure `Content-Type: text/event-stream` header |
| WebSocket disconnects silently | Add auto-reconnect with exponential backoff |
| Tauri event not received | Check event name matches exactly (case-sensitive) |
| Memory leak from unlisten | Always call unlisten function on component unmount |
| `fetch` with `stream: true` hangs | Ensure `ReadableStream` reader loop handles `done` |
| CORS blocks SSE from frontend | Add `tauri://localhost` to server CORS headers |
| Large SSE responses buffer | Process each `data:` line immediately, don't buffer entire response |
