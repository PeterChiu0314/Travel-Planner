# B-7 Staging Legacy Upload cutover

Scope: `uyqdopksfysbobhjcepk` only. Continuous Staging closeout authority includes this minimal Forward and conditional Activation. No Production/main/Vercel authority. Old migrations, financial history, existing storage policies and role grants remain unchanged.

## Installed artifact and verified behavior

Official CLI 2.106.0 issued `20261101032853_budget_receipt_legacy_cutover.sql`. Source SHA-256 `b5032314b31678ae6ae922f6aa648e7a7108e5ce77bd09a7a9b5aef7d3ed85b6`; atomic `deployment.sql` SHA-256 `8e98cc69539afe0c0a0887a66c3c7f4d4af4e3f28f59500d4aab8adba55ac393`. The packet installed successfully on Staging, ledger64→65; never replay the Dormant chain. A new read-only transaction verified all three changed bodies and their original OID/owner/ACL/security/search_path, five new owner-only helpers, RLS/private journal, unchanged38 business seals, original28 projections and existing Worker/Storage/Realtime permissions.

The source remains outside automatic migration discovery. `baseline-functions.json` contains only the three actual before-definitions, no row data, tokens or catalog identities. `prepare-b7-legacy-cutover.mjs` reconstructs deterministic artifacts offline and refuses an unknown before-body; rebuilding does not deploy. The static manifest describes artifacts; live installation evidence is separate.

The Forward changes only:

- Receipt path protection also applies during the audited pre-Activation freeze, covering canonical Actual paths and existing attachment aliases.
- Actual Receipt metadata INSERT/UPDATE/DELETE pauses while frozen and not yet activated, preventing arbitrary old uploads from being aliased into a Receipt after cutoff. Unrelated attachment workspaces retain existing policies. A trip containing a protected Receipt can consequently be retained during cutover; never force cleanup.
- Receipt Activation requires an owner-only append-only stop/invalidation journal instead of an invented natural-expiry timestamp. Storage/content/cleanup readiness and the private10MiB bucket checks remain required.

The journal is not published. RLS has no policies intentionally, all table/helper access is revoked from PUBLIC, anon, authenticated, service_role and Worker. Owner-only invoker operations record server `clock_timestamp()`; repeated identical requests replay, mismatched requests reject. No flags, readiness or stop proof are set by installation. Native PostgreSQL19/19 includes rollback, source collisions, NULL ledger statements, original attributes, helper drift, real second-session lock exclusion, Receipt metadata/path freeze, fake-expiry refusal and Activation/Pause latch preservation. These are SQL tests, not Storage HTTP evidence.

## Issuance inventory and actual cutoff

Observed real Staging entry points:

| Entry | Authorization / lifetime | Cutover control |
| --- | --- | --- |
| `POST /object/upload/sign` | User RLS at issuance; observed signed JWT TTL7200s | Frozen Receipt path RLS denies new issuance |
| `PUT /object/upload/sign` | Previously signed upload capability; consumes with elevated Storage context | Revoke every previously accepted Storage URL key, then test an unexpired held token |
| `/upload/resumable/sign` | Previously signed upload token; real lease201 | Old token rejected on subsequent PATCH after URL-key revocation |
| `/upload/resumable` | Caller JWT plus current write RLS; real lease201, documented lease lifetime up to24h | Existing lease PATCH denied403 after freeze; no guessed24h wait |
| S3 user/session presign | Existing legacy anon public key + real user JWT, current RLS; QA presign900s | Existing unused-object presign denied403 after freeze, before its expiry |
| S3 server access keys | Bypass RLS | Dashboard showed none; do not create one for QA |
| Privileged custom signers | service_role is trusted and bypasses RLS | Dashboard showed no Edge Functions; user explicitly confirmed other privileged signing programs stopped |

Repository search found no product signed-upload/TUS/S3 signer. This inventory does not claim an admin key loses its inherent privileges; external trusted signers must stay quiescent throughout cutover. Expiration of Auth JWTs, zero queues, delayed logs or zero S3 keys alone do not prove signed-upload exhaustion.

Stop was recorded at **2026-11-01T03:57:00.574743Z** (Taipei11:57:00.574743), not backdated. New signed-upload denied400/Unauthorized, old authenticated TUS PATCH403, old unused S3 session presign403. Held signed-upload/Signed TUS tokens were issued before stop and remained unexpired at revocation verification.

The operator personally rotated the dedicated **Storage URL** key, then revoked old key `193032dd-d5f5-4c38-b09e-f577463c7ed2`. Merely rotating initially left it Standby and still trusted; independent UI readback caught this and no exhaustion was claimed. Final UI readback: Active `9933eb99-6811-4887-abf2-92746c65ca31` (ES256), no Standby, old key Revoked. Auth signing credentials were not rotated. Key IDs are public identifiers, not secrets.

Real held upload returned400/InvalidJWT; signed TUS returned400/plain text `signature verification failed`, while both tokens remained within expiry. The first Runner expected JSON and recorded a failed classification; a bounded zero-byte PATCH produced the identical response-body SHA and identified the format. Historical failure is retained; strict parsing now rejects generic400, permission/offset errors and expired samples. No successful write or timeout relaxation was used to obtain a pass. A download token could not be used for upload400/InvalidSignature. A newly signed Receipt download used the new key and returned the same68bytes/SHA-256.

