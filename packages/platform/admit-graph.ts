// The schemas and numeric bounds an app's words opt into, checked on each
// whole proposed row (@yaks/graph/schema). Last, so no write hook rewrites a
// checked value.
import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { admitSchema } from '@yaks/graph/schema'

export let plugins = (host: { vocab: Vocab }): Plugin[] => [
  admitSchema(host.vocab),
]
