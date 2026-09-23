// The graph plugin: a secret's value comes out of a write in the first phase
// and goes into the vault in the last one inside the transaction, so nothing
// between them — storage, the journal, a broadcast, an effect, a backup —
// ever holds more than the handle.
//
// `normalize` is the first thing `apply()` does. It takes each written value
// and puts the secret's handle where the value was (./sentinel.ts): the handle
// the vault already keeps for that secret, so a new value is a rotation behind
// the same handle, or a new one for a secret written the first time. The value
// itself waits in this plugin's memory, keyed by the handle, and never on the
// bundle: a `$` key would ride the bundle through every phase, and the point is
// that no phase but this one sees it. The same hook reaches into a tool call's
// arguments, because `graph_apply` records what it was asked in the `call` row
// before it applies it — without this the value would land in the graph as the
// text of a call. A handle minted there is remembered for its secret, so the
// write the call goes on to make gets the same one.
//
// `commit` seals: every bundle arriving with a handle this plugin is holding a
// value for writes it to the vault under the bundle's entity id, and every
// deleted secret is dropped from it. It runs inside the transaction on
// purpose — a vault that refuses the write refuses the change, rather than
// leaving a row naming a value nobody kept — and what the vault held before is
// remembered until the change is settled: `effect` forgets it, and the value
// it sealed, once the change has committed, and `audit`, which runs after every
// rollback including a dry run's, puts it back.
//
// A value that `normalize` took but no `commit` sealed — the change was
// refused, or the call it rode in on never ran — is let go after a while
// rather than kept for the life of the process.

import type { Bundle, Eid, Plugin } from '@yaks/graph'
import { each, then } from '@yaks/graph'
import { isOpRef } from './op.ts'
import { secretEid } from './reveal.ts'
import { handle, isHandle } from './sentinel.ts'
import type { Sealed, Vault } from './vault.ts'

let SECRET = 'secret'
let HOLD_MS = 10 * 60_000

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

let args = (b: Bundle): unknown => {
  let text = obj(b.call)?.args
  if (typeof text != 'string') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// The secrets inside a call's arguments, in the order `walk` visits them.
let inside = (called: unknown): [string, Eid | undefined][] => {
  let out: [string, Eid | undefined][] = []
  if (called != null) walk(called, (value, eid) => void out.push([value, eid]))
  return out
}

let writes = (b: Bundle): boolean =>
  plain(b[SECRET]) != null || inside(args(b)).length > 0

/** The plugin, over the vault its secrets are kept in. */
export let secrets = (vault: Vault): Plugin => {
  let waiting = new Map<string, { value: string; eid?: Eid; until: number }>()
  let minted = new Map<Eid, { handle: string; until: number }>()
  let before = new Map<Eid, Sealed | null>()

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

  let hide = (b: Bundle): Bundle | Promise<Bundle> => {
    let own = plain(b[SECRET])
    let called = args(b)
    let found = inside(called)
    if (own == null && !found.length) return b
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
              args: JSON.stringify(walk(called, () => hs[i++])),
            },
          },
        }
      },
    )
  }

  // Remember what the vault held for an entity, the first time this change
  // touches it.
  let keep = (eid: Eid) =>
    before.has(eid) ? undefined : then(
      vault.read(eid),
      (was) => void before.set(eid, was ?? null),
    )

  let seal = (b: Bundle) => {
    let eid = b.entity.eid
    let comp = b[SECRET]
    if (b.tombstone || comp === null) {
      return then(
        vault.read(eid),
        (was) => was && then(keep(eid), () => vault.drop(eid)),
      )
    }
    let h = obj(comp)?.value
    let held = typeof h == 'string' ? waiting.get(h) : undefined
    if (!held || held.eid && held.eid != eid) return
    let kept = isOpRef(held.value) ? { op: held.value } : { value: held.value }
    return then(vault.read(eid), (was) => {
      if (
        was && was.handle == h && was.value == kept.value && was.op == kept.op
      ) {
        return
      }
      let name = obj(comp)!.name ?? was?.name
      return then(keep(eid), () =>
        vault.seal(eid, {
          ...typeof name == 'string' ? { name } : {},
          handle: h as string,
          ...kept,
        }))
    })
  }

  return {
    name: '@yaks/secrets',
    hooks: {
      normalize: (bundles) => {
        let now = Date.now()
        for (let [h, w] of waiting) if (w.until < now) waiting.delete(h)
        for (let [e, m] of minted) if (m.until < now) minted.delete(e)
        if (!bundles.some(writes)) return bundles
        return each(
          bundles,
          [] as Bundle[],
          (out, b) => then(hide(b), (one) => [...out, one]),
        )
      },
      commit: (bundles) =>
        each(bundles, bundles, (out, b) => then(seal(b), () => out)),
      effect: (bundles) => {
        for (let b of bundles) {
          let eid = b.entity.eid
          before.delete(eid)
          minted.delete(eid)
          let h = obj(b[SECRET])?.value
          if (typeof h == 'string' && waiting.get(h)?.eid == eid) {
            waiting.delete(h)
          }
        }
        return bundles
      },
      audit: (bundles) =>
        each(bundles, bundles, (out, b) => {
          let eid = b.entity.eid
          if (!before.has(eid)) return out
          let was = before.get(eid)
          before.delete(eid)
          return then(was ? vault.seal(eid, was) : vault.drop(eid), () => out)
        }),
    },
  }
}