Owner attestation committed at **2026-11-01T04:07:15.727009Z**, binding exact stop time, all retired/accepted kids, ten checks, HTTP evidence digest and separately checked empty pending/multipart state. `legacy_grants_expire_at` stays **NULL**: cryptographic invalidation is not natural expiry.

## Operator sequence and stop conditions

1. Fresh project-bound read-only catalog, all original fingerprints, old38 seals, the three before bodies, ledger/head, zero live leases and unknown transactions. Verify source and wrapper byte hashes. Capture accepted URL key list, S3 server keys and privileged signer inventory.
2. Install complete atomic packet once. Keep BEGIN/COMMIT/locks/timeouts, `ON_ERROR_STOP=1` for psql, no `psql -1`, no segmented commits. SQL Editor handled this53KB atomic packet; the prior1.49MB Dormant packet is a separate historical limitation. If COMMIT is unknown, independent readback before any retry.
3. New read-only connection/transaction verifies ledger65/full Source, original attributes/data/RLS/ACL and new private objects. Stage source is not an ordinary automatic migration.
4. Prepare isolated ordinary-JWT controls and held pre-stop grants in RAM; normal QA Actual Receipt association makes preservation/read testing legitimate. Do not use original data or a baseline for a mutation target. Record SHA-only capability evidence; no URLs, JWTs or credentials on disk/Git.
5. Call owner-only `stop_budget_receipt_legacy_issuance(request, accepted_kids, proof_sha)` with explicit Staging target. Journal server timestamp is the actual authenticated issuance stop. Prove new signer denial, existing authenticated TUS/S3 denial. Freeze cannot cancel an already signed upload by itself.
6. Hand credential changes to the user: create a Standby URL key, Rotate it Active, Revoke **all** previously accepted keys; never confuse Auth JWT keys with Storage URL keys. Rotation alone accepts both keys. Do not permanently delete keys. Independently read final UI state and prove old unexpired upload/TUS rejection plus fresh Receipt read/SHA preservation.
7. `attest_budget_receipt_legacy_invalidation(request, proof, evidence_sha)` checks exact stop/request/kids/ten proof fields and independently refuses pending Receipt work or S3 multipart records. Evidence must come from actual HTTP and the user's privileged-signer quiescence, never fixture booleans.
8. Bind the real platform acceptance report, this cutover proof and current security/readback to `app.budget_b7_http_evidence`. Set the three readiness fields only from the already-passed true service evidence. Use updated [Activation SQL](../budget-b7-activate.sql); no natural-expiry fiction. Read back independently, then opt in five flags only on the Staging localhost Vite process, keeping repository defaults OFF.
9. Full business Receipt, Incomplete and independent browser E2E follow Activation. Any productP0/P1: stop new work, run [safe Pause](../budget-b7-pause.sql), read back. Preserve irreversible activated latches, committed requests, baseline, receipts and audit. Do not revert the migration, clear journal, restore whole-form saves, or force delete QA graphs.

**Never restore a revoked old URL key while B-7 is active or paused.** That can revalidate old elevated upload capabilities despite current RLS; Pause does not revoke such signatures. Any need for key rollback is a separate security recovery plan with platform-level upload isolation and new evidence, not a routine reversal. Keep trusted signers stopped until receipt-path fencing is verified after Activation. Unknown key/Source drift, failed negative proof, byte loss, unknown ACK or nonempty unscoped work stops progression.

Raw standard/multipart over-limit transport responses remain Blocked from the previous report, not relabeled Passed. Actual TUS413 and the unchanged global10MiB bucket constraint supply the size-cap evidence for this Staging trial. Prior real Auth/Storage/Worker tests are reused, not rerun; native fixtures do not substitute for true service tests.

## Official references

- [Storage URL signing key lifecycle/revocation](https://supabase.com/docs/guides/storage/serving/downloads#revoke-signed-urls): Auth rotation does not revoke Storage URLs; Standby remains trusted; Revoke removes trust. CDN download caching is distinct from the upload-authorization test.
- [Resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads): ordinary TUS lease lifecycle; actual write authorization still needs testing.
- [S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication): server access keys bypass RLS; user JWT session credentials respect it; publishable key is not a legacy anon S3 secret substitute. AWS SDK used only in ignored QA tooling, no new product dependency.
- [Signed upload consumer](https://github.com/supabase/storage/blob/master/src/http/routes/object/uploadSignedObject.ts), [TUS lifecycle](https://github.com/supabase/storage/blob/master/src/http/routes/tus/lifecycle.ts): upstream explains the elevated consumer and plain-text TUS rendering. Master source is not proof of Hosted version; actual Staging HTTP evidence establishes the observed behavior.

Production remains NO-GO pending complete real E2E and a separately authorized target-bound package. This Forward's operator helpers deliberately fence to Staging; do not transplant its GUC target into Production or blindly `db push --include-all`.
