// A read an isolate's requests share by key (@yaks/fp `sharing`), held by the
// request that starts it.
//
// A read's I/O belongs to the request that began it, and the runtime cancels
// it when that request ends. A promise shared past that point never settles,
// so every later request awaiting it waits, with no I/O of its own, until the
// isolate goes: the page that hung 60 seconds on a release's copy.json (T-363).
// So the request that starts a shared read holds itself open until the read
// settles (defects.ts `background`, the runtime's `waitUntil`), even when it
// answers or its visitor leaves first.
import { type Kept, sharing as shared } from '@yaks/fp'
import { background } from '../defects.ts'

export let sharing = <K, T>(
  kept: Kept<K, T>,
  key: K,
  read: () => Promise<T>,
  limit?: number,
): Promise<T> => shared(kept, key, read, { limit, hold: background })
