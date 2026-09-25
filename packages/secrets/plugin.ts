// The graph plugin that finishes a secret's write, in two halves: a secret's
// value comes out of a write in its first phase, and goes into the vault once
// the write has committed, so nothing the graph keeps — storage, the journal,
// a broadcast, a backup — ever holds more than the handle.
//
// `normalize` is the first thing `apply()` does. It takes each written value
// and puts the secret's handle where the value was (./sentinel.ts): the handle
// the vault already keeps for that secret, so a new value is a rotation behind
// the same handle, or a new one for a secret written the first time. The value
// itself waits in this process's memory, keyed by the handle, and never on the
// bundle: a `$` key would ride the bundle through every phase, and the point is
// that no phase but this one sees it. The same hook reaches into a tool call's
// arguments, because `graph_apply` records what it was asked in the `call` row
// before it applies it — without this the value would land in the graph as the
// arguments of a call. A handle minted there is remembered for its secret, so the
// write the call goes on to make gets the same one.
//
// The bundle that writes a value, or carries a handle a value is waiting
// behind, is marked `provisional` (@yaks/effects) with a note saying the key is
// being saved. The change commits with the handle and the mark.
//
// The other half is the same plugin's `effect` hook (`sealing` below). After
// the change commits it seals each waiting value into the vault under the
// secret's entity id and removes the mark; a deleted secret is dropped from the
// vault the same way. It is not an effect another process could run: the value
// is in this process's memory and nowhere else, which is the point, so the
// process that wrote it seals it. `apply()` waits for its effect hooks, so
// whoever wrote the value gets their answer once it is sealed and never sees
// the mark; only another reader in between does. A seal that fails says so on
// the secret, in @yaks/tools' words: `error` for a failure the vault expects
// and the seal tries again, `exception` for one somebody has to fix.
//
// Nothing touches the vault inside the transaction. A vault may answer later
// (D1 on yaks.app) and a transaction may not wait for it (a Durable Object's
// commits the moment its body returns). A value a refused change took, or one a
// call carried that never ran, is let go after a while rather than kept for the
// life of the process.

import { PROVISIONAL, type Write } from '@yaks/effects'
import type { Bundle, Eid, Hook, Plugin, Tx } from '@yaks/graph'
import { dead, each, isPromise, then } from '@yaks/graph'
import { isOpRef } from './op.ts'
import { secretEid } from './reveal.ts'
import { handle, isHandle } from './sentinel.ts'
import type { Vault } from './vault.ts'

export let SECRET = 'secret'
let HOLD_MS = 10 * 60_000
// What a reader is told while the value is on its way to the vault.
let SAVING = 'saving the key'

let obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v == 'object' && !Array.isArray(v)
    ? v as Record<string, unknown>
    : undefined

// A written value: a `secret` patch carrying a string that is not already a
// handle.
let plain = (v: unknown): string | undefined => {
  let value = obj(v)?.value
  return typeof value == 'string' && !isHandle(value) ? value : undefined
}

// Which secret a bundle writes: the entity it names, or, for an alias not yet
// minted, the one its name derives. A bundle with neither gets a handle of its
// own.
let whose = (o: Record<string, unknown>): Eid | undefined => {
  let eid = obj(o.entity)?.eid
  if (typeof eid == 'string' && !eid.startsWith('$')) return eid
  let name = obj(o[SECRET])?.name
  return typeof name == 'string' ? secretEid(name) : undefined
}

// Every written secret inside a JSON value — a tool call's arguments carry
// whole bundles — replaced by whatever `to` answers for it, always in the same
// order, so one pass can find them and a second can swap them.
let walk = (
  v: unknown,
  to: (value: string, eid?: Eid) => string | undefined,
): unknown => {
  if (Array.isArray(v)) return v.map((x) => walk(x, to))
  let o = obj(v)
  if (!o) return v
  let value = plain(o[SECRET])
  let now = value == null ? undefined : to(value, whose(o))
  let out = Object.fromEntries(
    Object.entries(o).map(([k, x]) => [k, k == SECRET ? x : walk(x, to)]),
  )
  if (now != null) out[SECRET] = { ...obj(o[SECRET]), value: now }
  return out
}

