// App phases surrounding core provenance. Per-call state lives on the synchronous
// writer stack, never in wire metadata supplied by a client. Core owns the
// created/updated write; these hooks own fleet lifecycle and ordered audit data.
import {
  type Actor,
  actorOf,
  type ApplyOpts,
  type Bundle,
  type Comp,
  comps,
  dead,
  type Plugin,
  type StampPolicy,
} from '@yaks/graph'
import type { Change } from '../types.ts'
import type { Trace } from '../effects.ts'
import {
  lifecycleAfter,
  type LifecycleBatch,
  lifecycleBefore,
  type LifecycleHost,
  type PriorClaim,
  priorClaimsOf,
  syncFacetAliases,
} from './fleet_lifecycle.ts'
import { asBundle, asChanges } from './wire.ts'

export type FleetWrite = {
  resolve?: boolean
  server?: boolean
  workClaim?: { target: string; source?: Change[] }
  writer?: string | null
  trace?: Trace
  imports?: Map<string, { source: string; line: number }>
}
export type StampHost = LifecycleHost & {
  afterCommit: (run: () => void) => void
  actor: (writer?: string | null) => string | null
  via: (writer?: string | null) => string | null
  removalOrder: () => string[]
  person: (actor: string | null) => boolean
  journal: (
    now: string,
    actor: string | null,
    via: string | null,
    trace: string | null,
    changes: Change[],
  ) => void
}

