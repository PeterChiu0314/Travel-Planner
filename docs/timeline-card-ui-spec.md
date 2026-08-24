# Timeline Card UI Specification

Status: Accepted baseline

Accepted: 2026-07-23

Applies to: visit cards, transportation cards, their editors, expanded details, and itinerary alternatives

Primary implementation: `src/App.jsx`, `src/styles.css`

Primary regression coverage: `tests/phase-1-7f-smoke.spec.js`, `tests/mapProviderPrep.spec.js`

## 1. Purpose and authority

This document is the durable UI and interaction specification for Timeline visit cards, transportation cards, and itinerary alternatives after Phase 5.9.

Use it to:

- preserve the accepted visual hierarchy and interaction behavior;
- decide which styles should be shared and which must remain scoped;
- review future changes for regressions across collapsed, focused, expanded, and editing states;
- keep Formal and Demo visually consistent without mixing their data behavior.

If sources disagree, use this priority:

1. A newer explicit user requirement.
2. Current accepted behavior described in this specification.
3. Automated regression tests.
4. Current implementation.
5. Historical Phase 5.9 handoff documents.

The historical `docs/archive/Timeline_Phase5/2026-07-19-phase-5-9-itinerary-editor-ui-handoff.md` remains useful implementation context, but this specification supersedes its UI values where they differ.

## 2. Scope boundaries

This specification covers:

- visit-card collapsed and expanded presentation;
- transportation-card collapsed and expanded presentation;
- visit add/edit UI;
- transportation add/edit UI;
- alternative creation, editing, deletion, display, and main/alternative switching;
- shared field, note, budget-row, Map-link, responsive, and action treatments;
- existing save, dirty-state, draft, navigation, and Formal/Demo contracts that directly affect these interfaces.

It does not authorize:

- data-table or migration changes;
- transportation lookup APIs;
- Directions, Routes, or travel-time queries;
- automatic transportation creation;
- new transfer-segment data structures;
- changes to itinerary ordering, overlap, fixed-item, edit-lock, Realtime, or permission rules;
- a new animation system for card flipping.

## 3. Shared design language

### 3.1 Visual character

- Keep the interface calm, compact, and travel-oriented.
- Reuse the existing semantic color tokens, borders, radii, typography, and liquid-glass surfaces.
- Avoid heavy panels, solid secondary buttons, redundant frames, and decorative controls.
- Primary Save remains the dominant action. Secondary, navigation, and destructive actions use lighter treatments.

### 3.2 Outlined labels

Two label behaviors intentionally coexist.

Fixed outlined labels use `fieldset` and `legend`:

- the label always occupies the border gap;
- label size is 11 px with weight 400;
- focus changes label and border color without moving the label;
- no hard-coded white label backing is added;
- invalid and disabled states preserve geometry.

Floating outlined labels use `.floating-outlined-field`:

- an empty, unfocused field shows its label inside the control at 14 px / 400;
- focus or non-empty content moves the label into the border gap at 11 px;
- the native placeholder remains visually transparent;
- the label must remain fully visible and must not be clipped by the field or textarea.

Do not globally convert one label behavior into the other. Field-specific behavior is part of the accepted design.

### 3.3 Form surfaces

- Timeline editor inputs, selects, textareas, secondary buttons, point-adjustment controls, and navigation controls remain transparent.
- Save buttons keep the existing primary deep-green treatment.
- Standard compact editor fields use a 36 px visual height unless this specification gives another value.
- Editor input text uses 14 px typography.

### 3.4 Shared note field

Visit and transportation editors share the same note-field behavior:

- label text: `備註`;
- floating outlined label;
- initial field minimum: 62 px;
- initial textarea height: 60 px, approximately two visible lines;
- textarea grows with content through approximately five visible lines;
- maximum textarea height: 118 px;
- additional content scrolls internally;
- textarea padding: `8px 8px 8px 12px`;
- line-height: 1.45;
- resize handle disabled;
- scrollbar uses the Dayboard/time-menu 4 px thumb treatment;
- WebKit scrollbar arrow buttons are hidden;
- empty fields do not reserve excessive editor height.

