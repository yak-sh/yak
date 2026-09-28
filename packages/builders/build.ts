// A builder selects graph inputs with a query. A run records the key and
// session for one variant; that session writes named outputs in answer.ts.
// The key is the instruction, model and selected content, so the same key
// opens nothing and a changed one starts a fresh session.

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
import { BODY, DOC } from '@yaks/doc'
import { link } from '@yaks/edge'
import { content } from '@yaks/kernel'
import { statusOf } from '@yaks/session'
import { next } from '@yaks/wake'
import { type Input, key } from './key.ts'

export let BUILDER = 'builder'
export let BUILD = 'build'
export let BUILT = 'built'

// A build writes session and entry components owned by @yaks/session. The
// persona is linked through @yaks/kernel's references relation.
export let SESSION = 'session'
export let ENTRY = 'entry'
export let CONTENT = 'content'
export let USING = 'using'
export let REFERENCES = 'references'

export type Desk = {
  provider?: string
  model?: string
  effort?: string
  persona?: string
  actor?: string
  ask?: string
}

export type Options = {
  desk?: Desk
  /** @yaks/wake recurrence; omitted means the key alone guards builds. */
  rest?: string
}

export type Open = Options & {
  desk: Desk
  vocab: Vocab
  now?: () => string
  eid?: () => string
  /** alternate model/provider/prompt runs beside the primary variant */
  shadow?: string
  prompt?: string
  model?: string
  provider?: string
}

export type Plan = {
  builder: Eid
  instruction: string
  model: string
  provider?: string
  format: 'json' | 'artifact'
  inputs: Bundle[]
  key: string
  variant: string
  run: Eid
}

export type Verdict = { plan: Plan; build?: Bundle[] }

export let clock = (): string => new Date().toISOString()
let uuid = () => crypto.randomUUID() as string

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined
let str = (c: Comp | undefined, k: string): string =>
  c?.[k] == null ? '' : String(c[k])

/** A schedule may build when its floor has passed or is absent. */
export let due = (builder: Comp | undefined, at: string): boolean => {
  let floor = Date.parse(str(builder, 'floor'))
  return Number.isNaN(floor) || floor <= Date.parse(at)
}

/** Stable ids for one variant's run and each of its named outputs. */
export let run = (builder: Eid, variant = 'main'): Eid =>
  identityEid(BUILD, [builder, variant])
export let output = (
  builder: Eid,
  slot = 'main',
  variant = 'main',
): Eid => identityEid(BUILT, [builder, variant, slot])

/** Query-selected inputs, excluding this builder, its outputs, and shadows. */
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
        (!comp(b, BUILT) || str(comp(b, BUILT), 'variant') == 'main')
      ).toSorted((a, b) =>
        a.entity.eid < b.entity.eid ? -1 : a.entity.eid > b.entity.eid ? 1 : 0
      ),
  )
}

/** The run this builder would start now. */
export let plan = (
  o: Open,
  it: Bundle,
  tx: Tx,
): Plan | undefined | Promise<Plan | undefined> => {
  let instruction = o.prompt || str(comp(it, DOC), BODY) || o.desk.ask || ''
  if (!instruction) return undefined
  let builder = it.entity.eid
  let model = o.model ?? (str(comp(it, BUILDER), 'model') || o.desk.model || '')
  let provider = o.provider ??
    (model == o.desk.model ? o.desk.provider : undefined)
  let format: Plan['format'] = str(comp(it, BUILDER), 'format') == 'artifact'
    ? 'artifact'
    : 'json'
  let variant = o.shadow ?? 'main'
  return then(inputs(tx, it), (read) => {
    if (format == 'artifact' && !read.length) return undefined
    if (format == 'artifact' && read.length > 1) {
      throw new Error('an artifact builder selects more than one input')
    }
    return ({
      builder,
      instruction,
      model,
      provider,
      format,
      inputs: read,
      key: key(
        format == 'artifact' ? `artifact\0${instruction}` : instruction,
        model,
        read.map((b): Input => [b.entity.eid, content(o.vocab)(b)]),
      ),
      variant,
      run: run(builder, variant),
    })
  })
}

// The instruction asks for one graph-shaped answer with stable output slots.
let words = (p: Plan): string =>
  p.format == 'artifact'
    ? [p.instruction, ...p.inputs.map((b) => str(comp(b, DOC), BODY))]
      .filter(Boolean).join('\n\n')
    : `${p.instruction}\n\nInputs:\n${
      p.inputs.map((b) => `- ${b.entity.eid}`).join('\n') || '(none)'
    }\n\nReturn only JSON in this shape: ` +
      '{"outputs":[{"slot":"stable-name","inputs":["input-id"],' +
      '"components":{"doc":{"title":"Example"}}}]}. ' +
      'Each slot names the same thing across runs. Each output lists only the ' +
      'selected input ids it used. Put its own graph components under components.'

/** Open one session and record its key and selected inputs atomically. */
export let build = (
  p: Plan,
  o: Open,
  at: string = clock(),
  prior: Comp | undefined = undefined,
): Bundle[] => {
  let d = o.desk
  let eid = o.eid ?? uuid
  let session = eid()
  let using: Comp = {
    ...(p.provider ? { provider: p.provider } : {}),
    ...(p.model ? { model: p.model } : {}),
    ...(d.effort ? { effort: d.effort } : {}),
  }
  let floor = o.rest ? next(o.rest, Date.parse(at)) : null
  return [
    { entity: { eid: session }, [SESSION]: d.actor ? { actor: d.actor } : {} },
    {
      entity: { eid: eid() },
      [ENTRY]: { session, seq: 1 },
      [CONTENT]: { body: words(p) },
      ...(Object.keys(using).length ? { [USING]: using } : {}),
    },
    ...(d.persona ? [link(session, REFERENCES, d.persona)] : []),
    {
      entity: { eid: p.run },
      [BUILD]: {
        builder: p.builder,
        variant: p.variant,
        key: p.key,
        ...(p.model ? { model: p.model } : {}),
        session,
        inputs: p.inputs.map((b) => b.entity.eid),
        prompt: words(p),
      },
      $was: {
        [BUILD]: {
          key: token(prior?.key),
          session: token(prior?.session),
        },
      },
    },
    ...(floor ? [{ entity: { eid: p.builder }, [BUILDER]: { floor } }] : []),
  ]
}

/** Start a run only when its key differs from the last one. */
export let decide = (
  o: Open,
  eid: Eid,
  tx: Tx,
  at: string,
  scheduled = true,
  retryFailed = false,
): Verdict | undefined | Promise<Verdict | undefined> =>
  then(tx.get([eid]), ([it]) => {
    let b = comp(it, BUILDER)
    if (!it || !b || (scheduled && !due(b, at))) return undefined
    return then(
      plan(o, it, tx),
      (p) =>
        !p ? undefined : then(tx.get([p.run]), ([have]) => {
          if (have?.[TOMBSTONE]) return { plan: p }
          let prior = comp(have, BUILD)
          let session = str(prior, 'session')
          let same = str(prior, 'key') == p.key
          if (!same) return { plan: p, build: build(p, o, at, prior) }
          if (!session || !retryFailed) return { plan: p }
          return then(tx.read(`.entry.session=${session}&*`), (entries) =>
            statusOf(entries) == 'failed'
              ? { plan: p, build: build(p, o, at, prior) }
              : { plan: p })
        }),
    )
  })
