// The graph plugin: a secret's value comes out of a write in the first phase
// and goes into the vault in the last one inside the transaction, so nothing
// between them — storage, the journal, a broadcast, an effect, a backup —
// ever holds more than the sentinel.
//
// `normalize` is the first thing `apply()` does. It takes each written value,
// hashes it into the sentinel, and puts the sentinel where the value was. The
// value itself waits in this plugin's memory, keyed by the sentinel, and never
// on the bundle: a `$` key would ride the bundle through every phase, and the
// point is that no phase but this one sees it. The same hook reaches into a
// tool call's arguments, because `graph_apply` records what it was asked in the
// `call` row before it applies it — without this the value would land in the
// graph as the text of a call.
//
// `commit` seals: every bundle arriving with a sentinel this plugin is holding
// the value for writes it to the vault under the bundle's entity id, and every
// deleted secret is dropped from it. It runs inside the transaction on
// purpose — a vault that refuses the write refuses the change, rather than
// leaving a row naming a value nobody kept — and what the vault held before is
// remembered until the change is settled: `effect` forgets it once the change
// has committed, and `audit`, which runs after every rollback including a dry
// run's, puts it back.
//
// A value that `normalize` took but no `commit` sealed — the change was
// refused, or the call it rode in on never ran — is let go after a while
// rather than kept for the life of the process.

import type { Bundle, Eid, Plugin } from '@yaks/graph'
import { each, then } from '@yaks/graph'
import { isOpRef } from './op.ts'
import { isSentinel, sentinel } from './sentinel.ts'
import type { Sealed, Vault } from './vault.ts'

let SECRET = 'secret'
let HOLD_MS = 10 * 60_000

let obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v == 'object' && !Array.isArray(v)
    ? v as Record<string, unknown>
    : undefined

// A written value: a `secret` patch carrying a string that is not already a
// sentinel.
let plain = (v: unknown): string | undefined => {
  let value = obj(v)?.value
  return typeof value == 'string' && !isSentinel(value) ? value : undefined
}

// Every written value inside a JSON value, wherever a `secret` patch sits in
// it — a tool call's arguments carry whole bundles.
let found = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => found(x, out))
  else if (obj(v)) {
    let value = plain(obj(v)![SECRET])
    if (value != null) out.push(value)
    Object.values(obj(v)!).forEach((x) => found(x, out))
  }
  return out
}

// The same value with every written secret swapped for its sentinel.
let swapped = (v: unknown, as: Map<string, string>): unknown => {
  if (Array.isArray(v)) return v.map((x) => swapped(x, as))
  let o = obj(v)
  if (!o) return v
  let out = Object.fromEntries(
    Object.entries(o).map(([k, x]) => [k, swapped(x, as)]),
  )
  let value = plain(o[SECRET])
  if (value != null) {
    out[SECRET] = { ...obj(o[SECRET]), value: as.get(value) }
  }
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

/** The plugin, over the vault its secrets are kept in. */
export let secrets = (vault: Vault): Plugin => {
  let waiting = new Map<string, { value: string; until: number }>()
  let before = new Map<Eid, Sealed | null>()

  let hold = (salt: Uint8Array, values: string[]) =>
    Promise.all(values.map(async (value) => {
      let s = await sentinel(salt, value)
      waiting.set(s, { value, until: Date.now() + HOLD_MS })
      return [value, s] as const
    })).then((pairs) => new Map(pairs))

  // One bundle's written values: its own `secret` patch, and any inside the
  // arguments of the call it records.
  let written = (b: Bundle): string[] => {
    let own = plain(b[SECRET])
    let called = args(b)
    return [...own == null ? [] : [own], ...called == null ? [] : found(called)]
  }

  let hide = (salt: Uint8Array, b: Bundle): Bundle | Promise<Bundle> => {
    let values = written(b)
    if (!values.length) return b
    let own = plain(b[SECRET])
    let called = args(b)
    return hold(salt, values).then((as) => ({
      ...b,
      ...own == null
        ? {}
        : { [SECRET]: { ...obj(b[SECRET]), value: as.get(own) } },
      ...called == null || !found(called).length ? {} : {
        call: { ...obj(b.call), args: JSON.stringify(swapped(called, as)) },
      },
    }))
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
    let s = obj(comp)?.value
    let held = typeof s == 'string' ? waiting.get(s) : undefined
    if (!held) return
    return then(vault.read(eid), (was) => {
      if (was?.sentinel == s) return
      let name = obj(comp)!.name ?? was?.name
      return then(keep(eid), () =>
        vault.seal(eid, {
          ...typeof name == 'string' ? { name } : {},
          sentinel: s as string,
          ...isOpRef(held.value) ? { op: held.value } : { value: held.value },
        }))
    })
  }

  return {
    name: '@yaks/secrets',
    hooks: {
      normalize: (bundles) => {
        let now = Date.now()
        for (let [s, w] of waiting) if (w.until < now) waiting.delete(s)
        if (!bundles.some((b) => written(b).length)) return bundles
        return then(vault.salt(), (salt) =>
          each(
            bundles,
            [] as Bundle[],
            (out, b) => then(hide(salt, b), (one) => [...out, one]),
          ))
      },
      commit: (bundles) =>
        each(bundles, bundles, (out, b) => then(seal(b), () => out)),
      effect: (bundles) => {
        for (let b of bundles) before.delete(b.entity.eid)
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
