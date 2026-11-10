// Lock contention is recoverable only where no transaction has started.

export let busy = (e: unknown): e is Error =>
  e instanceof Error && /database is (locked|busy)/.test(e.message)

/** A stored entity has no archetype. The writer reports and classifies it
 * before retrying; a reader cannot discover its components instead. */
export class Unpointed extends Error {
  constructor(readonly eids: string[]) {
    super(
      `${eids.length} ${eids.length == 1 ? 'entity has' : 'entities have'} ` +
        `no archetype: ${eids.slice(0, 8).join(', ')}`,
    )
    this.name = 'Unpointed'
  }
}