The note implementation may be shared, but card-specific surrounding layout may remain scoped.

## 4. Card state model

### 4.1 Collapsed, focused, and expanded

- A card starts collapsed.
- The first card click focuses it.
- A second click on the focused card expands it.
- Focusing another card removes the previous card's focused and expanded state as currently implemented.
- Changing Day clears focused and expanded state.
- Edit, delete, lock, navigation, drag, and Map-marker behavior must keep their existing event boundaries.
- Do not change the summary above the card divider when adjusting expanded content below it.

### 4.2 Fixed and permission-limited cards

- Existing fixed-card restrictions remain authoritative.
- Existing owner/editor/viewer permissions remain authoritative.
- UI polish must not create a new mutation path or bypass an existing disabled state.

## 5. Visit card

### 5.1 Collapsed summary

- Preserve the existing sequence number, time range, destination, note preview, type tag, lock/edit/delete controls, and focus/drag behavior.
- The collapsed summary is not redesigned by expanded-content changes.

### 5.2 Expanded details

The expanded region uses `.item-expanded-content` with the existing 30 px horizontal inset.

Content order:

1. complete note and existing detail lines;
2. responsive budget row;
3. alternative summary when an alternative exists;
4. compact Google Map link at the lower left when a Map URL exists;
5. alternative flip control in its reserved lower-right area.

Visit-note presentation:

- 13 px;
- weight 400 for `.item-detail-note`;
- preserve author-entered line breaks with `white-space: pre-line`;
- do not truncate the complete expanded note.

### 5.3 Expanded budget row

Visit and transportation cards share `ExpandedBudgetRow` and the `.linked-budget-list` design.

- label: `預算`;
- icon: existing Lucide `Wallet`, 16 px, stroke width 1.8;
- heading: 14 px / 400;
- thin vertical divider between heading and budget content;
- budget tags: content-width pale-green pills, 12 px / 500;
- top margin: 8 px;
- layout: `display: flex` with `flex-wrap: wrap`;
- heading and divider/tag group remain side by side while space permits;
- the divider and tag group wrap together below only when constrained;
- no full-width information bar when its content does not require one.

Unlinked visit text remains `尚未連動預算`.

### 5.4 Expanded alternative summary

- Do not render this row when no alternative exists.
- The row is informational only; it does not edit or delete the alternative.
- Use the existing Lucide `Files` icon at 16 px.
- Label is `備案` on the main face and `原行程` on the alternative face.
- Label typography is 14 px / 400.
- A thin divider separates the label from `類型 ・ 目的地`.
- Summary typography is 13 px / 400 with a 24 px row height.
- The divider and summary wrap together only when constrained.
- Do not show a chevron, edit action, or delete action in the expanded display row.
- Keep the row out of the lower-right flip-button reserve.

### 5.5 Expanded Google Map link

- Text: `Google Map` with the existing external-link icon.
- Use the small ghost-link treatment: 11 px / 500, 24 px minimum height, `2px 6px` padding, transparent background, and no border.
- Keep it at the expanded region's lower left with a 12 px top margin and `-6px` left optical inset.
- Do not move it into the card summary or action row.

### 5.6 Alternative flip control

- Keep the control fixed in the lower-right corner and preserve its reserved space for a future flip animation.
- Existing alternatives remain switchable through this control.
- Without an alternative, the control is disabled and must not create one.
- Do not restore the former flip-to-create hint.

## 6. Visit add/edit interface

### 6.1 Main field layout

- Type and destination share the compact first row.
- Start, end, and duration share the linked time row.
- Compact controls use the accepted 36 px height.
- Type uses the shared custom menu and chevron treatment.
- Start and end remain segmented 24-hour inputs with separate hour/minute editing.
- Duration keeps the existing manual, wheel, menu, and linked-time behavior.
- The note uses the shared floating note field.

