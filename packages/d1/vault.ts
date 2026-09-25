// A vault of secrets in D1: what yaks.app keeps where a box keeps private
// files. It meets @yaks/secrets' `Vault` by shape and never imports it, so this
// package knows nothing of secrets beyond the few fields it stores; the check
// that the shapes agree is ./vault_test.ts, which hands this vault to the
// secrets plugin.
//
// The table sits in whatever database the caller binds, often the graph's own,
// so every value is encrypted under a key the caller holds (AES-GCM, the row's
// own key as associated data, so a row copied under another name does not
// open). The database, its Time Travel and its exports hold only ciphertext;
// the key lives wherever the Worker keeps its own secrets.
//
// D1 has no interactive transaction, so the lock a read-change-write needs is a
// lease row: taken by an upsert that only wins over an expired lease, and
// deleted by its holder. Callers in this isolate wait in a queue first, so the
// lease row only ever arbitrates between isolates.
//
// A failure D1 documents as transient is thrown with `retryable: true`, the
// flag the Workers runtime puts on its own and @yaks/secrets tries a seal again
// for. Every statement here is safe to run twice: an upsert, a delete, a read.

import {
  and,
  col,
  type CreateTable,
  eq,
  lt,
  ne,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import { type D1Like, prepare, type Prepared } from './d1.ts'

/** What a vault keeps for one secret — @yaks/secrets' `Sealed`, by shape. */
export type Sealed = {
  name?: string
  handle: string
  value?: string
  op?: string
}

/** A vault in D1, answering with promises. */
export type D1Vault = {
  salt: () => Promise<Uint8Array>
  read: (eid: string) => Promise<Sealed | undefined>
  seal: (eid: string, sealed: Sealed) => Promise<void>
  drop: (eid: string) => Promise<void>
  all: () => Promise<[string, Sealed][]>
  lock: <T>(eid: string, fn: () => Promise<T>) => Promise<T>
}

// The salt is a row like any secret, under a name no secret's uuid can be.
let SALT = 'salt'
// How long a lease stands if its holder dies holding it, and how long a
// caller waits for one before giving up.
let LEASE = 30_000

let VAULT = 'yak_vault'
let LOCK = 'yak_vault_lock'

let key = { name: 'k', type: 'text', pk: true }
let SCHEMA: CreateTable[] = [
  {
    t: 'create table',
    name: VAULT,
    ifNot: true,
    cols: [key, { name: 'v', type: 'text', notNull: true }],
  },
  {
    t: 'create table',
    name: LOCK,
    ifNot: true,
    cols: [
      key,
      { name: 'holder', type: 'text', notNull: true },
      { name: 'expires', type: 'integer', notNull: true },
    ],
  },
]

// The lease on `k` for `holder` until `expires`, taken only over one that ran
// out before `now`; it returns a row when it was taken.
let take = (k: string, holder: string, expires: number, now: number): Stmt => ({
  t: 'insert',
  into: LOCK,
  cols: ['k', 'holder', 'expires'],
  rows: [[val(k), val(holder), val(expires)]],
  upsert: [{
    on: [col('k')],
    set: {
      holder: col('holder', 'excluded'),
      expires: col('expires', 'excluded'),
    },
    when: lt(col('expires', LOCK), val(now)),
  }],
  returning: [col('holder')],
})

// A secret's row written, and whether one already there is replaced.
let put = (k: string, v: string, replace: boolean): Stmt => ({
  t: 'insert',
  into: VAULT,
  cols: ['k', 'v'],
  rows: [[val(k), val(v)]],
  upsert: [replace ? { on: [col('k')], set: { v: col('v', 'excluded') } } : {}],
})

let get = (k: string): Stmt =>
  select({ cols: [col('v')], from: table(VAULT), where: eq(col('k'), val(k)) })

// The D1 errors whose recommended action is "Retry the operation", from the
// List of D1_ERRORs in Cloudflare's docs
// (https://developers.cloudflare.com/d1/observability/debug-d1/#error-list).
// The rest there — an overloaded database, a query past its time, memory or
// size limits, a missing column — are a query or a quota to fix, not a moment
// to wait out.
let TRANSIENT = [
  'D1 DB reset because its code was updated',
  'Internal error while starting up D1 DB storage caused object to be reset',
  'Network connection lost',
  'Replica disconnected from primary',
  'Internal error in D1 DB storage caused object to be reset',
  'Cannot resolve D1 DB due to transient issue on remote node',
  "Can't read from request stream because client disconnected",
]

/** Whether D1 said this failure is one to try again. */
export let transient = (e: unknown): boolean =>
  TRANSIENT.some((said) => String(e).includes(said))

// The failure, with the runtime's own flag set where D1 says to retry.
let flagged = (e: unknown) =>
  transient(e) && e && typeof e == 'object'
    ? Object.assign(e, { retryable: true })
    : e

let base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
let unbase64 = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
let utf8 = new TextEncoder()

// One lock per key within this isolate: each caller waits for the one before.
let queue = () => {
  let tails = new Map<string, Promise<unknown>>()
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    let run = (tails.get(key) ?? Promise.resolve()).then(fn, fn)
    let tail = run.catch(() => {})
    tails.set(key, tail)
    tail.then(() => tails.get(key) == tail && tails.delete(key))
    return run
  }
}

