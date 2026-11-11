// A person's private rows and aspects, and rows kept to readers holding a
// level on the app. App roles never confer ownership.
import { after } from '@yaks/fp'
import { absent, and, eq, or, present } from '@yaks/query/core'
import { actorOf as writerOf } from '@yaks/graph/provenance'
import { dead } from '@yaks/graph/bundle'
import { isPromise } from '@yaks/fp'
import type {
  Bundle,
  Comp,
  HookContext,
  Plugin,
  ReadOpts,
  ReadTx,
  Tx,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { Denied } from './deny.ts'
import { asking, top } from './asking.ts'
import { readersIn, shownIn } from './keywords.ts'
import { type Declared, kept, privacy } from './privacy.ts'
import { type Level, LEVELS, stands } from './words.ts'

/** Component → owner: `entity` keeps just this aspect private on the person's
 * entity; a local reference property makes the entire entity private. */
export type Personal = Record<string, string>

/** Derived component → reference property whose source owns its visibility. */
export type PersonalSources = Record<string, string>

// Component → owner as the vocabulary declares it, then as the host overrides.
let said = (
  vocab: Vocab,
  overrides: Personal,
): Record<string, unknown> => ({
  ...Object.fromEntries(vocab.all.flatMap((name) => {
    let owner = vocab.comp(name)?.keywords.personal
    return owner === undefined ? [] : [[name, owner]]
  })),
  ...overrides,
})

// The owner property the guide declares, offered wherever one is missing.
let BY = '{"type": "string", "ref": "entity", "death": "keep"}'

/**
 * Every `personal` declaration no row could be kept private by, as sentences
 * naming the component and what to write instead, the way @yaks/vocab's
 * `storable` answers. A deploy holding any is refused, and
 * {@link personalsIn} serves none.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab, type PropSchema } from '@yaks/vocab'
 * import { memberKeywords, unowned } from '@yaks/member'
 * let note = (by: PropSchema) =>
 *   loadVocab({
 *     $defs: {
 *       note: {
 *         component: true,
 *         type: 'object',
 *         personal: 'by',
 *         properties: { by },
 *       },
 *     },
 *   }, [memberKeywords])
 * assertEquals(unowned(note({ type: 'string', ref: 'entity', death: 'keep' })), [])
 * assertEquals(unowned(note({ type: 'string' })), [
 *   'note.personal names by, which is no reference — declare "by": ' +
 *   '{"type": "string", "ref": "entity", "death": "keep"}, or say ' +
 *   '"personal": "entity" for a component on the person\'s own entity',
 * ])
 * ```
 */
export let unowned = (vocab: Vocab, overrides: Personal = {}): string[] =>
  Object.entries(said(vocab, overrides)).flatMap(([name, owner]) => {
    if (!vocab.comp(name)) return [`${name}.personal names no component`]
    if (owner == 'entity') return []
    let prop = typeof owner == 'string' ? vocab.prop(name, owner) : undefined
    if (prop?.ref) return []
    let entity = '"personal": "entity" for a component on the person\'s own ' +
      'entity'
    return [
      typeof owner != 'string'
        ? `${name}.personal is ${JSON.stringify(owner)} — say ${entity}, or ` +
          `name a property of ${name} declared ${BY}`
        : `${name}.personal names ${owner}, which is ${
          prop ? 'no reference' : `no property of ${name}`
        } — declare "${owner}": ${BY}, or say ${entity}`,
    ]
  })

/** Read the policy declarations, refusing the vocabulary when any is no
 * owner ({@link unowned}) before a row is served. */
export let personalsIn = (vocab: Vocab, overrides: Personal = {}): Personal => {
  let errors = unowned(vocab, overrides)
  if (errors.length) throw new Error(errors.join('; '))
  return said(vocab, overrides) as Personal
}

let caller = (opts: ReadOpts) =>
  opts.person !== undefined && !opts.administrative

// The level a read carries, as the host verified it; anything else is none.
let vouched = (l: unknown): Level | null =>
  LEVELS.includes(l as Level) ? l as Level : null

/** What an entity's privacy is reckoned from (./privacy.ts), as
 * {@link personal} is given it: the vocabulary's `personal` and `readers`
 * declarations, the host's own, and what inherits its source's. */
export let declarationsOf = (
  vocab: Vocab,
  declared: Personal = {},
  through: PersonalSources = {},
): Declared => ({
  owners: Object.entries(personalsIn(vocab, declared)).filter(([, by]) =>
    by != 'entity'
  ),
  through: Object.entries(through),
  floors: Object.entries(readersIn(vocab)),
  vocab,
})

/** Protect person-owned data at reads and at every transaction write,
 * including changes made by rules and reference cascades, and keep each entity
 * wearing a component its vocabulary declares `readers` from every reader
 * below that floor. Trusted server writes and explicitly vouched
 * administrative reads are the only bypasses. */
export let personal = (
  vocab: Vocab,
  declared: Personal = {},
  through: PersonalSources = {},
): Plugin => {
  let owners = personalsIn(vocab, declared)
  let entries = Object.entries(owners)
  let inherited = Object.entries(through)
  for (let [name, prop] of inherited) {
    if (!vocab.prop(name, prop)?.ref) {
      throw new Error(
        `${name}.${prop} must reference an entity to inherit visibility`,
      )
    }
  }
  let floors = Object.entries(readersIn(vocab))
  let shown = Object.entries(shownIn(vocab))
  if (floors.some(([, asked]) => typeof asked != 'string') && !kept(vocab)) {
    // Conditions are matched where an entity's privacy is reckoned; a store
    // that keeps none could only read them by hiding the whole component.
    throw new Error('readers conditions need a vocabulary that keeps _privacy')
  }
  let asks = floors.map(([name, asked]) => ({
    name,
    ask: asking(asked, vocab),
    top: top(asked),
  }))
  // What a write's ownership is checked by, and what a read's visibility is.
  let owned = [...new Set([...Object.keys(owners), ...Object.keys(through)])]
  let comps = [...owned, ...floors.map(([name]) => name)]
  let entityOwned = entries.filter(([, by]) => by != 'entity')
  // The components that may be kept from this reader: those whose readers'
  // highest floor it does not stand on. One that asks by conditions is kept
  // whole where the store reads by its declarations, never by its privacy.
  let unseen = (opts: ReadOpts) =>
    asks.filter(({ top }) =>
      !stands(opts.person ?? null, vouched(opts.level), top)
    ).map(({ name }) => name)
  // The components this reader reads entities without: those `shown` to a
  // floor it does not stand on.
  let withheld = (opts: ReadOpts) =>
    shown.filter(([, f]) =>
      !stands(opts.person ?? null, vouched(opts.level), f)
    )
      .map(([name]) => name)
  // Whether a row is kept from this reader: by a component asking a floor it
  // does not stand on, or by another person's private one.
  let foreign = (row: Bundle, opts: ReadOpts) =>
    asks.some(({ name, ask }) => {
      let floor = row[name] != null && ask(row)
      return floor && !stands(opts.person ?? null, vouched(opts.level), floor)
    }) ||
    entityOwned.some(([name, by]) => {
      let c = row[name] as Comp | undefined
      return c && (!opts.person || c[by] != opts.person)
    })
  // The entities `who` may see: each holds no private component, or holds it
  // as theirs, and holds none kept from them.
  let mine = (who: string | null | undefined, hidden: string[]) =>
    and(
      ...hidden.map((name) => absent(name)),
      ...entityOwned.map(([name, by]) =>
        who ? or(absent(name), eq(`${name}.${by}`, who)) : absent(name)
      ),
      ...inherited.map(([name, prop]) => {
        let source = `${name}.${prop}`
        return or(
          absent(name),
          and(
            present(source),
            ...hidden.map((kept) => absent(`${source}.${kept}`)),
            ...entityOwned.map(([owner, by]) =>
              who
                ? or(
                  absent(`${source}.${owner}`),
                  eq(`${source}.${owner}.${by}`, who),
                )
                : absent(`${source}.${owner}`)
            ),
          ),
        )
      }),
    )
  // Each entity's privacy, kept where the vocabulary declares `_privacy`
  // (./privacy.ts). A store is read by it once it holds no entity whose
  // privacy is missing or stale, and by the declarations until then: asked
  // again after a write that could complete it (./privacy.ts `keeping`).
  let keeps = kept(vocab)
    ? privacy(declarationsOf(vocab, declared, through))
    : undefined
  let ready = false, asked = false
  let stored = (tx: ReadTx): boolean => {
    if (!keeps || ready) return ready
    if (asked) return false
    asked = true
    let none = keeps.current((line) => tx.read(line))
    if (isPromise(none)) {
      none.then((v) => ready ||= v, () => asked = false)
      return false
    }
    return ready = none
  }
  // The entities this reader sees: by their privacy, or by the declarations.
  let sight = (opts: ReadOpts, tx: ReadTx, hidden: string[]) =>
    stored(tx)
      ? keeps!.seen(opts.person, vouched(opts.level))
      : mine(opts.person, hidden)
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
    return after(missing.length ? tx.get(missing, owned) : [], (rows) => {
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
    reads: (opts) =>
      (entries.length > 0 || inherited.length > 0 || floors.length > 0 ||
        shown.length > 0) &&
      caller(opts),
    scope: ({ opts, tx }) => {
      if (!caller(opts)) return undefined
      let who = opts.person
      let hidden = unseen(opts), aside = withheld(opts)
      if (
        !entries.length && !inherited.length && !hidden.length && !aside.length
      ) return undefined
      return {
        entity: sight(opts, tx, hidden),
        components: Object.fromEntries([
          ...entries.filter(([, by]) => by == 'entity')
            .map(([name]) => [
              name,
              and(who ? eq('entity.eid', who) : absent('entity')),
            ]),
          // Every entity has an `entity`, so no row shows these.
          ...aside.map((name) => [name, and(absent('entity'))]),
        ]),
      }
    },
    wants: (
      bundles,
    ) => [{ eids: bundles.map((b) => b.entity.eid), comps: owned }],
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
          for (let name of owned) {
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
      let inspected: Tx = {
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
      }
      if (!keeps) return { tx: inspected, flush: (b) => b }
      return keeps.keeping(tx, inspected, () => asked = false)
    },
    // Subscription relays and coverage carry patches, whose owner need not be
    // present. Consult canonical rows instead of trusting incoming bylines.
    // Rows the store read under this scope are already what it allows.
    answer: ({ opts, tx, screened }, bundles) => {
      if (!caller(opts) || !bundles.length || screened) return bundles
      let hidden = unseen(opts), aside = withheld(opts)
      if (
        !entries.length && !inherited.length && !hidden.length && !aside.length
      ) return bundles
      return after(tx.get(bundles.map((b) => b.entity.eid), comps), (rows) => {
        let held = new Map(rows.map((b) => [b.entity.eid, b]))
        let targets = [
          ...new Set(rows.flatMap((b) =>
            inherited.flatMap(([name, prop]) => {
              let target = (b[name] as Comp | undefined)?.[prop]
              return typeof target == 'string' ? [target] : []
            })
          )),
        ]
        return after(tx.get(targets, comps), (sources) => {
          let byId = new Map(sources.map((b) => [b.entity.eid, b]))
          let visible = bundles.flatMap((b) => {
            let row = held.get(b.entity.eid)
            if (foreign(row ?? b, opts)) return []
            if (
              inherited.some(([name, prop]) => {
                let comp = (row ?? b)[name] as Comp | undefined
                if (!comp) return false
                let source = byId.get(String(comp[prop]))
                return !source || dead(source) ||
                  foreign(source, opts)
              })
            ) return []
            let out = { ...b }
            let drop = (name: string) => {
              delete out[name]
              if (row?.[name] || b[name]) {
                out.entity = { ...out.entity }
                delete out.entity.archetype
              }
            }
            for (let [name, by] of entries) {
              if (by == 'entity' && b.entity.eid != opts.person) drop(name)
            }
            for (let name of aside) drop(name)
            return [out]
          })
          if (!entityOwned.length && !inherited.length && !hidden.length) {
            return visible
          }
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
          return after(
            tx.get(targets, comps, {
              visibility: { entity: sight(opts, tx, hidden) },
            }),
            (rows) => {
              // A deleted target holds nothing left to say whose it was. Its
              // history does, so the store is asked under this scope, which sees
              // one it would have seen as it last was (@yaks/sql `ghostly`).
              let gone = rows.filter(dead).map((b) => b.entity.eid)
              let seen = gone.length
                ? tx.get(gone, [], {
                  visibility: { entity: sight(opts, tx, hidden) },
                })
                : []
              return after(seen, (seen) => {
                let allowed = new Set(
                  [
                    ...rows.filter((b) => !dead(b) && !foreign(b, opts)),
                    ...seen,
                  ]
                    .map((b) => b.entity.eid),
                )
                let retained = [
                  ...new Set(
                    visible.flatMap((b) =>
                      references(b).filter(([name, prop, eid]) =>
                        !allowed.has(eid) &&
                        vocab.prop(name, prop)?.death == 'keep'
                      ).map(([, , eid]) => eid)
                    ),
                  ),
                ]
                return after(
                  retained.length ? tx.get(retained, []) : [],
                  (local) => {
                    let present = new Set(local.map((b) => b.entity.eid))
                    return visible.map((b) => {
                      let out = b
                      for (let [name, prop, eid] of references(b)) {
                        // Retained references can name another store. A missing
                        // target carries no local private data to conceal; a
                        // target present here must still pass its visibility.
                        let external = !present.has(eid) &&
                          vocab.prop(name, prop)?.death == 'keep'
                        if (!allowed.has(eid) && !external) {
                          out = {
                            ...out,
                            [name]: { ...out[name] as Comp, [prop]: null },
                          }
                        }
                      }
                      return out
                    })
                  },
                )
              })
            },
          )
        })
      })
    },
  }
}
