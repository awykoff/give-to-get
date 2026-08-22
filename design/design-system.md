# give-to-get.com Design System

## Colors

```javascript
const C = {
  bg:           "#0C0C0F",                      // Page background — near black
  sidebar:      "#111115",                      // Sidebar + top bar
  surface:      "#18181D",                      // Cards, panels, modals
  surfaceHover: "#1E1E25",                      // Hovered/selected rows
  border:       "rgba(255,255,255,0.07)",       // Default ghost borders
  borderHover:  "rgba(255,255,255,0.13)",       // Hover border state
  borderAccent: "rgba(139,92,246,0.35)",        // Purple-tinted borders
  text:         "#F0EEFF",                      // Primary — near white, purple undertone
  muted:        "#8B87A8",                      // Secondary labels
  subtle:       "#4E4A66",                      // Hints, timestamps, disabled
  accent:       "#8B5CF6",                      // Violet-500 — buttons, active states
  accentHover:  "#9D71FA",                      // Hover
  accentLight:  "rgba(139,92,246,0.12)",        // Badge backgrounds, row highlights
  accentText:   "#C4B5FD",                      // Violet-300 — text on purple BGs
  accentDark:   "#7C3AED",                      // Violet-600 — gradient end
  success:      "#34D399",                      // Emerald-400
  successLight: "rgba(52,211,153,0.12)",
  successText:  "#6EE7B7",
  danger:       "#F87171",                      // Red-400
  dangerLight:  "rgba(248,113,113,0.10)",
  warn:         "#FBBF24",                      // Amber-400
  warnLight:    "rgba(251,191,36,0.10)",
  warnText:     "#FDE68A",
}
```

## Typography

- **Font**: DM Sans (Google Fonts)
- **Import**: `https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap`
- **Fallback**: `-apple-system, BlinkMacSystemFont, sans-serif`

| Role | Size | Weight |
|---|---|---|
| Display (balance) | 38px | 700 |
| Page heading | 22px | 700 |
| Card heading | 16px | 700 |
| Eyebrow label | 10px | 700 + uppercase + 0.08em tracking |
| Body | 13px | 400 |
| Body strong | 13px | 600 |
| Caption | 11px | 400 |
| Badge | 11px | 600 |

## Layout

| Token | Value |
|---|---|
| Sidebar width | 224px |
| Top bar height | 52px |
| Page padding | 24px |
| Card radius | 10px |
| Button radius | 7px |
| Badge radius | 5px |
| Modal radius | 14px |
| Card grid gap | 10–12px |

## Gradients

```css
/* Logo mark */
background: linear-gradient(135deg, #8B5CF6, #6D28D9);

/* Progress bars / charts */
background: linear-gradient(90deg, #8B5CF6, #6D28D9);

/* Accent card (credits, highlights) */
background: linear-gradient(135deg, rgba(139,92,246,0.25), rgba(109,40,217,0.2));
```

## Vertical Badge Colors

| Vertical | Background | Text |
|---|---|---|
| SaaS | rgba(139,92,246,0.18) | #C4B5FD |
| FinTech | rgba(52,211,153,0.15) | #6EE7B7 |
| MarTech | rgba(251,191,36,0.15) | #FDE68A |
| Data | rgba(96,165,250,0.15) | #93C5FD |
| HRTech | rgba(248,113,113,0.15) | #FCA5A5 |
| Other | rgba(255,255,255,0.07) | #8B87A8 |

## Global CSS

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');

* { box-sizing: border-box; }

body {
  background: #0C0C0F;
  color: #F0EEFF;
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.25); border-radius: 3px; }

::placeholder { color: #4E4A66; }

input:focus, textarea:focus {
  outline: none;
  border-color: rgba(139,92,246,0.5) !important;
  box-shadow: 0 0 0 2px rgba(139,92,246,0.12);
}

tr:hover td { background: rgba(139,92,246,0.04); }

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
```
