# Design QA — Timeline transportation and note controls

- Source visual truth:
  - `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-d3b70293-2875-436e-8b3c-3221b2c1157c.png`
  - `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-08cc3f31-68a6-43cc-a100-3d1bc776cacb.png`
  - `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-c53c1a21-5686-4bfb-9e00-32587e18be92.png`
- Implementation screenshots:
  - `docs/qa/2026-07-21-visit-note-chrome.png`
  - `docs/qa/2026-07-21-transport-editor-chrome.png`
- Browser: user-selected Chrome extension surface.
- Viewport/state: responsive Timeline Day 1; existing visit editor with overflowing multiline note; existing transportation editor; existing expanded transportation warning card.

## Full-view comparison evidence

The source screenshots are focused defect captures rather than full-page target comps, so the Chrome captures include more surrounding desktop canvas. The compared editor regions show that note text remains inside its floating-label frame, the transportation name field is 36 px high, and the 36 px navigation control is bottom-aligned with transportation duration. No surrounding layout or typography was intentionally redesigned.

## Focused-region comparison evidence

- Visit note: Chrome verified the two-line 62 px starting frame, contained scrolling, and visible floating label. The later shared auto-growth behavior through five lines and `8px 8px 8px 12px` padding are covered by focused component tests.
- Transportation editor: Chrome measured a 36 px name field, a 36 × 36 px navigation control, and zero bottom-alignment delta against duration.
- Transportation category: Chrome observed the listbox open, then observed zero listboxes and `aria-expanded="false"` after clicking transportation name.
- Expanded transportation note: Chrome measured a 4 px scrollbar, no WebKit scrollbar buttons, a non-transparent rounded thumb, and `overflow: auto`.
- Chrome console: no error entries during verification.

## Required fidelity surfaces

- Fonts and typography: unchanged existing application font, weights, line heights, and floating-label typography.
- Spacing and layout rhythm: requested 36 px control sizing and 4 px note text inset verified; editor/card structure unchanged.
- Colors and visual tokens: existing border, surface, muted text, primary, and scrollbar tokens reused.
- Image quality and asset fidelity: no raster or custom image assets are part of these controls; existing Lucide icons remain unchanged.
- Copy and content: existing Chinese labels and demo content preserved.

## Comparison history

1. P1: Visit note textarea and scrollbar painted below the floating-label frame. Fixed by constraining textarea height/max-height to the parent and internal scrolling.
2. P2: Initial overflow clipping also clipped the floating label. Fixed by leaving the outer frame overflow visible while keeping the textarea constrained; Chrome confirmed the label sits above the border and remains visible.
3. P2: Transportation navigation control appeared taller than the field. Fixed at 36 × 36 px with bottom alignment.
4. P2: Expanded transportation note used native scrollbar arrows. Fixed by reusing the time-menu scrollbar styling.
5. P2: Transportation category could remain open after outside interaction. Fixed with captured document pointer handling plus focus-leave handling; Chrome confirmed closure.

## Findings

No remaining P0, P1, or P2 mismatch was found in the requested regions.

## Implementation checklist

- [x] Constrain visit note content to its field.
- [x] Preserve the complete floating label.
- [x] Match note left padding to adjusted controls.
- [x] Set transportation name and navigation sizes to 36 px.
- [x] Close transportation category on outside click/focus leave.
- [x] Apply thin scrollbar styling to expanded transportation notes.
- [x] Verify interactions and console in Chrome.

## Follow-up polish

No P3 follow-up identified for this scope.

final result: passed
