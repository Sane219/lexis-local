---
name: LexisLocal
description: A quiet, offline PDF reading instrument — neutral chrome, a single reading-blue accent, and answers that surface where attention already is.
colors:
  primary: "#2563eb"
  neutral-bg: "#ffffff"
  neutral-surface: "#f9fafb"
  neutral-raised: "#f3f4f6"
  neutral-border: "#e5e7eb"
  ink-strong: "#1f2937"
  ink: "#4b5563"
  ink-muted: "#9ca3af"
  ink-label: "#6b7280"
  signal-amber: "#fef3c7"
  signal-violet: "#6d28d9"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.05em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-bg}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "#1d4ed8"
    textColor: "{colors.neutral-bg}"
  chat-bubble-user:
    backgroundColor: "#eff6ff"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  chat-bubble-assistant:
    backgroundColor: "{colors.neutral-raised}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
---

# Design System: LexisLocal

## 1. Overview

**Creative North Star: "The Reading Instrument."**

LexisLocal is a tool that disappears into the task. The PDF and its text are the subject; every panel, divider, and accent exists only to help the reader understand a dense document faster — without surrendering it to a cloud. The interface is neutral and recedes: pale gray rails, hairline borders, and a single restrained reading-blue accent that marks action and semantic linkage. Confidence is conveyed through accuracy and restraint, never decoration. This system explicitly rejects the chat-first AI wrapper (no glowing gradients, no chrome competing with the document), the cloud-SaaS dashboard with hero metrics, and the playful consumer app. It is a professional instrument — closer to a code editor or a legal reader than to a marketing site.

**Key Characteristics:**
- Neutral chrome, single accent: one reading-blue (≤10% of any screen) carries every primary action and semantic cue.
- Flat by default: depth is tonal (gray-50 → gray-100) and bordered, never shadowed.
- Answers in place: definitions, citations, and navigation surface where attention already is, tied back to source page.
- Motion is a state change, not a performance: one short fade for hover cards, honored under `prefers-reduced-motion`.

## 2. Colors

A near-monochrome neutral foundation with a single reading-blue accent; two narrow signal hues (amber, violet) appear only as functional confirmations, never as decoration.

