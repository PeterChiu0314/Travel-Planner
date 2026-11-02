# Applied Production transaction — NEVER replay

The user-authorized budget-only reset and17-source Dormant installation committed on2026-11-03 (Asia/Taipei). Target `lqvuqamzmchepgxkftcw`; ledger48→65. [Execution report](../../../2026-11-03-budget-b7-production-deployment.md), [manifest](packet-manifest.json).

The local, Git-ignored `applied-packet.sql.gz.base64` retains **all exact executed SQL bytes** in a lossless archive. SQL SHA-256 is `8870b5e4c392c9c74e2671c7932033873587ea112417c2d96348e2122f82573e`. It includes the live Production before-contract and is **not published to GitHub**. The executable SQL and archive remain unchanged locally. The public repository contains the generator, all17 immutable original sources and sanitized hashes/results, not the live raw catalog or packet.

Decode for inspection only; this does not execute SQL:

```js
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const raw=gunzipSync(Buffer.from(fs.readFileSync('docs/operations/budget-b7-production/candidate/applied-packet.sql.gz.base64','utf8'),'base64'));
if(createHash('sha256').update(raw).digest('hex')!=='8870b5e4c392c9c74e2671c7932033873587ea112417c2d96348e2122f82573e')throw Error('Archive drift');
// Inspect raw locally. Never replay its financial reset.
```

The builder and isolated regression remain source-controlled. The original live before-profile/raw catalogs/logs stay private; sanitized seals/counts and artifact hashes are in execution evidence. The decode example requires the private local archive; it does not imply the archive is in a public checkout. Reproduce the installation logic with the native fixture runner `node scripts/qa/run-budget-metadata-parallel.mjs --production-packet`; this always creates a new loopback PostgreSQL cluster and never accepts a Hosted URL. Fixture success is not Production Auth/Storage/Worker acceptance.

Recovery after COMMIT is fail-closed Dormant/Forward Repair. Do not schema-down, replay this reset, forge readiness or reset a future irreversible latch.