/**
 * The vault in a D1 database, every value encrypted under `key` (AES-GCM),
 * which may still be on its way — a key imported from a Worker secret is. Its
 * two tables are created on first use.
 *
 * ```ts
 * import { d1Vault } from '@yaks/d1'
 *
 * // let vault = d1Vault(env.DB, key)
 * // graph({ storage, vocab, plugins: [secrets(vault)] }) // @yaks/secrets
 * ```
 */
export let d1Vault = <S extends Prepared<S>>(
  db: D1Like<S>,
  key: CryptoKey | Promise<CryptoKey>,
): D1Vault => {
  // Made once per vault, and asked again after a failure rather than failing
  // every call after it.
  let ready: Promise<unknown> | undefined
  let run = async (s: Stmt) => {
    try {
      await (ready ??= db.batch(SCHEMA.map((s) => prepare(db, s))).catch(
        (e) => {
          ready = undefined
          throw e
        },
      ))
      return (await prepare(db, s).all<Record<string, string>>()).results
    } catch (e) {
      throw flagged(e)
    }
  }

  let seal = async (k: string, text: string) => {
    let iv = crypto.getRandomValues(new Uint8Array(12))
    let data = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: utf8.encode(k) },
        await key,
        utf8.encode(text),
      ),
    )
    let both = new Uint8Array(12 + data.length)
    both.set(iv)
    both.set(data, 12)
    return base64(both)
  }
  let open = async (k: string, v: string) => {
    let both = unbase64(v)
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: both.slice(0, 12),
          additionalData: utf8.encode(k),
        },
        await key,
        both.slice(12),
      ),
    )
  }

  let salt: Uint8Array | undefined
  let held = queue()
  return {
    // Two isolates asking at once each offer one; the first written wins and
    // both read it back.
    salt: async () => {
      if (salt) return salt
      let offer = crypto.getRandomValues(new Uint8Array(32))
      await run(put(SALT, await seal(SALT, base64(offer)), false))
      let [row] = await run(get(SALT))
      return salt = unbase64(await open(SALT, row.v))
    },
    read: async (eid) => {
      let [row] = await run(get(eid))
      return row ? JSON.parse(await open(eid, row.v)) as Sealed : undefined
    },
    seal: async (eid, sealed) => {
      await run(put(eid, await seal(eid, JSON.stringify(sealed)), true))
    },
    drop: async (eid) => {
      await run({ t: 'delete', from: VAULT, where: eq(col('k'), val(eid)) })
    },
    all: async () => {
      let rows = await run(select({
        cols: [col('k'), col('v')],
        from: table(VAULT),
        where: ne(col('k'), val(SALT)),
      }))
      return Promise.all(
        rows.map(async (r) =>
          [r.k, JSON.parse(await open(r.k, r.v))] as [string, Sealed]
        ),
      )
    },
    lock: (eid, fn) =>
      held(eid, async () => {
        let me = crypto.randomUUID()
        let until = Date.now() + LEASE
        for (let wait = 5;; wait = Math.min(wait * 2, 500)) {
          let now = Date.now()
          if ((await run(take(eid, me, now + LEASE, now))).length) break
          if (now > until) throw new Error(`${eid} is locked elsewhere`)
          await new Promise((r) => setTimeout(r, wait))
        }
        try {
          return await fn()
        } finally {
          await run({
            t: 'delete',
            from: LOCK,
            where: and(eq(col('k'), val(eid)), eq(col('holder'), val(me))),
          })
        }
      }),
  }
}
