# OpenAI-Compatible Vision/Multimodal API

## Request Format

The `messages` array can contain multimodal content. User messages accept either a plain string or an array of content blocks:

```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "system", content: "..." },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Describe what you see in this frame" },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
      ]
    }
  ]
}
```

## Supported Image Formats

- `data:image/jpeg;base64,...` — most common, use for ffmpeg output
- `data:image/png;base64,...` — lossless, larger
- `data:image/webp;base64,...` — compact

## Provider Compatibility

| Provider | Vision Support | Notes |
|----------|---------------|-------|
| OpenAI (gpt-4o, gpt-4o-mini) | ✅ Native | Best quality |
| 9Router | ✅ Via proxy | Passes through to underlying model |
| Anthropic (Claude) | ✅ Native | Uses same OpenAI-compatible format via 9Router |
| Local models (llama, etc.) | ❌ | Content array sent but image ignored |

## Frontend Pattern (React/Tauri)

```tsx
// 1. Extract frame via MCP tool
const result = await engine.mcpCall("analyze_frame", {
  asset_id: clip.payload.asset_id,
  time_us: 0,
  prompt: "frame capture"
});
const frameBase64 = result.frame_base64; // raw base64 JPEG

// 2. Build multimodal content
const content = [
  { type: "text", text: userMessage },
  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frameBase64}` } }
];

// 3. Send to chat completions
const resp = await fetch(`${apiUrl}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages: [...history, { role: "user", content }], temperature: 0.3 })
});
```

## System Prompt Guidance

Add to the system prompt when vision is available:
```
- When a frame image is attached, analyze it to answer questions about visual content.
When the user asks about colors, brightness, or visual properties, you can see frames.
Describe what you observe.
```