let args = (b: Bundle): unknown => obj(b.call)?.args

// The secrets inside a call's arguments, in the order `walk` visits them.
let inside = (called: unknown): [string, Eid | undefined][] => {
  let out: [string, Eid | undefined][] = []
  if (called != null) walk(called, (value, eid) => void out.push([value, eid]))
  return out
}

let writes = (b: Bundle): boolean =>
  plain(b[SECRET]) != null || inside(args(b)).length > 0

/** Whether a batch carries a secret's value — in a `secret`, or inside a
 * call's arguments — which only the vault may keep. A host that writes a
 * batch down before applying it (a write log) keeps none that does. */
export let carries = (bundles: unknown): boolean =>
  Array.isArray(bundles) &&
  bundles.some((b) => !!obj(b) && writes(b as Bundle))

// Values waiting to be sealed, per vault, in this process's memory: the plugin
// takes them out of a write and puts them in the vault once it commits — and
// a plugin built twice over one vault shares them.
type Holding = {
  waiting: Map<string, { value: string; eid?: Eid; until: number }>
  minted: Map<Eid, { handle: string; until: number }>
}
let holdings = new WeakMap<Vault, Holding>()
let holding = (vault: Vault): Holding => {
  let h = holdings.get(vault)
  if (!h) holdings.set(vault, h = { waiting: new Map(), minted: new Map() })
  return h
}

/** The plugin, over the vault its secrets are kept in and the door what it
 * says about a seal is written through: the graph's own `apply()`, trusted,
 * since `provisional` coming off is the host's word, never a client's. */
export let secrets = (vault: Vault, write: Write): Plugin => {
  let { waiting, minted } = holding(vault)

  // The handle for a secret being written: the one the vault keeps for it, the
  // one this process gave it moments ago, or a new one.
  let handleOf = (eid?: Eid): string | Promise<string> =>
    !eid ? handle() : then(vault.read(eid), (kept) => {
      let h = kept?.handle ?? minted.get(eid)?.handle ?? handle()
      if (!kept) minted.set(eid, { handle: h, until: Date.now() + HOLD_MS })
      return h
    })

  let hold = async (value: string, eid?: Eid): Promise<string> => {
    let h = await handleOf(eid)
    waiting.set(h, { value, eid, until: Date.now() + HOLD_MS })
    return h
  }

  // A handle a value is waiting behind, written for the secret it was held
  // for: the write a call goes on to make.
  let behind = (b: Bundle): boolean => {
    let h = obj(b[SECRET])?.value
    let held = typeof h == 'string' ? waiting.get(h) : undefined
    return !!held && (!held.eid || held.eid == whose(b))
  }

  let hide = (b: Bundle): Bundle | Promise<Bundle> => {
    let own = plain(b[SECRET])
    let called = args(b)
    let found = inside(called)
    let mark = own != null || behind(b)
    if (!mark && !found.length) return b
    let asked = own == null ? found : [[own, whose(b)] as const, ...found]
    return Promise.all(asked.map(([value, eid]) => hold(value, eid))).then(
      (hs) => {
        let i = own == null ? 0 : 1
        return {
          ...b,
          ...own == null
            ? {}
            : { [SECRET]: { ...obj(b[SECRET]), value: hs[0] } },
          ...!found.length ? {} : {
            call: {
              ...obj(b.call),
              args: walk(called, () => hs[i++]),
            },
          },
          ...mark ? { [PROVISIONAL]: { note: SAVING } } : {},
        }
      },
    )
  }

  return {
    name: '@yaks/secrets',
    hooks: {
      effect: sealing(vault, write),
      normalize: (bundles) => {
        let now = Date.now()
        for (let [h, w] of waiting) if (w.until < now) waiting.delete(h)
        for (let [e, m] of minted) if (m.until < now) minted.delete(e)
        if (!bundles.some((b) => writes(b) || behind(b))) return bundles
        return each(
          bundles,
          [] as Bundle[],
          (out, b) => then(hide(b), (one) => [...out, one]),
        )
      },
    },
  }
}

