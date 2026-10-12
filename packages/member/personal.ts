// A person's private rows and aspects. App roles never confer ownership.
import { after } from '@yaks/fp'
import { absent, and, eq, or } from '@yaks/query/core'
import { actorOf as writerOf } from '@yaks/graph/provenance'
import { dead } from '@yaks/graph/bundle'
import type {
  Bundle,
  Comp,
  HookContext,
  Plugin,
  ReadOpts,
  Tx,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { Denied } from './deny.ts'

/** Component → owner: `entity` keeps just this aspect private on the person's
 * entity; a local reference property makes the entire entity private. */
export type Personal = Record<string, string>

/** Validate policy declarations against the vocabulary before serving rows. */
export let personalsIn = (vocab: Vocab, overrides: Personal = {}): Personal => {
  let owners = {
    ...Object.fromEntries(vocab.all.flatMap((name) => {
      let owner = vocab.comp(name)?.keywords.personal
      return owner === undefined ? [] : [[name, owner]]
    })),
    ...overrides,
  }
  for (let [name, owner] of Object.entries(owners)) {
    if (
      !vocab.comp(name) || typeof owner != 'string' ||
      (owner != 'entity' && !vocab.prop(name, owner)?.ref)
    ) {
      throw new Error(
        `${name}.personal must name entity or a local owner reference`,
      )
    }
  }
  return owners as Personal
}

let caller = (opts: ReadOpts) =>
  opts.person !== undefined && !opts.administrative

/** Protect person-owned data at reads and at every transaction write,
 * including changes made by rules and reference cascades. Trusted server
 * writes and explicitly vouched administrative reads are the only bypasses. */
export let personal = (vocab: Vocab, declared: Personal = {}): Plugin => {
  let owners = personalsIn(vocab, declared)
  let entries = Object.entries(owners)
  let comps = Object.keys(owners)
  let entityOwned = entries.filter(([, by]) => by != 'entity')
  let foreign = (row: Bundle, person: string | null | undefined) =>
    entityOwned.some(([name, by]) => {
      let c = row[name] as Comp | undefined
      return c && (!person || c[by] != person)
    })
  let check = (
    bundles: Bundle[],
    tx: Tx,
    person: string | null,
    bind = false,
    born = new Set<string>(),
    held = new Map<string, Bundle | undefined>(),
  ) => {
    let missing = [...new Set(bundles.map((b) => b.entity.eid))]
      .filter((eid) => !held.has(eid))
    return after(missing.length ? tx.get(missing, comps) : [], (rows) => {
      for (let eid of missing) held.set(eid, undefined)
      for (let row of rows) held.set(row.entity.eid, row)
      return bundles.map((bundle) => {
        let b = bundle
        let eid = b.entity.eid
        let row = held.get(eid)
        if (!row) born.add(eid)
        for (let [name, by] of entries) {
          let was = row?.[name] as Comp | null | undefined
          let patch = b[name] as Comp | null | undefined
          let touched = Object.hasOwn(b, name)
          let refuse = () => {
            throw new Denied(person, eid, 'person', 'write', name)
          }
          if (by == 'entity') {
            if (
              (touched || was && (dead(b) ||
                    entityOwned.some(([comp]) => b[comp] != null))) &&
              (!person || eid != person)
            ) refuse()
            continue
          }
          if (was) {
            // Every aspect of a private entity belongs to its owner. Dropping
            // the ownership component could publish its other aspects.
            if (!person || was[by] != person) refuse()
            if (
              touched && (patch == null ||
                Object.hasOwn(patch, by) && patch[by] != was[by])
            ) refuse()
          } else if (patch) {
            // Private ownership is chosen at birth. An editor cannot hide an
            // existing public person or game row by claiming its identity.
            if (
              row && !born.has(eid) && !entityOwned.some(([comp]) => row[comp])
            ) refuse()
            if (!person || patch[by] != null && patch[by] != person) refuse()
            if (patch[by] == null) {
              if (!bind) refuse()
              b = { ...b, [name]: { ...patch, [by]: person } }
            }
          }
        }
        return b
      })
    })
  }
  return {
    name: '@yaks/member/personal',
    admission: () => true,
    reads: (opts) => entries.length > 0 && caller(opts),
    scope: ({ opts }) => {
      if (!entries.length || !caller(opts)) return undefined
      let who = opts.person
      return {
        entity: and(
          ...entityOwned.map(([name, by]) =>
            who ? or(absent(name), eq(`${name}.${by}`, who)) : absent(name)
          ),
        ),
        components: Object.fromEntries(
          entries.filter(([, by]) => by == 'entity')
            .map(([name]) => [
              name,
              and(who ? eq('entity.eid', who) : absent('entity')),
            ]),
        ),
      }
    },
    wants: (bundles) => [{ eids: bundles.map((b) => b.entity.eid), comps }],
    authorize: (bundles, tx, _error, context) =>
      context?.trusted || !entries.length
        ? bundles
        : check(bundles, tx, writerOf(bundles).by ?? null, true),
    track: (tx, found, context?: HookContext) => {
      let by = writerOf(context?.bundles ?? []).by ?? null
      let born = new Set<string>()
      // All writes cross this tracker. Retain the ownership state it has
      // checked, including known absence, for later writes in this transaction.
      let held = new Map<string, Bundle | undefined>()
      for (let b of context?.bundles ?? []) {
        let row = found(b.entity.eid)
        if (row !== undefined) held.set(b.entity.eid, row ?? undefined)
      }
      let remember = (bundles: Bundle[]) => {
        for (let b of bundles) {
          let eid = b.entity.eid
          if (dead(b)) {
            held.delete(eid)
            born.delete(eid)
            continue
          }
          let row = { ...(held.get(eid) ?? { entity: b.entity }) }
          for (let name of comps) {
            if (!Object.hasOwn(b, name)) continue
            let patch = b[name] as Comp | null
            if (patch == null) delete row[name]
            else row[name] = { ...row[name] as Comp | undefined, ...patch }
          }
          held.set(eid, row)
        }
      }
      let inspect = (b: Bundle[]) =>
        context?.trusted || !entries.length
          ? b
          : check(b, tx, by, false, born, held)
      return {
        tx: {
          ...tx,
          patch: (bundles) =>
            after(
              inspect(bundles),
              (checked) =>
                after(tx.patch(checked), (made) => {
                  remember(checked)
                  return made
                }),
            ),
          remove: (entities) =>
            after(
              inspect(entities.map((entity) => ({ entity, $delete: true }))),
              () =>
                after(tx.remove(entities), (removed) => {
                  for (let { eid } of entities) {
                    held.delete(eid)
                    born.delete(eid)
                  }
                  return removed
                }),
            ),
        },
        flush: (b) => b,
      }
    },
    // Subscription relays and coverage carry patches, whose owner need not be
    // present. Consult canonical rows instead of trusting incoming bylines.
    answer: ({ opts, tx }, bundles) => {
      if (!caller(opts) || !bundles.length) return bundles
      return after(tx.get(bundles.map((b) => b.entity.eid), comps), (rows) => {
        let held = new Map(rows.map((b) => [b.entity.eid, b]))
        let visible = bundles.flatMap((b) => {
          let row = held.get(b.entity.eid)
          if (foreign(row ?? b, opts.person)) return []
          let out = { ...b }
          for (let [name, by] of entries) {
            if (by == 'entity' && b.entity.eid != opts.person) {
              delete out[name]
              if (row?.[name] || b[name]) {
                out.entity = { ...out.entity }
                delete out.entity.archetype
              }
            }
          }
          return [out]
        })
        if (!entityOwned.length) return visible
        let references = (b: Bundle) =>
          Object.entries(b).flatMap(([name, value]) => {
            if (
              name == 'entity' || !value || typeof value != 'object' ||
              !vocab.comp(name)
            ) return []
            let c = value as Comp
            return vocab.props(name).flatMap((prop) =>
              vocab.prop(name, prop)?.category == 'ref' &&
                typeof c[prop] == 'string'
                ? [[name, prop, c[prop] as string]]
                : []
            )
          })
        let targets = [
          ...new Set(
            visible.flatMap((b) => references(b).map(([, , eid]) => eid)),
          ),
        ]
        if (!targets.length) return visible
        return after(tx.get(targets, comps), (rows) => {
          let allowed = new Set(
            rows.filter((b) => !dead(b) && !foreign(b, opts.person)).map((b) =>
              b.entity.eid
            ),
          )
          return visible.map((b) => {
            let out = b
            for (let [name, prop, eid] of references(b)) {
              if (!allowed.has(eid)) {
                out = {
                  ...out,
                  [name]: { ...out[name] as Comp, [prop]: null },
                }
              }
            }
            return out
          })
        })
      })
    },
  }
}
