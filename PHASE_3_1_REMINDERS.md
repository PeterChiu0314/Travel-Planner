# Phase 3.1 Reminders

## Invalid Transportation Cards

Current user preference:

* If a transportation card becomes invalid because its `from_item_id` / `to_item_id` pair is no longer adjacent after visit cards are sorted by `start_time`, delete that invalid transportation card directly.
* Phase 3.0 currently hides non-adjacent transportation cards and keeps the database row.
* Revisit this before implementing Phase 3.1 transportation warnings, cleanup, or review states.
