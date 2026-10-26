// An independent, durable copy of query bodies. Reads use only local memory;
// the caller owns fallback, fills and the authoritative directory mutation.

/** A single atomic snapshot, including the fence that survives a restart. */
export type ServingCopyState = {
  revision: number
  blocked: boolean
  answers: [string, string][]
}

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
  #answers: Map<string, string>
  #maxAnswers: number

  constructor(private readonly options: ServingCopyOptions) {
    this.#maxAnswers = options.maxAnswers ?? 1000
    if (
      !Number.isInteger(this.#maxAnswers) || this.#maxAnswers < 1 ||
      this.#maxAnswers > 1000
    ) {
      throw new RangeError('maxAnswers must be an integer between 1 and 1000')
    }
    let state = options.persistence.read()
    this.#revision = state?.revision ?? 0
    this.#blocked = state?.blocked ?? false
    this.#answers = new Map(this.#blocked ? [] : state?.answers)
    this.#trim(this.#answers)
  }

  /** Capture before a fill; bootstrap fills use revision zero. */
  get revision(): number {
    return this.#revision
  }

  /**
   * Persist the fence before the directory commits a mutation with this revision.
   * A persistence failure must abort that mutation; this instance stays blocked.
   */
  begin(): number {
    if (!Number.isSafeInteger(this.#revision + 1)) {
      throw new RangeError('Serving copy revision exhausted')
    }
    this.#revision++
    this.#blocked = true
    this.#answers.clear()
    this.#persist(this.#revision, true, this.#answers)
    return this.#revision
  }

  /** Only the latest mutation may unblock; bodies are filled separately. */
  finish(revision: number): boolean {
    if (revision !== this.#revision) return false
    if (!this.#blocked) return true
    this.#persist(revision, false, this.#answers)
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
    if (revision !== this.#revision) return false
    // An open copy at another revision than the directory's committed one
    // serves nothing a read can confirm: it moves to the committed revision.
    if (!this.#blocked) {
      if (committed === revision) return true
      this.#answers = new Map()
      this.#persist(committed, false, this.#answers)
      this.#revision = committed
      return true
    }
    if (committed >= revision) return this.finish(revision)
    this.#persist(committed, false, this.#answers)
    this.#revision = committed
    this.#blocked = false
    return true
  }

  /**
   * Accept only a current, unblocked fill. Replacement refreshes insertion order;
   * eviction removes the oldest fill, never registers a cold key.
   */
  put(revision: number, key: string, body: string): boolean {
    if (this.#blocked || revision !== this.#revision) return false
    if (this.#answers.get(key) === body) return true
    let answers = new Map(this.#answers)
    answers.delete(key)
    // Directory answers can be listings. Bound UTF-16 code units as well as
    // keys (at most 2 MiB UTF-8 total); oversized listings stay directory-only.
    if (key.length + body.length > 64 * 1024) return false
    answers.set(key, body)
    this.#trim(answers)
    this.#persist(revision, false, answers)
    this.#answers = answers
    return true
  }

  /** No persistence, fallback, registration, timers or recomputation on reads. */
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

  #trim(answers: Map<string, string>): void {
    let bytes = () =>
      [...answers].reduce((n, [k, b]) => n + k.length + b.length, 0)
    while (answers.size > this.#maxAnswers || bytes() > 512 * 1024) {
      answers.delete(answers.keys().next().value!)
    }
  }

  #persist(
    revision: number,
    blocked: boolean,
    answers: Map<string, string>,
  ): void {
    // Fresh tuples keep storage and in-memory ownership separate without a clone.
    this.options.persistence.write({ revision, blocked, answers: [...answers] })
  }
}