### Primary
- **Reading Ink Blue** (#2563EB): every primary action (Open PDF, Download model) and every semantic cue in the document — the dotted underline on extracted terms and the tinted underline on cross-references. Used sparingly; its rarity is the point.

### Secondary
- **Signal Amber** (#FEF3C7 background / #78350F text): the "Check anomalies" action only. A quiet confirmation hue that never bleeds into the rest of the UI.

### Tertiary
- **Cross-Doc Violet** (#6D28D9): the "Also in: [other document]" line in cross-document links only. A thin thread between documents, not a surface color.

### Neutral
- **Paper White** (#FFFFFF): the document reading surface (main pane).
- **Instrument Gray** (#F9FAFB): the sidebar rail and resting surfaces — chrome that recedes.
- **Raised Gray** (#F3F4F6): assistant chat bubbles and hover-fill on list items.
- **Hairline** (#E5E7EB): every border, divider, and card edge.
- **Ink Strong** (#1F2937): primary text, document title, list item names.
- **Ink** (#4B5563): secondary text, definitions, explanations.
- **Ink Label** (#6B7280): uppercase section headers ("Documents", "Definitions").
- **Ink Muted** (#9CA3AF): placeholders, page counts, empty states.

### Named Rules
**The One Voice Rule.** The reading-blue accent appears on ≤10% of any screen. It marks actions and meaning; everything else is neutral gray. Its restraint is the brand.

**The Thread, Not the Fill Rule.** Amber and violet are signal threads, not surfaces. They appear only on their one functional target each; never as backgrounds for whole panels.

## 3. Typography

**Display Font:** ui-sans-serif, system-ui, -apple-system, sans-serif (Tailwind default sans stack).
**Body Font:** same system sans stack — no custom typeface is loaded; the document's own rendered glyphs carry the reading voice.
**Label/Mono Font:** none distinct; uppercase + letter-spacing does the labeling work.

**Character:** A default system sans, chosen so the interface vanishes and the PDF leads. No display serif, no expressive face — restraint over personality.

### Hierarchy
- **Display** (600, 1.125rem / 18px, 1.4): the open document's title, top of the main pane.
- **Headline** (600, 0.75rem / 12px, letter-spacing 0.05em, uppercase): section labels — "Documents", "Definitions", "Cross-references".
- **Body** (400, 0.875rem / 14px, 1.5): chat messages, definitions, explanations, list content. Comfortable at full pane width.
- **Label** (400, 0.75rem / 12px): page counts, model sizes, status line, placeholders.

### Named Rules
**The Quiet Header Rule.** Section labels are small, uppercase, and Ink Label gray (#6B7280) — they organize without competing with the document's text.

## 4. Elevation

This system is flat. Depth is conveyed entirely through tonal layering (Paper White → Instrument Gray → Raised Gray) and hairline borders (#E5E7EB). There are no box-shadows anywhere in the product, by design — shadow would read as SaaS dashboard chrome, which the brand rejects. The PDF canvas itself supplies the only "lift," and the UI defers to it.

### Shadow Vocabulary
- None. If a future surface genuinely needs separation, use a 1px Hairline border or a one-step tonal shift, never a drop shadow.

### Named Rules
**The Flat-by-Default Rule.** Surfaces are flat at rest. Separation comes from tone and border, not shadow. A shadow here would signal "cloud app," which this is not.

## 5. Components

### Buttons
- **Shape:** gently squared corners (4px radius).
- **Primary:** Reading Ink Blue background (#2563EB) with white text, padding 8px × 16px. Used for "Open PDF" and "Download".
- **Hover / Focus:** darkens to #1D4ED8 on hover; `disabled` drops to 50% opacity (never removes the affordance).
- **Secondary (anomalies):** Signal Amber fill (#FEF3C7) with #78350F text, 6px radius, hover deepens to #FDE68A. The only non-blue action.

### Chips
- None as standalone tags; document list rows serve as selection chips (see Navigation).

### Cards / Containers
- **Corner Style:** 4px radius (model library cards, document rows).
- **Background:** Instrument Gray (#F9FAFB) rails; Paper White main; Raised Gray on hover.
- **Shadow Strategy:** none — see Elevation.
- **Border:** 1px Hairline (#E5E7EB) on cards and the sidebar/main divide.
- **Internal Padding:** 8–12px scale (p-2 to p-3); model cards 10px (p-2.5).

### Inputs / Fields
- **Style:** white field, 1px border in #D1D5DB (gray-300), 6px radius, 8px padding, 0.875rem text.
- **Focus:** 1px focus ring in Reading Ink Blue at 400 alpha (`focus:ring-1 focus:ring-blue-400`), no glow, no border color shift.
- **Error / Disabled:** errors render as inline text (red only inside a thrown message string); disabled buttons sit at 50% opacity.

### Navigation
- **Sidebar rail** (w-64, Instrument Gray, right Hairline border): holds file picker, document list, model library, status line.
- **Document list rows:** full-width text-left buttons; selected row fills Reading Ink Blue at 100 alpha (#EFF6FF bg / #1D4ED8 text), unselected hover to Raised Gray. Selection is the only persistent accent in the rail.
- **Main pane:** Paper White, scrolls independently; Chat panel is a fixed 24rem rail on the right with its own left Hairline border.

### Signature Component: The Semantic Text-Layer Cue
The PDF's selectable text is transparent (it overlays the canvas), so meaning is cued, not colored:
- **Defined term:** a dotted underline in Reading Ink Blue at 65% alpha (`text-decoration-color: rgb(37 99 235 / 0.65)`), 1px, 2px offset, `cursor: help`. Hovering opens a Radix tooltip that fades in over 150ms (`lexis-card-in`) and respects `prefers-reduced-motion`.
- **Cross-reference:** a faint Reading Ink Blue tint (10% → 20% on hover) with a solid 80%-alpha blue underline; `cursor: pointer`, jumps the viewport to the target page.

### Reading aids
- **Semantic text layer is keyboard-operable.** Defined-term spans are `tabIndex=0 role=button` (focus opens the definition card); cross-reference spans are `tabIndex=0 role=link` (Enter/Space jumps to the target page). Mouse and keyboard share one code path.
- **Simplifications panel** (right of the page): neutrals only — `bg-gray-50` surface, `border-gray-200`, no shadow. Each card cites its source as "Simplified · Page N" so the AI output stays grounded (DESIGN "Trust through grounding").
- **Zoom / Fit:** a small toolbar above the page (zoom − / +, Fit, live %). Fit measures the available column and scales the page to width. No other controls compete with the document.

## 6. Do's and Don'ts

### Do:
- **Do** keep the chrome neutral (grays + hairlines) and let the single reading-blue accent mark every action and semantic link.
- **Do** tie every AI surface — chat answer, definition, anomaly — back to its source page; grounding is the trust mechanism.
- **Do** honor `prefers-reduced-motion`: the only motion is the 150ms hover-card fade.
- **Do** use Raised Gray / Instrument Gray / Hairline borders for separation instead of shadows.
- **Do** keep section labels small, uppercase, and Ink Label gray.

### Don't:
- **Don't** build a chat-first AI product wrapper — no glowing gradients, no chrome competing with the document (PRODUCT.md anti-reference).
- **Don't** build a cloud-SaaS dashboard with hero metrics; this is a reading instrument, not a marketing surface (PRODUCT.md anti-reference).
- **Don't** make it a playful consumer app — the personality is professional-tool, closer to a code editor or legal reader (PRODUCT.md anti-reference).
- **Don't** introduce a second decorative accent color; amber and violet are signal threads for exactly one target each.
- **Don't** add box-shadows to any surface; flat tonal layering is the rule.
- **Don't** let reading-blue exceed ~10% of any screen; if it does, the accent has lost its meaning.
