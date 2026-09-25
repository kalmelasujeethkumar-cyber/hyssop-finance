# HYSSOP FINANCE — Design Tokens

## Token policy

These tokens establish a professional, light-only visual system for the eventual application. The palette uses white and blue for structure, with orange as a restrained accent. Semantic tokens should be used instead of hard-coded colors in components.

## Core color tokens

| Token | HEX | Intended use |
|---|---|---|
| `color.canvas` | `#F6F9FC` | Application background |
| `color.surface` | `#FFFFFF` | Cards, panels, tables, dialogs |
| `color.surface-subtle` | `#EEF4F9` | Secondary panels and table headers |
| `color.text.primary` | `#172B4D` | Main text and headings |
| `color.text.secondary` | `#52657A` | Supporting text |
| `color.text.inverse` | `#FFFFFF` | Text on dark blue controls |
| `color.border.default` | `#D7E1EA` | Borders and dividers |
| `color.border.strong` | `#AABBCB` | Strong boundaries and input outlines |
| `color.blue.700` | `#123B63` | Primary hover/pressed state and dark accents |
| `color.blue.600` | `#1D5FA7` | Primary actions, links, selected navigation |
| `color.blue.100` | `#DCEBFA` | Informational background |
| `color.orange.700` | `#9A4D00` | Accessible orange text and warning accent |
| `color.orange.600` | `#C45F0A` | Accent fill where sufficient contrast is checked |
| `color.orange.100` | `#FFF0DF` | Warm highlight background |
| `color.success.700` | `#18794E` | Success text and status |
| `color.success.100` | `#DFF4E9` | Success background |
| `color.warning.700` | `#8A5200` | Warning text and status |
| `color.warning.100` | `#FFF1D6` | Warning background |
| `color.danger.700` | `#B42318` | Destructive text and status |
| `color.danger.100` | `#FDE3E1` | Destructive background |
| `color.focus` | `#0B63CE` | Visible focus ring |

Orange fills and text must be contrast-tested in their actual context. Orange is an accent, not the default text color. Do not use low-contrast orange text on white; use `color.orange.700` for text or a darker approved state.

## Typography

Use a system sans-serif stack unless a later approved font decision adds a dependency:

`Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

- Page title: 28–32px, weight 700, compact line height.
- Section title: 18–22px, weight 650–700.
- Body and form text: 14–16px, weight 400–500.
- Supporting metadata: 12–13px, weight 400–600.
- Monetary emphasis: tabular numerals where supported, never clipped.

Do not communicate meaning by font size alone. Maintain readable contrast and line height.

## Spacing and shape

Use a four-point spacing scale:

`space.1=4px`, `space.2=8px`, `space.3=12px`, `space.4=16px`, `space.5=20px`, `space.6=24px`, `space.8=32px`, `space.10=40px`, `space.12=48px`.

Use 8px base component gaps, 16px form gaps, and 24px or 32px section gaps. Use compact 6–8px radii for controls and 10–12px radii for cards. Avoid excessive rounding and decorative effects.

## Elevation and borders

Prefer borders and subtle surface contrast to heavy shadows. Use a low, soft shadow only for menus, dialogs, and elevated quick actions. Do not use glassmorphism. Keep focus rings visible in both light surfaces and selected navigation.

## Motion

Use short, purposeful transitions for disclosure, focus, and feedback. Avoid continuous animation. Respect reduced-motion preferences. A financial save should never rely on animation to communicate completion.

## Component states

Every interactive component must define default, hover, active, focus-visible, disabled, loading, and error states where applicable. Status badges pair color with text and an accessible label. Destructive controls use danger tokens and confirmation, never color alone.

## Accessibility checks

Before final completion, verify text/background contrast, keyboard focus visibility, dialog semantics, touch target size, chart alternatives, table reading order, and reduced-motion behavior. The exact HEX values are the source of truth; component-specific opacity must not reduce contrast below the approved target without an explicit design review.