### 6.2 Time controls

- Preserve direct numeric input, whole-time paste, Arrow-key adjustment, wheel adjustment, and left/right segment navigation.
- Preserve the 288-option five-minute menu and current-value scrolling.
- Preserve start/end/duration linkage and fixed-item restrictions.
- Do not introduce browser-native datalists or selects.

### 6.3 More settings and Map controls

The main editor's expanded settings present:

- `更多設定` on the left;
- the compact `Google Map` external link on the right;
- `地圖點位` heading with the existing icon;
- `調整點位` using `MapPinPen`;
- `搜尋替換` using the existing Search icon;
- `Google Maps URL` input;
- divider;
- `備案` heading using `Files`;
- an alternative create or summary control.

Preserve existing point adjustment, Places replacement, URL parsing, preview, and draft-only behavior. Save remains the only itinerary write.

## 7. Transportation card

### 7.1 Collapsed summary

- Title is `交通名稱・自然格式時間` when a name exists.
- When transportation name is blank, display the selected transportation-category label as the title fallback.
- Never write the category label into the transportation-name field or persisted compatibility title.
- Keep the navigation action in its existing summary position.
- Preserve warning, shortage, edit, delete, pairing, and fixed-item behavior.

### 7.2 Expanded details

`.transport-card-details` is transportation-specific and uses:

```css
display: grid;
grid-column: 1 / -1;
grid-template-columns: minmax(0, 1fr);
gap: 4px;
align-items: start;
border-top: 1px solid var(--line);
margin: 0 28px;
padding-top: 10px;
padding-bottom: 8px;
```

Content order:

1. complete transportation note;
2. shared responsive budget row.

Transportation expanded note:

- 13 px muted text;
- preserve line breaks with `white-space: pre-line`;
- maximum display height: 120 px;
- overflow scrolls internally;
- use the shared thin Dayboard/time-menu scrollbar without native arrow buttons.

The budget row follows the visit-card design in section 5.3. Unlinked transportation text remains `尚未連結預算`.

## 8. Transportation add/edit interface

### 8.1 Field order and requirements

1. Transportation category — required.
2. Transportation duration — required.
3. Transportation name — optional.
4. Note — optional.

Category, duration, and navigation share the first editor row. Name and note follow as full-width fields.

### 8.2 Category

- Reuse the visit Type custom-menu structure, menu surface, selected state, scrollbar, and Lucide chevron.
- Do not use a native `<select>`.
- Close the menu on captured outside pointer interaction and when focus leaves the field.
- Keep required validation.

### 8.3 Duration

- Store and submit total integer minutes.
- Display natural labels such as `9 分鐘`, `1 小時`, and `1 小時 12 分鐘` when not actively typing.
- Focused numeric entry accepts any positive integer minute value.
- Do not snap typed values to five-minute intervals.
- Arrow Up and wheel up add five minutes to the exact current value.
- Arrow Down and wheel down subtract five minutes from the exact current value.
- Do not provide a duration dropdown.
- The next-itinerary suggestion continues to round upward to the next five-minute boundary without writing the rounded result back to transportation duration.

### 8.4 Name

- Floating label and placeholder text: `交通名稱`.
- Field height: 36 px.
- Optional; blank values save successfully.
- Input content uses a transportation-name-specific 12 px left inset.
- The 12 px inset aligns the value with the floated label and neighboring content.
- Keep this override scoped to `.transport-editor-name-field input`; do not change shared `.item-form input`, visit fields, duration fields, or note fields to achieve this alignment.

### 8.5 Note

- Floating label and placeholder text: `備註`.
- Follow the shared note specification in section 3.4.

### 8.6 Navigation

