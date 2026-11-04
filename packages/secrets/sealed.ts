// The bundles that write and forget a secret, exported as
// `@yaks/secrets/sealed`: pure data, so a page can write one without loading
// what reads a value back from the vault or the environment (./reveal.ts).

import type { Bundle, Eid } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'

/** The entity a secret is: its id is derived from its name, so one name is
 * one secret and nobody has to look an id up. */
export let secretEid = (name: string): Eid => identityEid('secret', [name])

/** The bundle that writes a secret: its value, or an `op://` reference. The
 * graph keeps the handle; the vault keeps what it stands for. */
export let sealed = (name: string, value: string): Bundle => ({
  entity: { eid: secretEid(name) },
  secret: { name, value },
})

/** The bundle that forgets one, value and all. */
export let unsealed = (name: string): Bundle => ({
  entity: { eid: secretEid(name) },
  tombstone: {},
})
