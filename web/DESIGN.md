# DESIGN.md — Ember buyback and burn

Design system of the single-page frontend in `web/`, extracted from the final source. All
tokens live in `web/src/styles.css`; components are React function components under
`web/src/components/`. There is no CSS framework, no component library and no web font.

This file sits in `web/` because the frontend assignment's write scope is `web/**`, `dist/**`
and `docs/**`; it is the repository's design document for the site.

## Overview

The audience is anyone watching or operating the Ember (EMBR) buyback-and-burn hook on
Sepolia: token holders checking the burned total, and people willing to press the public
buyback button or trade through the pool. The character is a calm, warm, light utility page:
off-white page, white cards, one ember-orange accent used for the single primary action and
for links, and status colours that appear only inside badges and status messages.

System-wide rules:

- One column of content, `64rem` wide at most, with a header bar, a stats row, a two-column
  card grid on wide screens, a full-width table card and a footer of contract links.
- Hierarchy is carried by size and weight, not by colour. Only the primary button and links
  use the accent.
- Every live value uses tabular figures so polling updates do not shift the layout.
- Status is never colour alone: badges and messages carry a dot or icon plus text.
- Motion is opt-in under `prefers-reduced-motion: no-preference` and limited to a spinner,
  colour transitions of 150 ms and a `scale(0.96)` press.

One-page arrangements that are not rules: the four-tile stats row and the buyback/swap card
pairing belong to this page. A new page should reuse the primitives below, not that layout.

## Colors

Notation is `oklch()`. Primitives are named by hue and step; components reference only the
semantic tokens. Defined in `web/src/styles.css` under `:root`. Light theme only; there is
deliberately no dark theme.

| Role token | Primitive | Value | Use |
| --- | --- | --- | --- |
| `--color-bg-page` | `--neutral-50` | `oklch(0.975 0.006 75)` | `body` background |
| `--color-bg-surface` | `--neutral-0` | `oklch(1 0 0)` | Cards, header, inputs, secondary buttons |
| `--color-bg-subtle` | `--neutral-100` | `oklch(0.955 0.008 75)` | Fact panels, quote box, empty state, account pill, disabled inputs |
| `--color-bg-accent-subtle` | `--ember-100` | `oklch(0.95 0.03 45)` | Selected segment background |
| `--color-border` | `--neutral-200` | `oklch(0.9 0.01 75)` | Card and table hairlines, header rule |
| `--color-border-strong` | `--neutral-400` | `oklch(0.64 0.015 70)` | Input, select, secondary-button and step-index borders (≥3:1 on white) |
| `--color-text-primary` | `--neutral-900` | `oklch(0.22 0.02 55)` | Body text, headings, values |
| `--color-text-secondary` | `--neutral-600` | `oklch(0.45 0.02 55)` | Labels, notes, helper text |
| `--color-text-on-accent` | `--neutral-0` | `oklch(1 0 0)` | Text on the primary button |
| `--color-accent-solid` | `--ember-500` | `oklch(0.55 0.19 38)` | Primary button fill, selected segment border, radio accent |
| `--color-accent-hover` | `--ember-600` | `oklch(0.5 0.19 38)` | Primary button hover, link hover |
| `--color-accent-text` | `--ember-700` | `oklch(0.45 0.17 38)` | Links, brand icon, current-step number |
| `--color-focus-ring` | `--blue-600` | `oklch(0.5 0.2 255)` | `:focus-visible` outline everywhere |
| `--color-success-*` | `--green-100/300/700` | bg `oklch(0.95 0.04 150)`, border `oklch(0.85 0.08 150)`, text `oklch(0.4 0.12 150)` | "Ready" badge, confirmed transaction, done step |
| `--color-warning-*` | `--amber-100/300/700` | bg `oklch(0.96 0.05 85)`, border `oklch(0.86 0.1 85)`, text `oklch(0.45 0.11 70)` | "Not ready" badge, wallet rejection |
| `--color-error-*` | `--red-100/300/700` | bg `oklch(0.96 0.03 25)`, border `oklch(0.86 0.08 25)`, text `oklch(0.45 0.18 25)` | Errors, reverts, invalid input border |
| `--color-info-*` | `--neutral-100/200/800` | bg, border, text `oklch(0.3 0.02 55)` | Informational blockers ("Connect a wallet…") |

