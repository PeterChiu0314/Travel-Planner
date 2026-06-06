# Phase 3.1 Reminders

## Invalid Transportation Cards

Current Phase 3.1 direction:

* If a transportation card becomes invalid because its `from_item_id` / `to_item_id` pair is no longer adjacent after visit cards are sorted by `start_time`, keep the database row.
* Invalid transportation cards should not disappear and should not be forced into an incorrect gap.
* Render invalid transportation cards at the top of that Day, below the date header and above the first normal visit card.
* Use the shared lightweight warning style: collapsed cards show `⚠ 交通資訊需確認`; expanded cards show the invalid pair reason plus edit/delete actions.
* Do not add drag repositioning until Phase 3.4.
