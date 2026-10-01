// Lock contention is recoverable only where no transaction has started.

export let busy = (e: unknown): e is Error =>
  e instanceof Error && /database is (locked|busy)/.test(e.message)