Contrast was computed from these declared pairs (see `docs/frontend/validation.md`): primary
text ≥15:1, secondary text ≥6.5:1, links ≥6.8:1 on every surface, white on the primary button
5.29:1, all status text ≥6.7:1 on its own background, focus ring ≥5.3:1 on page and card
surfaces, strong border 3.37:1 on white.

Rules: the accent hue means "interactive". Do not use `--color-accent-text` on static text,
and do not put a second filled accent button in a view. Add a role token rather than reusing
a border token as text.

## Typography

Families (`--font-sans`, `--font-mono`): the system UI stack
`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
and `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` for
addresses, hashes and the account pill. No font files are shipped; weights 400, 500, 600 and
700 are requested and rendered by whatever system face is active.

| Token | Size | Role |
| --- | --- | --- |
| `--text-2xl` | 1.75rem, weight 700, line-height 1.15, `-0.01em`, `text-wrap: balance` | `.page-title` (the page `h1`) |
| `--text-stat` | 1.625rem, weight 600, line-height 1.15 | `.stat-value` |
| `--text-lg` | 1.125rem, weight 600, line-height 1.3 | Card and footer `h2` |
| `--text-base` | 1rem, line-height 1.55 | Body, inputs, large button |
| `--text-sm` | 0.875rem | Buttons, labels, table cells, card subtitles, status text, badges |
| `--text-xs` | 0.75rem | Fact labels, stat notes, helper text, table headers |

Rules in the source: `.num` applies `font-variant-numeric: tabular-nums` to every changing
value; `.lede` caps the intro at `62ch` with `text-wrap: pretty`; `.footer-note` at `70ch`;
`overflow-wrap: anywhere` on values, hashes and status text so nothing escapes a 320 px
card; links use `from-font` underline metrics. Inputs are 1rem so iOS does not zoom.
Text sizes are `rem`, so browser text scaling is respected.

## Layout

Spacing scale `--space-1…12` = 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3 rem. Grouping is by space
first: `gap: var(--space-4)` between blocks inside a card, `--space-1/2` inside a group,
`--space-6` between page sections (`main` is a flex column). Hairlines only separate table
rows and the header/footer.

- `.container`: `max-width: 64rem`, `padding-inline: 1rem`, `1.5rem` from `40rem` up.
- `.stats`: `grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr))`, so the
  four tiles go 4 → 2 → 1 columns based on content width, not device presets.
- `.grid` (buyback + swap cards): one column, two from `56rem`.
- `.facts`: auto-fit `9rem` columns inside a subtle panel.
- `.segmented`: one column, two from `30rem`.
- `.contract-list`: auto-fit `15rem` columns.
- Table: at widths below `40rem` the header row is visually hidden and each row becomes a
  two-column grid with `data-label` captions (`.table td::before`), so the history stays
  readable at 320 px without horizontal scrolling. The wrapper still has `overflow-x: auto`
  as a fallback.
- Logical properties (`padding-inline`, `margin-inline`, `inset-inline-start`, `text-align:
  start/end`) are used throughout, so the layout mirrors under `dir="rtl"`; the RTL mirror
  was not inspected in a browser.
- Skip link (`.skip-link`) is the first focusable element and targets `#main`.

Observed in headless Chromium at 1280, 768 and 320 px: no horizontal overflow at 320 px in
the disconnected and connected states.

## Elevation & Depth

Flat with one soft lift: `.card` has `--shadow-card`
(`0 1px 2px oklch(0 0 0 / 0.04), 0 4px 12px oklch(0 0 0 / 0.04)`) plus a `--color-border`
hairline. Stats tiles, fact panels, the quote box and the empty state are borders or tonal
fills only. There are no overlays, dialogs or stacked layers; status messages sit in flow.

## Shapes

| Token | Value | Used by |
| --- | --- | --- |
| `--radius-lg` | 0.75rem | Cards, stat tiles |
| `--radius-md` | 0.5rem | Buttons, inputs, selects, fact panels, quote box, status messages, segments, skip link |
| `--radius-sm` | 0.375rem | reserved; currently unused by components |
| `--radius-pill` | 999px | Badges, account pill, step index, dots, spinner |

Borders are 1 px. Nested radii are not concentric by formula; controls (0.5rem) sit inside
cards (0.75rem) with ≥1.25rem padding, which reads as intended. Keep that pairing.