- Keep the existing Google Maps directions behavior and URL construction.
- Keep the control immediately to the right of duration.
- Size: 36 × 36 px.
- Align to the bottom of the adjacent outlined fields.
- Do not move it to the title row.

### 8.7 Editor height and actions

- Do not reserve an artificial minimum editor height.
- Save and Cancel remain right-aligned.
- Preserve existing button hierarchy, permissions, conflicts, draft protection, and close behavior.

## 9. Alternative interface

### 9.1 Main-editor alternative entry

No alternative:

- render one full-width 28 px summary control containing `＋ 建立備案`;
- use the same border, radius, text size, padding, hover, and right-chevron treatment as an existing summary.

Existing or staged alternative:

- render `類型 ・ 目的地名稱` with a right chevron;
- the entire 28 px summary is clickable;
- do not render a delete button beside it.

### 9.2 Alternative editor header

- New state: `新增備案`.
- Existing state: `編輯備案`.
- Right-side context: `原行程：{主行程目的地}`.
- Origin text uses the existing 11 px / 400 secondary-label treatment and truncates safely.

### 9.3 Alternative editor fields

- Type.
- Alternative destination.
- Note.
- Static `地圖點位` heading.
- `調整點位`.
- `搜尋替換`.
- `Google Maps URL`.
- Compact `Google Map` external link.

Do not render start, end, or duration fields.

### 9.4 Map section

- Keep the alternative Map-point controls permanently expanded.
- Do not render the former disclosure/toggle row.
- The static `地圖點位` heading occupies that row.
- Keep the Google Map external link in its existing right-side position.
- Reuse existing point adjustment, Places replacement, URL parsing, and preview behavior.

### 9.5 Bottom actions

- `返回主行程` is always present at the lower right.
- It uses a compact secondary ghost style with ChevronLeft, approximately matching `調整點位` and `搜尋替換`.
- It has a transparent background, reduced horizontal padding, and weight 500.
- `刪除備案` appears at the lower left only when editing an existing alternative.
- Delete uses the existing icon, confirmation flow, and secondary-danger text/border treatment with a transparent background.
- Do not provide an independent Save Alternative action.

### 9.6 Draft and save behavior

- Main itinerary and alternative are one editing flow.
- Switching between them does not trigger the unsaved-change prompt.
- Returning to the main itinerary keeps staged alternative create/edit/delete state.
- Any main or alternative change marks the whole itinerary card dirty.
- The main itinerary Save persists both the main draft and staged alternative mutation.
- Save failure must preserve both drafts and all entered values.
- Leaving the overall editor uses the existing unsaved-change prompt, wording, and behavior.

### 9.7 Main/alternative face switching

- Preserve existing main/alternative display switching.
- Preserve apply/swap behavior and existing data structure.
- Alternative latitude/longitude and Map fields continue to travel with the alternative during save and face swaps.
- Do not change Formal/Demo isolation, permissions, or fixed-card rules.

## 10. Responsive behavior

- Prefer intrinsic sizing and wrapping over fixed full-width information bars.
- Budget and expanded-alternative rows stay on one line while their content fits.
- When constrained, the divider and information group wrap together beneath the heading.
- Do not allow the alternative summary to overlap or consume the flip-control reserve.
- Fields and editor rows must not create horizontal overflow at the accepted narrow Dayboard width.
- Transportation category, duration, and the 36 px navigation control remain aligned at supported widths; use the existing responsive rules rather than moving navigation to another row without explicit approval.
- Text truncation is acceptable for compact summaries; complete expanded notes and editor text must remain accessible.

## 11. CSS ownership and change safety

### 11.1 Intended shared rules

These concepts should remain shared when practical:

- `.outlined-field` and its legend/focus/invalid behavior;
- `.floating-outlined-field` and floating-label behavior;
- visit/transportation note textarea growth and scrollbar rules;
- `ExpandedBudgetRow`, `.linked-budget-list`, and budget heading/content/tag styles;
- compact Map-link and point-action design language;
- shared button and semantic color tokens.

