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
  priorClaimsOf,
  syncFacetAliases,
} from './fleet_lifecycle.ts'
import { asBundle, asChanges } from './wire.ts'

export type FleetWrite = {
  writer?: string | null
  trace?: Trace
  imports?: Map<string, { source: string; line: number }>
}
export type StampHost = LifecycleHost & {
  actor: (writer?: string | null) => string | null
  via: (writer?: string | null) => string | null
  number: (eid: string) => void
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
  let state = (input: FleetWrite, now: string) => ({
    input,
    now,
    active: false,
    actor: {} as Actor,
    prior: priorClaimsOf(host),
    minted: new Set<string>(),
    touched: new Set<string>(),
    created: new Set<string>(),
    removed: new Map<string, string[]>(),
    authors: new Map<string, Comp>(),
    operations: [] as Change[],
    extra: [] as Change[],
  })
  let current = () => stack.at(-1)!
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
      // Registered after the rollback-only rehearsal. From here on adapter
      // writes are real mutation/cascade operations, not guard simulations.
      precondition: (bundles) => {
        current().active = true
        return resolve(bundles)
      },
      cascade: (bundles) => {
        let s = current()
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
        for (let eid of s.minted) host.number(eid)
        syncFacetAliases(host, s.operations, s.extra)
        lifecycleBefore(host, batch(), s.prior)
        let out = resolve(bundles)
        // Edge endpoints can be news without a component patch of their own.
        for (let eid of new Set([...s.minted, ...s.touched])) {
          if (!out.some((b) => b.entity.eid == eid)) {
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
          if (host.component(eid, 'tombstone')) continue
          let name = s.minted.has(eid) ? 'created' : 'updated'
          let comp = host.component(eid, name)
          if (comp) provenance.push({ eid, name, comp })
        }
        return [
          ...bundles,
          ...s.extra.map(asBundle),
          ...provenance.map(asBundle),
          ...[...s.minted].flatMap((eid) => {
            if (host.component(eid, 'tombstone')) return []
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
        let changes = s.operations.map((c, i) => {
          let key = `${c.name} ${c.eid}`
          if (!c.comp || !s.created.has(key) || last.get(key) != i) return c
          // The final creation echo is writable-only (provided by fleetGraph).
          let full = bundles.findLast((b) =>
            b.entity.eid == c.eid && b.$fleetWhole == c.name
          )
          return full ? { ...c, comp: full[c.name] as Comp } : c
        })
        let births = [...s.minted].flatMap((eid) => {
          if (host.component(eid, 'tombstone')) return []
          let comp = host.component(eid, 'entity')
          return comp ? [{ eid, name: 'entity', comp }] : []
        })
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
            s.input.trace?.fed
              ? JSON.stringify({
                created: [...s.created],
                removed: [...s.removed],
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
    if (dead(b) || host.component(eid, 'tombstone')) return null
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
    capture: {
      name: 'fleet/authorship',
      hooks: {
        precondition: (bundles: Bundle[]) => {
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
      let s = state(input, now)
      stack.push(s)
      try {
        let out = fn({ ...opts, now })
        if (!opts?.check && input.trace) {
          for (let c of s.created) input.trace.created.add(c)
          for (let [eid, names] of s.removed) {
            input.trace.removed.set(eid, [
              ...(input.trace.removed.get(eid) ?? []),
              ...names,
            ])
          }
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
    patch: (b: Bundle) => {
      let s = current()
      if (!s?.active) return
      let eid = b.entity.eid
      s.touched.add(eid)
      for (let [name, comp] of comps(b)) {
        let held = host.component(eid, name)
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
      }
    },
    remove: (eid: string, names: string[]) => {
      if (current()?.active) {
        for (let name of host.removalOrder()) {
          if (names.includes(name)) took(eid, name)
        }
      }
    },
    created: () => current().created,
  }
}