## Components

All in `web/src/components/` unless noted. None are published as a library; reuse by import.

- **Button** (`.button`, `.button-primary`, `.button-secondary`, `.button-large`) — plain
  `<button>` elements styled in `styles.css`. Primary is the one filled action in a card;
  secondary is white with a strong border. Min height 2.5rem (2.75rem large), `touch-action:
  manipulation`, 150 ms colour transition, `scale: 0.96` on `:active` under no-preference,
  `opacity: .55` + `not-allowed` when `disabled`. Loading state: `<Spinner/>` placed before the
  unchanged label. Focus: global `:focus-visible` 2 px ring with 2 px offset.
- **StatusMessage** (`Status.tsx`, `.status status-{tone}`) — inline message with a
  redundant icon; `role="alert"` for `error`, `role="status"` otherwise. Tones: neutral, info,
  success, warning, error. Use for blockers, results and errors next to the control.
- **Badge** (`Status.tsx`, `.badge badge-{tone}`) — pill with a dot; used for buyback
  readiness ("Can run now" / "Not yet", "Ready to run" / "Not ready").
- **Spinner** (`Status.tsx`, `.spinner`) — 0.875rem ring, animated only under
  `prefers-reduced-motion: no-preference`, always `aria-hidden`.
- **TxStatus** (`TxStatus.tsx`) — maps the `useTransaction` phase (simulating, signing,
  pending, confirmed, reverted, failed, rejected) to a StatusMessage with an explorer link.
- **WalletControl** (`WalletControl.tsx`, `.wallet*`) — discovering / no-wallet / connect /
  connected states; optional `<select>` when several wallets announce; a single "Switch to
  Sepolia" primary button while on the wrong chain; account pill links to the explorer.
- **Stat tile** (`App.tsx`, `.stat`) — label, `.stat-value.num` with `.stat-unit`, note.
- **Card** (`.card`, `.card-header`, `.card-subtitle`) — section container with an `h2`.
- **Facts** (`.facts`, `.fact`, `.facts-compact`) — definition-list grid for key/value pairs.
- **Field** (`.field`, `.field-label`, `.field-help`, `.input`, `.input-row`) — labelled
  `<input type="text" inputmode="decimal">`; invalid state via `aria-invalid` +
  `aria-describedby` helper text; never placeholder-only.
- **Segmented control** (`.segmented`, `.segment`) — a `<fieldset>` of radio inputs; the
  wrapping label shows the accent border and `:focus-within` ring.
- **Steps** (`.steps`, `.step`, `.step-index`, `.step-current`, `.step-done`) — ordered list
  for the sell flow; the current step renders its button, done steps show ✓ and an sr-only
  "(done)".
- **Table** (`BuybackTable.tsx`, `.table`) — caption (sr-only), `th scope="col"`, numeric
  columns right-aligned, stacked layout under 40rem; empty state `.empty` with a next step.
- **Footer** (`Footer.tsx`, `.footer`, `.contract-list`) — `dl` of contracts and identifiers
  with explorer links.

## Do's and Don'ts

- Start a new page from `.container` → `<main id="main">` → `.card` sections with an `h2`
  each; keep one `h1`.
- One `.button-primary` per card; everything else `.button-secondary`. Disabled primary
  actions always have a nearby `StatusMessage` or list explaining why.
- Put changing numbers in `.num`; keep units in `.stat-unit` or after the value, never in a
  separate colour.
- Use semantic tokens only; add a token for a new role instead of reusing `--color-border`
  as text or the accent as a static highlight.
- Do not add a dark theme, a second accent hue, decorative animation, or a modal; none exist
  and the reduced-motion and focus rules are tuned for the current inventory.
- Do not introduce `px` breakpoints or physical `margin-left`/`right`; use `rem` queries and
  logical properties as the stylesheet does.

Recipe for another page: copy `index.html` and `main.tsx`, render a component that returns
`<a class="skip-link">`, the `.site-header` with `WalletControl`, a `<main id="main"
class="container">` with an `h1.page-title`, a `p.lede`, and `.card` sections built from
`facts`, `field`, `button` and `StatusMessage`; load deployment data through `useDeployment`
and `createAppContext` so addresses still come from `imd-deployment.json`.