export let fleetStamps = (host: StampHost) => {
  let stack: ReturnType<typeof state>[] = []
  let state = (input: FleetWrite, now: string, fixed: boolean) => ({
    input,
    now,
    fixed,
    active: false,
    actor: {} as Actor,
    prior: [] as PriorClaim[],
    found: new Map<string, Bundle | null>(),
    minted: new Set<string>(),
    touched: new Set<string>(),
    created: new Set<string>(),
    removed: new Map<string, string[]>(),
    authors: new Map<string, Comp>(),
    operations: [] as Change[],
    numbered: new Set<string>(),
    extra: [] as Change[],
  })
  let current = () => stack.at(-1)!
  let gone = (eid: string) => {
    let s = current()
    return s.found.has(eid)
      ? !!s.found.get(eid)?.tombstone
      : !!host.component(eid, 'tombstone')
  }
  let took = (eid: string, name: string) => {
    let s = current()
    s.removed.set(eid, [...(s.removed.get(eid) ?? []), name])
  }
  let resolve = (bundles: Bundle[]) => {
    let s = current()
    s.actor = 'writer' in s.input
      ? {
        by: host.actor(s.input.writer) ?? undefined,
        via: host.via(s.input.writer) ?? undefined,
      }
      : actorOf(bundles)
    return bundles.map((b) => ({ ...b, $actor: s.actor }))
  }
  let batch = (): LifecycleBatch => {
    let s = current()
    return {
      changes: s.operations,
      extra: s.extra,
      touched: s.touched,
      minted: s.minted,
      createdComps: s.created,
      now: s.now,
      actor: s.actor.by ?? null,
      via: s.actor.via ?? null,
      person: () => host.person(s.actor.by ?? null),
      writer: s.input.writer ?? s.actor.via ?? s.actor.by,
      imports: s.input.imports,
      took,
    }
  }
  let echoed = new Set(['created', 'updated', ...host.stamps, ...host.clocked])
  let plugin: Plugin = {
    name: 'fleet/lifecycle',
    hooks: {
      // From here on adapter writes are mutation/cascade operations.
      precondition: (bundles) => {
        current().active = true
        return resolve(bundles)
      },
      cascade: (bundles) => {
        let s = current()
        // SQL insertion defaults (notably claim.claimed_at) precede the
        // batch's provenance clock, as they did at the live writer door.
        if (!s.fixed) s.now = new Date().toISOString()
        s.active = false
        s.operations = bundles.flatMap((b) =>
          asChanges(b).filter((c) => c.name != 'entity' || c.comp == null).map(
            (c) => {
              let body = (b.$blob as Record<string, unknown> | undefined)
                ?.['doc.body']
              return c.name == 'doc' && c.comp && 'body' in c.comp &&
                  body !== undefined
                ? { ...c, comp: { ...c.comp, body } }
                : c
            },
          )
        )
        syncFacetAliases(host, s.operations, s.extra)
        lifecycleBefore(host, batch(), s.prior)
        let out = resolve(bundles)
        // Edge endpoints can be news without a component patch of their own.
        let present = new Set(out.map((b) => b.entity.eid))
        for (let eid of new Set([...s.minted, ...s.touched])) {
          if (!present.has(eid)) {
            out.push({ entity: { eid }, $actor: s.actor })
          }
        }
        return out
      },
      stamp: (bundles) => {
        let s = current()
        lifecycleAfter(host, batch())
        // SQL's nullable provenance columns are real read shape, including
        // when this batch has no actor or instrument.
        let provenance: Change[] = []
        for (let eid of new Set([...s.minted, ...s.touched])) {
          if (gone(eid)) continue
          let name = s.minted.has(eid) ? 'created' : 'updated'
          let comp = host.component(eid, name)
          if (comp) provenance.push({ eid, name, comp })
        }
        return [
          ...bundles,
          ...s.extra.map(asBundle),
          ...provenance.map(asBundle),
          ...[...s.minted].flatMap((eid) => {
            if (gone(eid)) return []
            let row = host.component(eid, 'entity')
            return row
              ? [{ entity: { eid, num: row.num as number | null } }]
              : []
          }),
        ]
      },
      // Installed after blob restoration/whole-row echoes: journal operations
      // stay ordered, but new components carry defaults just like live apply.
      commit: (bundles) => {
        let s = current()
        let last = new Map<string, number>()
        s.operations.forEach((c, i) => {
          if (c.comp) last.set(`${c.name} ${c.eid}`, i)
        })
        let whole = new Map(
          bundles.filter((b) => b.$fleetWhole)
            .map((b) => [`${b.$fleetWhole} ${b.entity.eid}`, b]),
        )
        let changes = s.operations.map((c, i) => {
          let key = `${c.name} ${c.eid}`
          if (!c.comp || !s.created.has(key) || last.get(key) != i) return c
          // The final creation echo is writable-only (provided by fleetGraph).
          let full = whole.get(key)
          return full ? { ...c, comp: full[c.name] as Comp } : c
        })
        let births = [...new Set([...s.minted, ...s.numbered])].flatMap(
          (eid) => {
            if (gone(eid)) return []
            let comp = host.component(eid, 'entity')
            return comp
              ? [{
                eid,
                name: 'entity',
                comp: s.minted.has(eid) ? comp : { num: comp.num },
              }]
              : []
          },
        )
        let logged = [
          ...changes,
          ...s.extra.filter((c) => !echoed.has(c.name)),
          ...births,
        ]
        if (logged.length) {
          host.journal(
            s.now,
            s.actor.by ?? null,
            s.actor.via ?? null,
            s.input.trace?.fed ||
              [...s.numbered].some((eid) => !s.minted.has(eid))
              ? JSON.stringify({
                ...(s.input.trace?.fed
                  ? { created: [...s.created], removed: [...s.removed] }
                  : {}),
                numbered: [...s.numbered].filter((eid) => !s.minted.has(eid)),
              })
              : null,
            logged,
          )
        }
        return bundles
      },
    },
  }
  let policy: StampPolicy = (b) => {
    let s = current(), eid = b.entity.eid
    if (dead(b) || gone(eid)) return null
    let kind: 'created' | 'updated' | null = s.minted.has(eid)
      ? 'created'
      : s.touched.has(eid)
      ? 'updated'
      : null
    if (!kind) return null
    let said = s.authors.get(`${kind} ${eid}`)
    return {
      kind,
      by: said && 'by' in said ? said.by as string | null : s.actor.by ?? null,
      via: s.actor.via ?? null,
    }
  }
  return {
    plugin,
    policy,
    input: () => current().input,
    now: () => current().now,
    capture: {
      name: 'fleet/authorship',
      hooks: {
        precondition: (bundles: Bundle[]) => {
          current().numbered = new Set(
            bundles.filter((b) => b.$num === true).map((b) => b.entity.eid),
          )
          // Only death or a claim operation can release a prior holder. Take
          // its ordered history before any write, including session retargets
          // earlier in the same batch, but do not scan claims on document edits.
          if (bundles.some((b) => dead(b) || b.claim !== undefined)) {
            current().prior = priorClaimsOf(host)
          }
          for (let b of bundles) {
            for (let name of ['created', 'updated']) {
              let comp = b[name] as Comp | undefined
              if (comp && 'by' in comp) {
                current().authors.set(`${name} ${b.entity.eid}`, comp)
              }
            }
          }
          return resolve(bundles)
        },
      },
    } satisfies Plugin,
    run: <T>(
      input: FleetWrite,
      opts: ApplyOpts | undefined,
      fn: (opts: ApplyOpts) => T,
    ): T => {
      let now = opts?.now ?? new Date().toISOString()
      let s = state(input, now, opts?.now !== undefined)
      stack.push(s)
      try {
        let out = fn({ ...opts })
        if (!opts?.check && input.trace) {
          let trace = input.trace
          host.afterCommit(() => {
            for (let c of s.created) trace.created.add(c)
            for (let [eid, names] of s.removed) {
              trace.removed.set(eid, [
                ...(trace.removed.get(eid) ?? []),
                ...names,
              ])
            }
          })
        }
        return out
      } finally {
        stack.pop()
      }
    },
    born: (eids: string[]) => {
      if (current()?.active) { for (let eid of eids) current().minted.add(eid) }
    },
    materialized: (bundles: Bundle[]) => {
      for (let b of bundles) {
        current().minted.add(b.entity.eid)
        for (let [name] of comps(b)) {
          current().created.add(`${name} ${b.entity.eid}`)
        }
      }
    },
    found: (eids: string[], bundles: Bundle[]) => {
      let found = current().found
      for (let eid of eids) found.set(eid, null)
      for (let b of bundles) found.set(b.entity.eid, b)
    },
    patch: (b: Bundle) => {
      let s = current()
      if (!s?.active) return
      let eid = b.entity.eid
      s.touched.add(eid)
      for (let [name, comp] of comps(b)) {
        let held = s.found.has(eid)
          ? s.found.get(eid)?.[name] as Comp | undefined
          : host.component(eid, name)
        if (comp == null) { if (held) took(eid, name) }
        else if (!held) s.created.add(`${name} ${eid}`)
        if ((name == 'created' || name == 'updated') && comp && 'by' in comp) {
          s.authors.set(`${name} ${eid}`, comp)
        }
        if (name == 'edge') {
          let ends = comp ? { ...held, ...comp } : held
          for (let col of ['from', 'to']) {
            if (ends?.[col]) s.touched.add(String(ends[col]))
          }
        }
        // Presence and edge endpoints only: SQL defaults remain storage's
        // truth and whole creation echoes still read them after mutation.
        if (s.found.has(eid)) {
          s.found.set(eid, {
            ...s.found.get(eid),
            entity: b.entity,
            [name]: comp == null ? null : { ...held, ...comp },
          })
        }
      }
    },
    remove: (eid: string, names: string[]) => {
      if (current()?.active) {
        current().found.set(eid, { entity: { eid }, tombstone: {} })
        for (let name of host.removalOrder()) {
          if (names.includes(name)) took(eid, name)
        }
      }
    },
    created: () => current().created,
    derived: (changes: Change[]) => current().extra.push(...changes),
  }
}
