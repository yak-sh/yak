// What an Operator writes outside a conversation, a call's notes and any
// summary, report or transcript it makes off the chat, is a doc of its own
// in the space's store: `doc{title, body}`, wearing `output{source}` for the
// request it answers, which names its source (a call's notes request names
// the line where the call began, `operator_request.about`). Search finds it
// like any doc, and the person's Update only points to it
// (`notification{about}`), so dismissing the Update loses nothing.
//
// Whose it is follows whom it was written for: one person's (a phone call's
// caller) is written in their conversation, which makes it theirs
// (./operator-owner.ts `MADE`); the space's (a voice room's) is written in
// none, and is everyone's in it.
//
// Notes kept before were only an Update's words: `madeBackfill` moves each
// into its doc in bounded alarm batches, and points the Update to it.
//
// A call shows in its conversation where it began, as a line naming how
// long it went on, which opens its notes (`callsOf`).
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { derivedEid } from '@yaks/graph/identity'
import { line, sub } from '@yaks/query'

/** The doc an answer is kept as, by the answer's eid. */
export let madeOf = (answer: string): string =>
  derivedEid('operator-made|' + answer)

/** The Update the answer to a request on a channel answered in Updates was
 * told as, by the answer's eid (operator-updates.ts `notification`'s `id`). */
export let toldOf = (answer: string): string =>
  derivedEid('operator-told|' + answer)

/** What the Update pointing to a doc says, below its subject. */
export let POINTED =
  'I kept them in the space, where I can find them for you any time.'

/** What an Operator made off the chat, as a doc. */
export type Made = {
  /** the answer its words are, which names it (`madeOf`) */
  answer: string
  /** the request it answers, which names its source */
  request: string
  title: string
  body: string
  /** whose it is: a person's conversation, or none for the space's */
  via?: string
  /** the space, which wrote it */
  by: string
}

/** Whether `b` is a doc an Operator made off the chat: a doc that is a
 * model's answer to a request. */
export let isMade = (b: Bundle): boolean => !!b.doc && !!b.output

/** A doc's row. */
export let madeDoc = (
  { answer, request, title, body, via, by }: Made,
): Bundle => ({
  entity: { eid: madeOf(answer) },
  doc: { title, body },
  output: { source: request },
  $actor: { by, ...via ? { via } : {} },
})

/** Where an Operator store says its notes kept as Updates are docs: the
 * newest request moved, while the pass goes on, then `done`. */
export let MADE_DOCS = 'operator:made-docs'

/** How many requests one batch moves the notes of. */
export let BATCH = 50

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** One batch of the pass: the next notes requests, each answer's Update
 * holding the notes moved into its doc and pointed to it. `root` is a
 * person's conversation in the space, which a person's notes are written in.
 * Answers whether another alarm has work. A store kept nowhere was made in
 * memory with docs, and owes no pass. */
export let madeBackfill = async (store: {
  g: Graph
  marks?: Pick<Meta, 'get' | 'set'>
  waiting?: () => number
}, root: (space: string, person: string) => Promise<string>): Promise<
  boolean
> => {
  let { g, marks } = store
  let since = marks?.get(MADE_DOCS)
  if (!marks || since == 'done') return false
  if (store.waiting?.()) return true
  let requests = await g.read(
    line`.operator_request.channel=notes${
      sub(since ? line`&.created.at>${since}` : line``)
    }&.order=created.at&.limit=${BATCH}&.fields=entity.eid,operator_request.space,operator_request.person,created.at`,
  )
  let ids = requests.map((r) => r.entity.eid)
  let answers = ids.length
    ? await g.read(
      line`.operator_answer.request=${ids}&.fields=entity.eid,operator_answer.request`,
    )
    : []
  let told = new Map(
    (await g.get(answers.map((a) => toldOf(a.entity.eid))))
      .flatMap((b) => b ? [[b.entity.eid, b]] : []),
  )
  let asked = new Map(requests.map((r) => [r.entity.eid, r]))
  let moved = await Promise.all(answers.map(async (a) => {
    let notice = told.get(toldOf(a.entity.eid))
    let note = comp(notice, 'notification')
    if (!note || note.about) return []
    let request = String(comp(a, 'operator_answer')!.request)
    let held = comp(asked.get(request), 'operator_request')!
    let space = String(held.space)
    let doc = comp(notice, 'doc')
    let made = madeDoc({
      answer: a.entity.eid,
      request,
      title: String(doc?.title ?? 'Notes of the call'),
      body: String(doc?.body ?? ''),
      by: space,
      ...note.to == space
        ? {}
        : { via: await root(space, String(held.person)) },
    })
    return [made, {
      entity: notice!.entity,
      notification: { about: made.entity.eid },
      doc: { body: POINTED },
    }]
  }))
  let rows = moved.flat()
  if (rows.length) await g.apply(rows, { trusted: true })
  let last = requests.at(-1)
  if (requests.length < BATCH) marks.set(MADE_DOCS, 'done')
  else marks.set(MADE_DOCS, String(comp(last, 'created')!.at))
  return requests.length == BATCH
}

/** A call as its conversation draws it, where it began: the line it came on
 * as a person names it, how long it went on, and the docs made of it. */
export type Called = {
  /** "Discord", "Phone"; none for a call kept before lines named theirs */
  via?: string
  seconds: number
  notes: { title: string; body: string }[]
}

/** The calls that began among `entries`, by the entry each began at, read
 * from the graph: every line kept of each call, the notes requests about
 * where it began, and the docs made from those. `title` names a line a
 * call came on (`operator_call.via`). */
export let callsOf = async (
  g: Pick<Graph, 'read'>,
  entries: Bundle[],
  title: (via: string) => string,
): Promise<Record<string, Called>> => {
  let began = entries.filter((b) => comp(b, 'operator_call')?.began)
  if (!began.length) return {}
  let ids = began.map((b) => b.entity.eid)
  let calls = began.map((b) => String(comp(b, 'operator_call')!.call))
  let [lines, asked] = await Promise.all([
    g.read(
      line`.operator_call.call=${calls}&.fields=operator_call.call,created.at`,
    ),
    g.read(
      line`.operator_request.channel=notes&.operator_request.about=${ids}&.order=created.at&.fields=entity.eid,operator_request.about`,
    ),
  ])
  let docs = asked.length
    ? await g.read(
      line`.output.source=${
        asked.map((r) => r.entity.eid)
      }&.doc&.fields=doc.title,doc.body,output.source`,
    )
    : []
  let at = (b: Bundle) => Date.parse(String(comp(b, 'created')?.at ?? ''))
  return Object.fromEntries(began.map((b, i) => {
    let times = lines.filter((l) => comp(l, 'operator_call')?.call == calls[i])
      .map(at).filter(Number.isFinite)
    let about = new Set(
      asked.filter((r) => comp(r, 'operator_request')?.about == ids[i])
        .map((r) => r.entity.eid),
    )
    let via = comp(b, 'operator_call')?.via
    return [ids[i], {
      ...via ? { via: title(String(via)) } : {},
      seconds: times.length
        ? Math.round((Math.max(...times) - Math.min(...times)) / 1000)
        : 0,
      notes: docs.filter((d) => about.has(String(comp(d, 'output')?.source)))
        .map((d) => ({
          title: String(comp(d, 'doc')?.title ?? ''),
          body: String(comp(d, 'doc')?.body ?? ''),
        })),
    }]
  }))
}
