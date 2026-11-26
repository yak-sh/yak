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

/** An agent writing for a person, a connector client or the CLI, is an actor
 * of its own (M-31958): one per person and agent name, so a stamp it leaves
 * says which agent and for whom, and never reads as the person's own act. */
export let agentEid = (person: string, name: string): string =>
  identityEid('yak/agent', [person, name])

/** The directory row an agent's stamps name: its name, and who it writes for. */
export let agentRow = (person: string, name: string): {
  entity: { eid: string }
  doc: { title: string }
  acts_for: { person: string }
} => ({
  entity: { eid: agentEid(person, name) },
  doc: { title: name },
  acts_for: { person },
})

/** The name of an agent whose client named nothing, which nobody can say
 * more of: its stamps read "an agent". */
export let UNNAMED = 'agent'

/**
 * What an agent row is called on a stamp: its name, or null where its client
 * named nothing (`UNNAMED`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(agentName(agentRow('p', 'Claude')), 'Claude')
 * assertEquals(agentName(agentRow('p', UNNAMED)), null)
 * assertEquals(agentName({}), null)
 * ```
 */
export let agentName = (row: object): string | null => {
  let title = (row as { doc?: { title?: unknown } }).doc?.title
  return typeof title == 'string' && title && title != UNNAMED ? title : null
}
