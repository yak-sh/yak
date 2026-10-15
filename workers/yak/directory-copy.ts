// A durable, revision-fenced copy of directory query bodies. The owner fences
// before a directory write and publishes all registered queries after commit.

/** A successful directory answer, including an empty (deleted) result body. */
export type DirectoryCopyAnswer = { body: string; at: number }

/** Structured-cloneable snapshot. A null answer registers a still-cold key. */
export type DirectoryCopyState = {
  revision: number
  blocked: boolean
  answers: [string, DirectoryCopyAnswer | null][]
}

/** Synchronous, atomic snapshot storage, owned by one DirectoryCopy instance. */
export type DirectoryCopyPersistence = {
  read(): DirectoryCopyState | undefined
  write(state: DirectoryCopyState): void
}

/** Millisecond clock; after returns a function that cancels the callback. */
export type DirectoryCopyTimer = {
  now(): number
  after(ms: number, callback: () => void): () => void
}

export type DirectoryCopyOptions = {
  persistence: DirectoryCopyPersistence
  timer: DirectoryCopyTimer
  /** Keep background work alive (for example, DurableObjectState.waitUntil). */
  retain(promise: Promise<void>): void
  /** Refresh age in milliseconds. Defaults to one minute. */
  freshForMs?: number
}

/** A fenced or cold copy must fail closed, never answer with a stale body. */
export class DirectoryCopyUnavailable extends Error {
  readonly status = 503
  constructor() {
    super('Directory copy unavailable')
    this.name = 'DirectoryCopyUnavailable'
  }
}

type Fill = { promise: Promise<void>; waiters: Set<() => void> }

export class DirectoryCopy {
  #state: DirectoryCopyState
  #answers: Map<string, DirectoryCopyAnswer | null>
  #fills = new Map<string, Fill>()
  #waiters = new Set<() => void>()
  #generation = 0
  #freshForMs: number

  constructor(private readonly options: DirectoryCopyOptions) {
    this.#freshForMs = options.freshForMs ?? 60_000
    if (!Number.isFinite(this.#freshForMs) || this.#freshForMs < 0) {
      throw new RangeError('freshForMs must be finite and nonnegative')
    }
    this.#state = structuredClone(
      options.persistence.read() ?? {
        revision: 0,
        blocked: false,
        answers: [],
      },
    )
    this.#answers = new Map(this.#state.answers)
  }

  /** Registered query keys, including cold keys, in registration order. */
  keys(): string[] {
    return [...this.#answers.keys()]
  }

  /**
   * Register key and return a fresh body without storage IO. Stale and cold
   * reads share one load and wait at most 25ms. Loads continue after timeout;
   * their failures are handled and retained, leaving any previous body intact.
   */
  async query(key: string, load: () => Promise<string>): Promise<string> {
    if (!this.#answers.has(key)) {
      let answers = new Map(this.#answers).set(key, null)
      this.#save({ ...this.#state, answers: [...answers] })
    }
    this.#check()
    let answer = this.#answers.get(key)
    if (answer && this.options.timer.now() - answer.at < this.#freshForMs) {
      return answer.body
    }
    let generation = this.#generation
    let fill = this.#fills.get(key) ?? this.#fill(key, load)
    await new Promise<void>((resolve) => {
      let done = () => {
        cancel()
        this.#waiters.delete(done)
        fill.waiters.delete(done)
        resolve()
      }
      let cancel = this.options.timer.after(25, done)
      this.#waiters.add(done)
      fill.waiters.add(done)
    })
    this.#check(generation)
    answer = this.#answers.get(key)
    if (!answer) throw new DirectoryCopyUnavailable()
    return answer.body
  }

  /**
   * Persist a new revision and block every query until matching publication.
   * Call in the authoritative commit hook; a write failure must abort commit.
   * Even if storage throws, this instance stays blocked.
   */
  fence(): number {
    this.#state = {
      ...this.#state,
      revision: this.#state.revision + 1,
      blocked: true,
    }
    this.#invalidate()
    this.options.persistence.write(structuredClone(this.#state))
    return this.#state.revision
  }

  /**
   * Atomically replace all registered bodies and unblock only this revision.
   * Missing keys (including keys registered since recomputation started) return
   * false without changing the snapshot. Deletions must supply an empty result
   * body, not omit the key. Unknown keys are ignored. Late revisions return false.
   */
  publish(
    revision: number,
    answers: Iterable<readonly [string, string]>,
  ): boolean {
    if (revision !== this.#state.revision) return false
    let supplied = new Map(answers)
    if (this.keys().some((key) => !supplied.has(key))) return false
    let at = this.options.timer.now()
    let replacement = this.keys().map((key): [string, DirectoryCopyAnswer] => [
      key,
      { body: supplied.get(key)!, at },
    ])
    this.#save({ revision, blocked: false, answers: replacement })
    this.#invalidate()
    return true
  }

  #check(generation = this.#generation): void {
    if (this.#state.blocked || generation !== this.#generation) {
      throw new DirectoryCopyUnavailable()
    }
  }

  #save(state: DirectoryCopyState): void {
    this.options.persistence.write(structuredClone(state))
    this.#state = state
    this.#answers = new Map(state.answers)
  }

  #invalidate(): void {
    this.#generation++
    this.#fills.clear()
    for (let done of this.#waiters) done()
  }

  #fill(key: string, load: () => Promise<string>): Fill {
    let generation = this.#generation
    // Defer invocation so even synchronous throws are handled and deduped.
    let waiters = new Set<() => void>()
    let promise = Promise.resolve().then(load).then((body) => {
      if (this.#state.blocked || generation !== this.#generation) return
      let answers = new Map(this.#answers).set(key, {
        body,
        at: this.options.timer.now(),
      })
      this.#save({ ...this.#state, answers: [...answers] })
    }).catch(() => {
      // A failed refresh never discards an earlier body or rejects waitUntil.
    }).finally(() => {
      if (this.#fills.get(key) === fill) this.#fills.delete(key)
      for (let done of waiters) done()
    })
    let fill = { promise, waiters }
    this.#fills.set(key, fill)
    this.options.retain(promise)
    return fill
  }
}