// Run `step`, then `ok` or `no`, staying synchronous for a vault that is.
let settle = <T>(
  step: () => unknown,
  ok: () => T | Promise<T>,
  no: (e: unknown) => T | Promise<T>,
): T | Promise<T> => {
  try {
    let r = step()
    return isPromise(r) ? r.then(ok, no) : ok()
  } catch (e) {
    return no(e)
  }
}

/** A failure the vault says trying again may cure: an error carrying
 * `retryable: true`, the flag the Workers runtime sets on its own (@yaks/d1's
 * vault sets it for the D1 errors Cloudflare documents as transient). */
export let retryable = (e: unknown): boolean =>
  !!e && typeof e == 'object' &&
  (e as { retryable?: unknown }).retryable === true

// How often a seal is tried, and how long it waits between tries: exponential
// backoff with jitter, as Cloudflare advises for D1 writes
// (https://developers.cloudflare.com/d1/best-practices/retry-queries/).
let TRIES = 5
let pause = (n: number) =>
  new Promise((go) =>
    setTimeout(go, Math.min(2_000, 50 * 2 ** n) * (0.5 + Math.random() / 2))
  )

let told = (e: unknown) => e instanceof Error ? e.message : String(e)

/**
 * The half that finishes a secret's write, over the vault the plugin holds its
 * values for: after the commit, each waiting value sealed under the secret's
 * entity id and the mark removed. A secret that goes — its entity, or its
 * component — is dropped from the vault.
 *
 * A seal can fail two ways. One the vault calls {@link retryable} is expected:
 * the entity gets an `error` (@yaks/tools) saying so, and the seal is tried
 * again here, while the value is still in memory and the writer is still
 * waiting; a later success removes the `error` with the mark. Anything else —
 * or a retryable failure that outlasts every try, so one failure can be both —
 * is a defect somebody has to fix: the mark comes off, an `exception` goes on
 * with what went wrong in `content` beside it, and the failure is rethrown for
 * the graph to report. Either way the value is gone, and the person gives it
 * again.
 */
let sealing = (vault: Vault, write: Write): Hook => {
  let { waiting, minted } = holding(vault)
  let seal = (eid: Eid, comp: Record<string, unknown>, tx: Tx) => {
    let h = comp.value
    let held = typeof h == 'string' ? waiting.get(h) : undefined
    if (!held || held.eid && held.eid != eid) return
    waiting.delete(h as string)
    minted.delete(eid)
    let kept = isOpRef(held.value) ? { op: held.value } : { value: held.value }
    let name = comp.name
    let put = () =>
      then(vault.read(eid), (was) => {
        let named = typeof name == 'string' ? name : was?.name
        return vault.seal(eid, {
          ...named ? { name: named } : {},
          handle: h as string,
          ...kept,
        })
      })
    let mark = (said: Bundle) => write([{ ...said, entity: { eid } }])
    // Sealed: the mark comes off, and with it any failure an earlier try, or
    // an earlier write, left on this secret.
    let sealed = () =>
      then(tx.get([eid]), ([b]) =>
        mark({
          entity: { eid },
          [PROVISIONAL]: null,
          ...b?.error || b?.exception
            ? { error: null, exception: null, content: null }
            : {},
        }))
    let attempt = (n: number): unknown =>
      settle(put, sealed, (err) =>
        retryable(err) && n < TRIES
          ? then(
            mark({
              entity: { eid },
              error: { code: 'transient' },
              content: { body: `saving the key, trying again: ${told(err)}` },
            }),
            () => pause(n).then(() => attempt(n + 1)),
          )
          : then(
            mark({
              entity: { eid },
              [PROVISIONAL]: null,
              exception: {},
              content: { body: `the key could not be saved: ${told(err)}` },
            }),
            () => {
              throw err
            },
          ))
    return attempt(1)
  }
  let drop = (eid: Eid) => {
    minted.delete(eid)
    return vault.drop(eid)
  }
  return (bundles, tx) =>
    then(
      each(bundles, null as unknown, (_, b) => {
        let eid = b.entity.eid
        if (dead(b) || b[SECRET] === null) return drop(eid)
        let comp = obj(b[SECRET])
        return comp ? seal(eid, comp, tx) : null
      }),
      () => bundles,
    )
}
