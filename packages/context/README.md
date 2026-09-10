# @yaks/context

Explicit instruction snapshots for graph transcripts. This package constructs
prompt entries and hashes source text; the caller decides which sources to admit
and persists the entries.

## Storage and limitations

The package returns bundles; it does not persist them. Compose session
vocabulary for `entry` and `content`, and optionally `@yaks/blob` for
content-addressed storage of text. The host decides when to load files and admit
their snapshots.

The file loader records disk provenance. It does not resolve graph references
from generated file headers. `revision` hashes one text snapshot, not an entire
provider request, and does not imply provider cache validity.

The host loader is POSIX-oriented. The core has no filesystem dependency.
Snapshot immutability is an admission convention, not a graph write guard:
callers with graph write access can still edit historical entries.

## Construct an entry

```ts
import { promptEntry, snapshot } from '@yaks/context'

const source = await snapshot('Answer in English.', 'application:instructions')
const entry = promptEntry(
  'session-1',
  1,
  source.body,
  source.source,
  'shared',
  source.revision,
)
// Persist entry using your graph. The session must exist, and seq must be allocated
// by the caller to preserve transcript order.
```

## Large tool results

`outputView(graph, resultEntry, limit = 16384)` produces a model-facing view of
a stored tool result. Results within the limit are unchanged. Larger results get
a short notice with a 512-code-point preview, size, snapshot entity address, and
inspection instructions. The limit counts Unicode code points, not tokens or
UTF-8 bytes. User messages and admitted instructions are not shortened.

The full original entry remains available to the UI. A `context_output` row
stores a revisioned copy, using the existing blob-backed body property.
Identical text is deduplicated by `@yaks/blob`; editing the original entry does
not alter the copy. Its source is the original entry EID. These rows are data,
not instructions or transcript entries, and do not wake sessions. A fork uses
the same snapshot address for inherited results. The session package accepts an
optional `resultText` projection callback; it does not depend on the context
package.

The harness enables this projection when its standard value-inspection tools are
available. `agent({ outputLimit })` configures the per-result limit (integer at
least 512). Custom tool sets without `graph_value_read` retain the previous
unbounded behavior. There is no aggregate request budget yet: many individually
small results can still produce a large request. Previously sent provider
context is not retroactively removed. Snapshot generation hashes and reads the
full text; it bounds model input, not storage I/O or memory use. Changing policy
changes future model-facing projections, not stored transcript history.

Snapshots are regular graph data with the same access policy as other entities.
They are not a security boundary against callers with graph write access.
Passing the advertised revision to an inspection tool detects a modified value
rather than silently reading its replacement. Automatic snapshot garbage
collection is not implemented.
