// Building: one session opened on a builder, and the output it will answer
// into, minted under the key that names it.
//
// A builder is an instruction (its `doc` body) plus its inputs (the far ends
// of its `reads` links), and it builds one output. The output is an entity
// wearing `built{builder, key, model, session}`, whose id is derived from the
// builder and the key. So before anything runs, the key is computed and the
// output it names is looked up: if it exists, the output already built still
// answers and nothing runs. A changed key names an output that does not exist
// yet, and that one is built from scratch by a fresh session that is never
// shown the old one.
//
// The model is part of the key, so the same builder built by two models gives
// two sibling outputs. A builder's own outputs are never among its inputs,
// even when it links to one: what it built last time is not something it may
// build from.
//
// The output is minted when its session opens, empty, which is also what keeps
// a builder to one session per key: a second trigger finds the output and does
// nothing. The write carries `$was` on the output's key, so two triggers racing
// to mint it cannot both commit.
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
  TOMBSTONE,
  type Tx,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { and, eq, present } from '@yaks/query'
import { BODY, DOC } from '@yaks/doc'
import { EDGE, link } from '@yaks/edge'
import { next } from '@yaks/wake'
import { content, type Input, key } from './key.ts'

/** The components this package declares. */
export let BUILDER = 'builder'
export let BUILT = 'built'

/** The relation a builder's inputs hang off: @yaks/kernel's `reads`. */
export let READS = 'reads'

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
}

/** One build, worked out: what it asks, what it reads, the key those make
 * with the model, and the output that key names. */
export type Plan = {
  builder: Eid
  instruction: string
  model: string
  inputs: Eid[]
  key: string
  output: Eid
}

/** What building a builder now comes to: its plan, and the bundles that build
 * it — absent when the output under its key is built already. */
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

/** The id of the output a builder builds under a key. */
export let output = (builder: Eid, k: string): Eid =>
  identityEid(BUILT, [builder, k])

/**
 * A builder's inputs as its key reads them: the far end of every `reads` link
 * leaving it, with its content hash — less any output of the builder itself,
 * which it never reads, and anything deleted.
 */
export let inputs = (
  tx: Tx,
  vocab: Vocab,
  builder: Eid,
): Input[] | Promise<Input[]> =>
  then(tx.read(and(eq(`${EDGE}.from`, builder), present(READS))), (links) => {
    let far = [...new Set(links.map((b) => str(comp(b, EDGE), 'to')))]
      .filter(Boolean)
    if (!far.length) return []
    let hash = content(vocab)
    return then(tx.get(far), (found) =>
      found
        .filter((b) =>
          b[TOMBSTONE] == null && str(comp(b, BUILT), 'builder') != builder
        )
        .map((b): Input => [b.entity.eid, hash(b)]))
  })

/** The plan for building `it` with the desk's model, or `undefined` when there
 * is no instruction to ask. */
export let plan = (
  o: Open,
  it: Bundle,
  tx: Tx,
): Plan | undefined | Promise<Plan | undefined> => {
  let instruction = str(comp(it, DOC), BODY) || o.desk.ask || ''
  if (!instruction) return undefined
  let builder = it.entity.eid
  let model = o.desk.model ?? ''
  return then(inputs(tx, o.vocab, builder), (read) => {
    let k = key(instruction, model, read)
    return {
      builder,
      instruction,
      model,
      inputs: read.map(([eid]) => eid).toSorted(),
      key: k,
      output: output(builder, k),
    }
  })
}

// What the session is asked: the instruction, then its inputs by id, which it
// reads for itself.
let words = (p: Plan): string =>
  p.inputs.length
    ? `${p.instruction}\n\nInputs:\n${p.inputs.map((e) => `- ${e}`).join('\n')}`
    : p.instruction

/**
 * The bundles that build a plan: the session, its first entry asking the
 * instruction, the persona edge, the output it will answer into — minted only
 * if nothing minted it first — and, with a rest configured, the builder's floor
 * moved forward.
 *
 * A pure function, so a test can assert on it with no graph involved.
 */
export let build = (p: Plan, o: Open, at: string = clock()): Bundle[] => {
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
        key: p.key,
        ...(p.model ? { model: p.model } : {}),
        session,
      },
      $was: { [BUILT]: { key: null } },
    },
    ...(floor ? [{ entity: { eid: p.builder }, [BUILDER]: { floor } }] : []),
  ]
}

/**
 * What building `eid` at `at` comes to, read against the graph as it stands:
 * nothing when it is no builder, has no instruction, or — on a schedule — is
 * still resting; otherwise its plan, with the bundles that build it unless the
 * output under its key exists already. A deleted output counts as existing:
 * building it again would bring back what someone deleted, so only a new key
 * builds again.
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
    return then(plan(o, it, tx), (p) =>
      !p ? undefined : then(
        tx.get([p.output]),
        (have): Verdict =>
          have.length ? { plan: p } : { plan: p, build: build(p, o, at) },
      ))
  })
