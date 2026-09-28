// Building: a builder's query selects its inputs, and one stable output answers.
// The output cites the inputs used for its latest build. Its key changes when
// the instruction, model, or selected content changes; its identity does not.
// An explicit alternate desk gets a separate shadow output for comparison.
// The output's key carries a precondition so concurrent triggers cannot both
// open a session for the same version.
//
// When is the schedule's decision: `floor` is the earliest a schedule may build
// the builder again, and a configured `rest` moves it forward each time a
// session opens. On demand ignores the floor. What gets opened is not decided
// here: the configuration names the session (a provider, a model, an effort, a
// persona, an actor), and this module writes it. No process is launched — what
// runs sessions on this machine runs it.

import {
  type Bundle,
  type Comp,
  type Eid,
  identityEid,
  then,
  token,
  TOMBSTONE,
  type Tx,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { and, eq, present } from '@yaks/query'
import { BODY, DOC } from '@yaks/doc'
import { EDGE, link, unlink } from '@yaks/edge'
import { content, verify } from '@yaks/kernel'
import { next } from '@yaks/wake'
import { type Input, key } from './key.ts'

/** The components this package declares. */
export let BUILDER = 'builder'
export let BUILT = 'built'

// The components a build is written with, which belong to other packages: the
// session and its entries are @yaks/session's, and the persona is linked
// through @yaks/kernel's `references` relation. This package writes them but
// declares none of them, so composing it without those vocabularies is refused
// by the vocabulary loader, not here.
export let SESSION = 'session'
export let ENTRY = 'entry'
export let CONTENT = 'content'
export let USING = 'using'
export let REFERENCES = 'references'

/** The session a build opens, as the configuration names it. Every field
 * comes from the configuration: nothing here has a default worth guessing. */
export type Desk = {
  /** the provider entity the first entry asks */
  provider?: string
  /** the model entity it asks for, and the one the key is taken with */
  model?: string
  /** the reasoning effort it asks at */
  effort?: string
  /** the persona it runs with, linked by a `references` edge */
  persona?: string
  /** the identity the session writes as */
  actor?: string
  /** the instruction for a builder that has no body text of its own */
  ask?: string
}

/** The configuration this plugin accepts. */
export type Options = {
  /** the session a build opens; omitted, nothing builds */
  desk?: Desk
  /** how long a builder rests once a session opens — a @yaks/wake recurrence
   * (`1h`, `@daily`, `0 9 * * 1-5`). Omitted, the floor is left where it is
   * and the key is the only guard. */
  rest?: string
}

/** Everything a build needs: the configuration, and the vocabulary an input's
 * content is read against. */
export type Open = Options & {
  desk: Desk
  vocab: Vocab
  /** the clock, injected so a test can hold it still (default: now) */
  now?: () => string
  /** where a new eid comes from (default: a uuid) */
  eid?: () => string
  /** an explicit alternate desk builds a sibling, not the primary output */
  shadow?: string
  /** an alternate instruction for a shadow build */
  prompt?: string
}

/** One build, worked out: its instruction, selected inputs, key, and output. */
export type Plan = {
  builder: Eid
  instruction: string
  model: string
  inputs: Bundle[]
  key: string
  output: Eid
  slot: string
}

/** What building a builder now comes to; `build` is absent for a current key. */
export type Verdict = { plan: Plan; build?: Bundle[] }

export let clock = (): string => new Date().toISOString()
let uuid = () => crypto.randomUUID() as string

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let str = (c: Comp | undefined, k: string): string =>
  c?.[k] == null ? '' : String(c[k])

/** Whether a schedule may build at time `at`: the builder has no floor, or its
 * floor has passed. A floor that cannot be parsed counts as no floor — a
 * builder is not held back by a date nothing can read. */
export let due = (builder: Comp | undefined, at: string): boolean => {
  let floor = Date.parse(str(builder, 'floor'))
  return Number.isNaN(floor) || floor <= Date.parse(at)
}

/** The primary output's id, or a shadow's stable id under its slot. */
export let output = (builder: Eid, slot = 'main'): Eid =>
  identityEid(BUILT, [builder, slot])

/**
 * The builder's query selects its inputs. The builder itself and its own
 * outputs are excluded so a build cannot trigger itself by changing its floor
 * or answer.
 */
export let inputs = (
  tx: Tx,
  it: Bundle,
): Bundle[] | Promise<Bundle[]> => {
  let query = str(comp(it, BUILDER), 'query')
  if (!query) return []
  return then(
    tx.read(query),
    (found) =>
      found.filter((b) =>
        b.entity.eid != it.entity.eid && b[TOMBSTONE] == null &&
        str(comp(b, BUILT), 'builder') != it.entity.eid &&
        (!comp(b, BUILT) || str(comp(b, BUILT), 'slot') == 'main')
      ).toSorted((a, b) =>
        a.entity.eid < b.entity.eid ? -1 : a.entity.eid > b.entity.eid ? 1 : 0
      ),
  )
}

/** The plan for building `it` with the desk's model, or `undefined` when there
 * is no instruction to ask. */
export let plan = (
  o: Open,
  it: Bundle,
  tx: Tx,
): Plan | undefined | Promise<Plan | undefined> => {
  let instruction = o.prompt || str(comp(it, DOC), BODY) || o.desk.ask || ''
  if (!instruction) return undefined
  let builder = it.entity.eid
  let model = o.desk.model ?? ''
  return then(inputs(tx, it), (read) => {
    let hash = content(o.vocab)
    let k = key(
      instruction,
      model,
      read.map((b): Input => [b.entity.eid, hash(b)]),
    )
    return {
      builder,
      instruction,
      model,
      inputs: read,
      key: k,
      slot: o.shadow ?? 'main',
      output: output(builder, o.shadow),
    }
  })
}

// What the session is asked: the instruction, then its inputs by id, which it
// reads for itself.
let words = (p: Plan): string =>
  p.inputs.length
    ? `${p.instruction}\n\nInputs:\n${
      p.inputs.map((b) => `- ${b.entity.eid}`).join('\n')
    }`
    : p.instruction

/**
 * The bundles that build a plan: the session, its first entry asking the
 * instruction, the persona edge, an output update, its current citations, and
 * (with a rest configured) the builder's floor moved forward.
 *
 * A pure function, so a test can assert on it with no graph involved.
 */
export let build = (
  p: Plan,
  o: Open,
  at: string = clock(),
  prior: string | null = null,
  uncite: Eid[] = [],
): Bundle[] => {
  let d = o.desk
  let eid = o.eid ?? uuid
  let session = eid()
  let using: Comp = {
    ...(d.provider ? { provider: d.provider } : {}),
    ...(p.model ? { model: p.model } : {}),
    ...(d.effort ? { effort: d.effort } : {}),
  }
  let floor = o.rest ? next(o.rest, Date.parse(at)) : null
  return [
    {
      entity: { eid: session },
      [SESSION]: d.actor ? { actor: d.actor } : {},
    },
    {
      entity: { eid: eid() },
      [ENTRY]: { session, seq: 1 },
      [CONTENT]: { body: words(p) },
      ...(Object.keys(using).length ? { [USING]: using } : {}),
    },
    ...(d.persona ? [link(session, REFERENCES, d.persona)] : []),
    {
      entity: { eid: p.output },
      [BUILT]: {
        builder: p.builder,
        slot: p.slot,
        key: p.key,
        ...(p.model ? { model: p.model } : {}),
        session,
      },
      $was: { [BUILT]: { key: token(prior) } },
    },
    ...p.inputs.map((b) => {
      let cite = link(p.output, 'cites', b.entity.eid)
      return { ...cite, ...verify(cite, b, o.vocab) }
    }),
    ...uncite.map((to) => ({
      ...unlink(p.output, 'cites', to),
      verified: null,
    })),
    ...(floor ? [{ entity: { eid: p.builder }, [BUILDER]: { floor } }] : []),
  ]
}

/**
 * What building `eid` at `at` comes to, read against the graph as it stands:
 * nothing when it is no builder, has no instruction, or — on a schedule — is
 * still resting; otherwise its plan, with the bundles that build it unless the
 * output already carries this key. A deleted output remains deleted.
 */
export let decide = (
  o: Open,
  eid: Eid,
  tx: Tx,
  at: string,
  scheduled = true,
): Verdict | undefined | Promise<Verdict | undefined> =>
  then(tx.get([eid]), (found) => {
    let it = found[0]
    let b = comp(it, BUILDER)
    if (!it || !b || (scheduled && !due(b, at))) return undefined
    return then(
      plan(o, it, tx),
      (p) =>
        !p ? undefined : then(tx.get([p.output]), ([have]) => {
          if (have?.[TOMBSTONE] || str(comp(have, BUILT), 'key') == p.key) {
            return { plan: p }
          }
          return then(
            tx.read(and(eq(`${EDGE}.from`, p.output), present('cites'))),
            (edges): Verdict => {
              let current = new Set(p.inputs.map((b) => b.entity.eid))
              let uncite = edges.map((b) => str(comp(b, EDGE), 'to'))
                .filter((eid) => eid && !current.has(eid))
              return {
                plan: p,
                build: build(
                  p,
                  o,
                  at,
                  str(comp(have, BUILT), 'key') || null,
                  uncite,
                ),
              }
            },
          )
        }),
    )
  })
