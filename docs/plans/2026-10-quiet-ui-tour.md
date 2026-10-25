# Slice: quieter pages and a first-visit tour

**Status:** done
**Decision link:** 2026-10-25 rows in `docs/DECISIONS.md` (quieter pages, tour)

## Why
Owner: "có mấy cái không nhất thiết lúc nào cũng phải show… người mới thì người ta cần biết, làm 1 cái tour guide là được rồi, còn dùng lâu thì để giao diện cho nó tinh gọn, tránh mất tập trung." The owner approved the audit list item by item ("đồng ý, làm đi").

## Scope
- In: how-to lines leave the pages: they move to the tour, to an (i) beside a heading, or get shorter. The planner's own prompts and real figures stay. Each of Month, Week, Day, Reflect and Focus has a 3-step tour on first visit. Skip ends the tour on every page, and Settings → Notebook → Tour shows it again.
- In (follow-up, owner: "làm animation mượt xíu… lúc chuyển trang… cho cảm thấy là có qua trang, không cần làm kiểu lật tờ giấy"): the tour eases between steps and fades in and out.
- Out: Settings explanations and data or backup messages stay as they are, because the data screens must stay visible and plain. No tour for Settings or the lock screen.

## Data impact
None. Seen tours live in this browser's/app's `localStorage['duckbook:tour']` (like the Paper setting). Page shapes and `API_LEVEL` are unchanged.

## Done when
- [x] Each page's tour shows once, keys step it without flipping the page, and Skip ends all tours (`test:browser`)
- [x] Existing pages and data unaffected
- [x] `npm run typecheck` and `npm run build` pass
- [x] Checked in a browser (screenshots of every tour step on a synthetic notebook)

## Notes
- Page-turn motion was tried and dropped: sideways slides (including a View Transitions version that held up clicks), then a light blur-fade. The owner found them jerky ("thấy giật quá bỏ animation chuyển trang đi"). Pages now change instantly.
