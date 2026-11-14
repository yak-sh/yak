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

/** A write whose body went async inside a transaction that commits when the
 * body returns (`Driver.tx`, a Durable Object's `transactionSync`): what it
 * did before its first `await` committed then, and the rest ran outside any
 * transaction, so a later throw rolled none of it back. One wording, so it is
 * one bug wherever it happens. Its stack is the write's, deep enough to pass
 * the driver's wrappers and reach the code that asked for the write. */
export let halfway = (): Error => {
  let errors = Error as ErrorConstructor & { stackTraceLimit?: number }
  let limit = errors.stackTraceLimit
  errors.stackTraceLimit = 50
  try {
    return Object.assign(
      new Error(
        'a write went async inside a transaction that commits when its body ' +
          'returns: what it did after its first await is outside the ' +
          'transaction',
      ),
      { name: 'Halfway' },
    )
  } finally {
    errors.stackTraceLimit = limit
  }
}
