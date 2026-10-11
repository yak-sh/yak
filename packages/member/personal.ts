// A person's private rows and aspects. App roles never confer ownership.
import { after } from '@yaks/fp'
import { absent, and, eq, or } from '@yaks/query/core'
import { actorOf as writerOf, dead } from '@yaks/graph'
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
  let check = (
    bundles: Bundle[],
    tx: Tx,
    person: string | null,
    bind = false,
  ) =>
    after(tx.get(bundles.map((b) => b.entity.eid), comps), (rows) => {
      let held = new Map(rows.map((b) => [b.entity.eid, b]))
      return bundles.map((bundle) => {
        let b = bundle
        let eid = b.entity.eid
        let row = held.get(eid)
        for (let [name, by] of entries) {
          let was = row?.[name] as Comp | null | undefined
          let patch = b[name] as Comp | null | undefined
          let touched = Object.hasOwn(b, name)
          let refuse = () => {
            throw new Denied(person, eid, 'person', 'write', name)
          }
          if (by == 'entity') {
            if (
              (touched || dead(b) && was) && (!person || eid != person)
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
    track: (tx, _found, context?: HookContext) => {
      let by = writerOf(context?.bundles ?? []).by ?? null
      let inspect = (b: Bundle[]) =>
        context?.trusted || !entries.length ? b : check(b, tx, by)
      return {
        tx: {
          ...tx,
          patch: (bundles) =>
            after(inspect(bundles), (checked) => tx.patch(checked)),
          remove: (entities) =>
            after(
              inspect(entities.map((entity) => ({ entity, $delete: true }))),
              () => tx.remove(entities),
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
        return bundles.flatMap((b) => {
          let row = held.get(b.entity.eid)
          if (
            entityOwned.some(([name, by]) => {
              let c = (row ? row[name] : b[name]) as Comp | undefined
              return c && c[by] != opts.person
            })
          ) return []
          let out = { ...b }
          for (let [name, by] of entries) {
            if (by == 'entity' && b.entity.eid != opts.person) delete out[name]
          }
          return [out]
        })
      })
    },
  }
}
