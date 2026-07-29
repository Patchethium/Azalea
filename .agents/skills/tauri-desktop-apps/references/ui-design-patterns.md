# Tauri App UI Design Patterns

## FCP-Style Dark Theme

```css
:root {
  --bg0: #1a1a1e; --bg1: #1e1e22; --bg2: #252529; --bg3: #2c2c31;
  --line: #2a2a2e; --ink: #c8c8cc; --ink-dim: #888890; --ink-faint: #55555a;
  --accent: #0a84ff; --accent-deep: #0070e0;
  --success: #30d158; --danger: #ff453a;
}
```

Key principles:
- Deep dark backgrounds, NOT brown/warm charcoal
- Blue accent (#0a84ff), not amber
- Low contrast text for eye comfort
- Minimal borders (1px solid #2a2a2e)
- Subtle scrollbars

## Settings Panel Pattern

Modal overlay with sidebar tabs:
```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
  <div className="card w-[600px] max-h-[80vh] flex flex-col shadow-2xl">
    <div className="flex items-center justify-between border-b px-4 py-3">...</div>
    <div className="flex min-h-0 flex-1">
      <div className="w-[160px] border-r p-2 space-y-1">tabs</div>
      <div className="flex-1 overflow-auto p-4">content</div>
    </div>
  </div>
</div>
```

## FCP-Style Toolbar

Tools with active state highlighting:
```tsx
{[["select","↖","Select (A)"], ["blade","✂","Blade (B)"], ...].map(([tool, icon, label]) => (
  <button className={`rounded-md px-2 py-1 text-[11.5px] ${
    activeTool === tool ? "bg-accent text-white" : "text-ink-dim hover:bg-bg3 hover:text-ink"
  }`} onClick={() => setTool(tool)} title={label}>
    {icon}
  </button>
))}
```

## Theme Variables

```css
--bg0: #1a1a1e      /* deepest background */
--bg1: #1e1e22      /* panels */
--bg2: #252529      /* cards, clips */
--bg3: #2c2c31      /* hover states */
--line: #2a2a2e      /* borders */
--ink: #c8c8cc       /* primary text */
--ink-dim: #888890   /* secondary text */
--ink-faint: #55555a /* labels, captions */
--accent: #0a84ff    /* FCP blue */
--success: #30d158   /* online, active */
--danger: #ff453a    /* errors, delete */
```
