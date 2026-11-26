// An independent copy of query bodies, held in memory. The caller owns
// fallback, fills and the authoritative directory mutation.
//
// A fence holds in memory. `begin` raises it before it answers, and the
// directory commits only after that answer, so every read the copy answers
// once the write commits sees the fence. Saving the fence would hold
// `begin`'s answer until the save is durable (Durable Objects' output gate,
// about 60 ms), so only a ceiling is saved: no fence above it was ever
// granted, and it is raised LEASE fences at a time.
// A restarted copy has lost which fences it granted and every body, so it
// stands fenced at its ceiling and serves again only once the directory
// settles it, holding no fence (directory-copy.ts `mend`), or a committed
// read at the ceiling finishes it.

/** What survives a restart: no fence above `ceiling` was ever granted. */
export type ServingCopyState = { ceiling: number }

/** How many fences one saved ceiling grants. */
export let LEASE = 1000

/** Synchronous, atomic snapshot storage, owned by one ServingCopy instance. */
export type ServingCopyPersistence = {
  read(): ServingCopyState | undefined
  write(state: ServingCopyState): void
}

export type ServingCopyOptions = {
  persistence: ServingCopyPersistence
  /** Insertion-order bound, at most 1000. Defaults to 1000. */
  maxAnswers?: number
}

/**
 * The revision a copy the directory fences no longer stands at, once it fences
 * another one (directory-copy.ts `handover`): `begin(RETIRED - 1)` blocks it
 * there, as the copy on any code begins, and no write commits under it, no
 * finish or settle lowers it and no fill matches it. A Worker still reading
 * it is answered by the directory alone.
 */
export let RETIRED = Number.MAX_SAFE_INTEGER

/** A cold or fenced copy cannot supply an answer. */
export class ServingCopyUnavailable extends Error {
  readonly status = 503
  constructor() {
    super('Serving copy unavailable')
    this.name = 'ServingCopyUnavailable'
  }
}

export class ServingCopy {
  #revision: number
  #blocked: boolean
  #ceiling: number
  #answers = new Map<string, string>()
  #maxAnswers: number

  constructor(private readonly options: ServingCopyOptions) {
    this.#maxAnswers = options.maxAnswers ?? 1000
    if (
      !Number.isInteger(this.#maxAnswers) || this.#maxAnswers < 1 ||
      this.#maxAnswers > 1000
    ) {
      throw new RangeError('maxAnswers must be an integer between 1 and 1000')
    }
    this.#ceiling = options.persistence.read()?.ceiling ?? 0
    this.#revision = this.#ceiling
    // A copy that never granted a fence has none to lose.
    this.#blocked = this.#ceiling > 0
  }

  /** Capture before a fill; bootstrap fills use revision zero. */
  get revision(): number {
    return this.#revision
  }

  /**
   * Raise the fence before the directory commits a mutation with this
   * revision. A fence above the saved ceiling saves a new one first; a failure
   * to save must abort that mutation, and this instance stays blocked. The
   * fence is newer than what the directory says it has committed too, so a
   * copy left behind it still grants a fence the commit accepts.
   */
  begin(committed = 0): number {
    let revision = Math.max(this.#revision, committed) + 1
    if (!Number.isSafeInteger(revision)) {
      throw new RangeError('Serving copy revision exhausted')
    }
    this.#revision = revision
    this.#blocked = true
    this.#answers.clear()
    if (revision > this.#ceiling) {
      let ceiling = Math.min(revision + LEASE, RETIRED)
      this.options.persistence.write({ ceiling })
      this.#ceiling = ceiling
    }
    return this.#revision
  }

  /** Only the latest mutation may unblock; bodies are filled separately. */
  finish(revision: number): boolean {
    if (revision !== this.#revision || this.#retired) return false
    this.#blocked = false
    return true
  }

  /**
   * A mutation that raised this fence has ended and the directory says which
   * revision it holds committed. The mutation's own revision committed (its
   * finish was lost): finish it. Otherwise it rolled back and changed
   * nothing, so the committed revision still stands: serve at it again. A
   * newer fence is never touched, and nothing here is a lease: bodies were
   * cleared by begin and refill from the directory.
   */
  settle(revision: number, committed: number): boolean {
    if (revision !== this.#revision || this.#retired) return false
    // An open copy at another revision than the directory's committed one
    // serves nothing a read can confirm: it moves to the committed revision.
    if (!this.#blocked) {
      if (committed === revision) return true
      this.#answers = new Map()
      this.#revision = committed
      return true
    }
    if (committed >= revision) return this.finish(revision)
    this.#revision = committed
    this.#blocked = false
    return true
  }

  // A copy begun at the last revision is retired (`RETIRED`).
  get #retired(): boolean {
    return this.#revision == RETIRED
  }

  /**
   * Accept only a current, unblocked fill. Replacement refreshes insertion order;
   * eviction removes the oldest fill, never registers a cold key.
   */
  put(revision: number, key: string, body: string): boolean {
    if (this.#blocked || revision !== this.#revision) return false
    if (this.#answers.get(key) === body) return true
    // Directory answers can be listings. Bound UTF-16 code units as well as
    // keys (at most 2 MiB UTF-8 total); oversized listings stay directory-only.
    if (key.length + body.length > 64 * 1024) return false
    this.#answers.delete(key)
    this.#answers.set(key, body)
    this.#trim(this.#answers)
    return true
  }

  /** No fallback, registration, timers or recomputation on reads. */
  get(key: string): string {
    if (this.#blocked) throw new ServingCopyUnavailable()
    let body = this.#answers.get(key)
    if (body === undefined) throw new ServingCopyUnavailable()
    return body
  }

  /** Serving authority, checked even for a warm directory response. */
  valid(revision: number): boolean {
    return !this.#blocked && revision === this.#revision
  }

  read(key: string): { revision: number; body: string } {
    return { revision: this.#revision, body: this.get(key) }
  }

  /** Only a read of the committed matching directory epoch can recover a
   * lost finish. A precommit or delayed response has an older epoch. */
  publish(revision: number, key: string, body: string): boolean {
    if (revision !== this.#revision) return false
    this.finish(revision)
    return this.put(revision, key, body)
  }

  /** Many answers, each said as {@link publish} says it. */
  publishes(answers: [number, string, string][]): boolean[] {
    return answers.map(([revision, key, body]) =>
      this.publish(revision, key, body)
    )
  }

  #trim(answers: Map<string, string>): void {
    let bytes = () =>
      [...answers].reduce((n, [k, b]) => n + k.length + b.length, 0)
    while (answers.size > this.#maxAnswers || bytes() > 512 * 1024) {
      answers.delete(answers.keys().next().value!)
    }
  }
}
