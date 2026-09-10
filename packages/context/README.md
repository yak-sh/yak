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