### 11.2 Intended scoped rules

Keep these scoped because their geometry differs:

- `.transport-card-details` spacing and padding;
- `.transport-editor-route-row` three-column layout;
- `.transport-editor-navigation-button` 36 px geometry;
- `.transport-editor-name-field` 36 px height;
- transportation-name-specific 12 px input padding;
- expanded visit-card 30 px content inset and flip-button reserve;
- alternative-editor always-expanded Map section and split bottom actions.

### 11.3 Selector safety

- Before changing a shared form selector, inspect its computed effect on visit, transportation, new-card, existing-card, Formal, and Demo editors.
- Prefer a component-specific selector when a correction applies to one field only.
- Do not solve a local alignment issue by modifying `.timeline .item-form input:not([type="hidden"])` globally.
- Keep the standalone add-editor anchor selectors paired with Timeline selectors when the same component renders in both locations.

## 12. Data and behavior guards

- Only `item_type === "transport"` identifies a transportation card.
- Preserve transportation pair snapshots and route roles.
- Preserve automatic next-itinerary calculation and five-minute ceiling behavior.
- Preserve Google Maps navigation behavior.
- Preserve draft autosave, dirty guards, edit locks, conflict handling, Realtime protection, and permissions.
- Formal owns Supabase, Realtime, locks, and persistence.
- Demo uses mock/local state only and must not connect to Supabase, Auth, Storage, Realtime, edit locks, or draft autosave.
- Share View remains readonly and outside this editor specification.

## 13. Accessibility and interaction requirements

- Inputs retain explicit accessible names matching their visible labels.
- Custom category and time controls retain correct combobox/listbox/option semantics.
- Menus support keyboard operation and visible focus.
- Navigation and Map links remain real links where appropriate.
- Icon-only controls retain accessible names or titles.
- Disabled alternative switching must be programmatically disabled, not only visually muted.
- Focus styling must not obscure border-gap labels.
- Internal scroll areas must remain keyboard and wheel usable.

## 14. Required regression coverage

For changes in this area, select the smallest relevant set and include production build and whitespace validation before publishing.

Visit editor and expanded card:

- fixed/floating label geometry;
- segmented time input and menus;
- note two-to-five-line growth and scrollbar;
- full expanded note at 13 px / 400;
- budget row label, icon, weight, pill, and responsive wrapping;
- alternative expanded summary and flip-button reserve;
- compact Google Map link.

Transportation editor and expanded card:

- category and duration required; name and note optional;
- blank-name save and category-title fallback;
- natural duration labels;
- exact integer typing;
- Arrow and wheel ±5 behavior;
- no duration dropdown;
- category-menu outside close;
- 36 px name and navigation geometry;
- name value and label 12 px alignment;
- note growth and scrollbar;
- expanded note then budget order;
- 4 px detail gap and accepted detail padding;
- wide side-by-side budget row and constrained wrapping;
- navigation URL and placement.

Alternative editor:

- create and existing summary controls;
- no main-summary delete action;
- main/alternative switching without an unsaved prompt;
- staged create/edit/delete retention;
- permanently expanded Map controls;
- no time fields and no independent alternative Save;
- existing-only delete action and confirmation;
- combined main/alternative save;
- failure preserves both drafts;
- disabled empty flip control.

Publishing checks:

```text
npm.cmd run build
git diff --check
```

Run the focused Playwright tests that cover the changed behavior. Use browser verification when a visual alignment, responsive, focus, menu, overflow, or interaction state changes.

## 15. Acceptance record

The following interfaces were user-accepted on 2026-07-23:

- visit-card expanded interface;
- transportation-card expanded interface;
- transportation add/edit interface;
- alternative creation/editing interface;
- final transportation-name floating-label alignment.

The accepted baseline ends at commit `bc76e81 Align transport name input`, plus the documentation-only updates that introduce this specification.
