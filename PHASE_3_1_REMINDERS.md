# Phase 3.1 Reminders

## Invalid Transportation Cards

Current Phase 3.1 direction:

* If a transportation card becomes invalid because its `from_item_id` / `to_item_id` pair is no longer adjacent after visit cards are sorted by `start_time`, keep the database row.
* Invalid transportation cards should not disappear and should not be forced into an incorrect gap.
* Render invalid transportation cards at the top of that Day, below the date header and above the first normal visit card.
* Use the shared lightweight warning style: collapsed cards show `⚠ 交通資訊需確認`; expanded cards show the invalid pair reason plus edit/delete actions.
* Do not add drag repositioning until Phase 3.4.

## General Transportation Warnings

Phase 3.1 also supports general warnings for valid pairs:

* If a valid transportation card's `from_item_id` / `to_item_id` pair is still adjacent, but either related visit card has a newer `updated_at` than the transportation card, show a lightweight warning on that transportation card.
* Collapsed general warning cards only show the small `⚠` icon.
* Expanded general warning cards show the reason plus confirm/edit/delete actions.
* Confirming a general warning only touches the transportation card timestamp; it does not change the pair or move the card.
