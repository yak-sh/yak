import { type Clock, sleep, system } from '@yaks/fp'
import { ServingCopyUnavailable } from './serving-copy.ts'

export let REGIONAL_LEASE_MS: number = 30_000
export let REGIONAL_CLOCK_SKEW_MS: number = 1_000

/** A directory grant after a committed route read. The authority records
 * its deadline durably before sending it. An epoch identifies the fence,
 * so a write that rolls back can grant its old revision under a new epoch. */
export type RegionalLease = { epoch: number; revision: number; until: number }

/** The reader must stop ahead of the authority's deadline by the maximum
 * relative clock skew. Use the same cutoff for a delayed regional reply. */
export let regionalLeaseCurrent = (until: number, now: number): boolean =>
  Number.isSafeInteger(until) && Number.isSafeInteger(now) &&
  now + REGIONAL_CLOCK_SKEW_MS < until

type Answer = [key: string, body: string]
type RegionalCopyState = RegionalLease & { observedAt: number }
export type RegionalCopySnapshot = {
  state: RegionalCopyState
  /** Ordered from oldest to newest fill. */
  answers: Answer[]
}
export type RegionalCopyChange = {
  state: RegionalCopyState
  clear?: true
  remove?: string[]
  /** Replacement moves the answer to the end of the fill order. */
  put?: Answer
}
export type RegionalCopyPersistence = {
  read(): RegionalCopySnapshot | undefined
  /** Apply the state and answer changes atomically, clear/remove before put. */
  write(change: RegionalCopyChange): void
}
export type RegionalCopyOptions = {
  persistence: RegionalCopyPersistence
  clock?: Pick<Clock, 'now'>
  maxAnswers?: number
}

let empty = (epoch: number, observedAt = 0): RegionalCopyState => ({
  epoch,
  revision: 0,
  until: 0,
  observedAt,
})
let units = ([key, body]: Answer) => key.length + body.length
export let regionalAnswerFits = (key: string, body: string): boolean =>
  units([key, body]) <= 64 * 1024

/** A regional copy's durable epoch blocks late fills after an acknowledged
 * fence. Its durable bounded grant blocks them after an unacknowledged one. */
export class RegionalServingCopy {
  #state: RegionalCopyState
  #answers: Map<string, string>
  #size: number
  #seen: number
  #maxAnswers: number
  #now: Clock['now']

  constructor(private readonly options: RegionalCopyOptions) {
    this.#now = options.clock?.now ?? system.now
    this.#maxAnswers = options.maxAnswers ?? 1000
    if (
      !Number.isInteger(this.#maxAnswers) || this.#maxAnswers < 1 ||
      this.#maxAnswers > 1000
    ) {
      throw new RangeError('maxAnswers must be an integer between 1 and 1000')
    }
    let saved = options.persistence.read()
    this.#state = saved?.state ?? empty(0)
    this.#seen = this.#state.observedAt
    this.#answers = new Map(saved?.answers)
    this.#size = (saved?.answers ?? []).reduce((n, pair) => n + units(pair), 0)
  }

  invalidate(epoch: number): void {
    if (!Number.isSafeInteger(epoch) || epoch < 0) {
      throw new RangeError('Invalid regional serving epoch')
    }
    if (epoch <= this.#state.epoch) return
    this.#write({ state: empty(epoch, this.#seen), clear: true })
  }

  read(key: string): RegionalLease & { body: string } {
    let now = this.#now()
    let { epoch, revision, until } = this.#state
    let body = this.#answers.get(key)
    if (now < this.#seen || !Number.isSafeInteger(now)) {
      throw new ServingCopyUnavailable()
    }
    this.#seen = now
    if (body === undefined || !regionalLeaseCurrent(until, now)) {
      throw new ServingCopyUnavailable()
    }
    return { epoch, revision, until, body }
  }

  publish(lease: RegionalLease, key: string, body: string): boolean {
    let answer: Answer = [key, body]
    let now = this.#now()
    let state = this.#state
    if (
      !regionalAnswerFits(key, body) || now < this.#seen ||
      !regionalLeaseCurrent(lease.until, now) ||
      !Number.isSafeInteger(lease.epoch) || lease.epoch < state.epoch ||
      !Number.isSafeInteger(lease.revision) || lease.revision < 0
    ) return false
    this.#seen = now
    let sameEpoch = lease.epoch === state.epoch
    if (sameEpoch && lease.revision < state.revision) return false
    let clear = !sameEpoch || lease.revision !== state.revision
    let newer = clear || lease.until > state.until
    let changed = clear || this.#answers.get(key) !== body
    if (!newer && !changed) return true
    this.#write({
      state: { ...(newer ? lease : state), observedAt: now },
      clear: clear ? true : undefined,
      remove: changed && !clear ? this.#evicted(answer) : undefined,
      put: changed ? answer : undefined,
    })
    return true
  }

  #evicted(answer: Answer): string[] {
    let old = this.#answers.get(answer[0])
    let count = this.#answers.size + (old === undefined ? 1 : 0)
    let size = this.#size + units(answer) -
      (old === undefined ? 0 : answer[0].length + old.length)
    let remove: string[] = []
    for (let pair of this.#answers) {
      if (count <= this.#maxAnswers && size <= 512 * 1024) break
      if (pair[0] === answer[0]) continue
      remove.push(pair[0])
      count--
      size -= units(pair)
    }
    return remove
  }

  #write(change: RegionalCopyChange): void {
    this.options.persistence.write(change)
    this.#state = change.state
    if (change.clear) {
      this.#answers.clear()
      this.#size = 0
    }
    for (let key of change.remove ?? []) this.#remove(key)
    if (change.put) {
      this.#remove(change.put[0])
      this.#answers.set(...change.put)
      this.#size += units(change.put)
    }
  }

  #remove(key: string): void {
    let body = this.#answers.get(key)
    if (body === undefined) return
    this.#answers.delete(key)
    this.#size -= key.length + body.length
  }
}

export type RegionalFence = { until: number; invalidate: () => Promise<void> }

/** With grants paused, wait for each copy to revoke its grant or for that
 * grant to expire. False marks a live grant whose acknowledgement was lost
 * or arrived after its term. */
export let fenceRegionalCopies = (
  copies: readonly RegionalFence[],
  clock: Clock = system,
): Promise<boolean[]> => Promise.all(copies.map((copy) => revoke(copy, clock)))

let revoke = async (
  { until, invalidate }: RegionalFence,
  clock: Clock,
): Promise<boolean> => {
  if (clock.now() >= until) return true
  let cancel = new AbortController()
  let expiry = expired(until, clock, cancel.signal)
  let acknowledgement = Promise.resolve().then(invalidate).then(
    () => true,
    () => expiry,
  )
  try {
    return await Promise.race([acknowledgement, expiry])
  } finally {
    cancel.abort()
  }
}

let expired = async (until: number, clock: Clock, signal: AbortSignal) => {
  let remaining: number
  while (!signal.aborted && (remaining = until - clock.now()) > 0) {
    await sleep(remaining, signal, clock)
  }
  return false
}
