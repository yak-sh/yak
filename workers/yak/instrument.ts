// A verified writing instrument has one graph identity, independent of the
// credential's outside id. Existing graph identities stay fixed; opaque
// credential ids derive the same eid at every authenticated door.
import type { Actor } from '@yaks/graph/bundle'
import { identityEid, minted } from '@yaks/graph/identity'

export let instrumentEid = (via: string): string =>
  minted(via) ? via : identityEid('yak/instrument', [via])

export let instrumentActor = (actor: Actor | null | undefined): Actor | null =>
  actor
    ? { ...actor, ...actor.via ? { via: instrumentEid(actor.via) } : {} }
    : null
