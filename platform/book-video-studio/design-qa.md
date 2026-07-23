# Design QA

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-cd83cee9-1337-4aca-a822-1b53cb811edb.jpg`
- Source pixels: 1280 x 720
- Implementation: `http://127.0.0.1:3000/?demo=1` and `http://127.0.0.1:3000/tasks/demo`
- Intended desktop viewport: 1440 x 900, device scale factor 1
- State: populated demo task list and waiting-for-book-confirmation detail
- Implementation screenshot: unavailable
- Density normalization: not performed because no browser-rendered implementation capture is available

## Full-view comparison evidence

Blocked. The reference screenshot was opened and inspected, but the Codex in-app Browser is unavailable in this task. Product Design policy requires explicit user permission before using a direct Playwright fallback.

## Focused region comparison evidence

Blocked for the same reason. The important regions requiring focused comparison are:

1. URL import and processing-mode strip.
2. Filter density and production-stage tabs.
3. Dense task table header, row rhythm and right-side actions.
4. Detail-page production map.
5. Transcript comparison and book-confirmation panel.

## Static implementation checks

- Production build passed.
- Home demo route returned HTTP 200 and contained the expected page title.
- Detail demo route returned HTTP 200 and contained the expected task title.
- Filter, sort, stage tab, copy-link and demo confirmation interactions are implemented in code.

## Findings

- [P1] Browser-rendered visual evidence is missing.
  - Impact: spacing, table overflow, typography and responsive behavior cannot be accepted from code inspection alone.
  - Fix: capture both routes in a browser at 1440 x 900 and compare against the reference.

- [P2] Exact screenshot fidelity is intentionally adapted to the current workflow.
  - Evidence: the reference is a generic hotspot-to-video table; the implementation replaces its stages and columns with Douyin evidence, book identification and G01-G06 gates.
  - Impact: this is a product-correct deviation, but visual density still needs browser comparison.

## Comparison history

No browser comparison iteration has been completed.

final result: blocked
