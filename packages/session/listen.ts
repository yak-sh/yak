// What a session hears about its work, one line at a time: a comment on an
// entity it holds a lock on, a knock at it or at that entity, a letter
// delivered to it. `yak session listen` is the command a harness runs under a
// monitor — Claude Code's Monitor tool reads each line a command prints as one
// event — so a running agent learns about its work while it works.
//
// Each item is marked `notified` as it is said, so it is said once, including
// one that arrived while nothing was listening: a monitor that expired and was
// armed again hears the gap. A session never hears what it wrote itself.
//
// The graph is a file other processes write, so this reads it again every few
// seconds rather than waiting on commits: @yaks/client's `watch` hears only the
// commits made in its own process.

import {
  type Actor,
  type Bundle,
  type Comp,
  detached,
  type Eid,
  type Graph,
  signed,
} from '@yaks/graph'
import { human } from '@yaks/id'
import { absent, type And, and, type Clause, eq, present } from '@yaks/query'
import { safe } from '@yaks/text'
import type { Vocab } from '@yaks/vocab'
import { CLAIM } from './comp.ts'

let NOTIFIED = 'notified'

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp
let fold = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The queries for what is addressed to one session and not yet said. Each
 * asks about one component the graph declares; a graph without knocks or
 * letters has nothing to hear about them. */
export let addressedTo = (vocab: Vocab, session: Eid): And[] => {
  let has = (name: string) => !!vocab.comp(name)
  let unsaid = (...clauses: Clause[]) => and(...clauses, absent(NOTIFIED))
  return [
    ...has('comment')
      ? [
        unsaid(
          present('comment'),
          eq(`comment.target.${CLAIM}.session`, session),
        ),
      ]
      : [],
    ...has('knock')
      ? [
        unsaid(present('knock'), eq('knock.target', session)),
        unsaid(present('knock'), eq(`knock.target.${CLAIM}.session`, session)),
      ]
      : [],
    ...has('deliver')
      ? [unsaid(present('deliver'), eq('deliver.to', session))]
      : [],
  ]
}

/** Who wrote an item: the run it came through, else the identity. */
let author = (b: Bundle): string =>
  str(comp(b, 'created').via) || str(comp(b, 'created').by)

/** One item as the line a monitor shows. `named` gives the readable id of an
 * entity the item points at, where it could be read. */
export let said = (
  vocab: Vocab,
  b: Bundle,
  named: (eid: string) => string,
): string => {
  let id = human(vocab)(b)
  let doc = comp(b, 'doc')
  let text = fold(str(doc.body) || str(doc.title))
  let from = author(b) ? ` from ${named(author(b))}` : ''
  let line = b.comment
    ? `comment ${id} on ${named(str(comp(b, 'comment').target))}${from}`
    : b.knock
    ? `knock ${id} at ${named(str(comp(b, 'knock').target))}${from}`
    : `mail ${id} from ${str(comp(b, 'mail').from) || named(author(b))}`
  let words = b.deliver ? fold(str(doc.title)) : text
  return safe(words ? `${line}: ${words}` : line)
}

/** What {@link listen} needs besides the tool's own context. */
export type Ear = {
  /** where each line goes; the command line prints it */
  out: (line: string) => void
  /** how long to wait between reads */
  every: number
  /** stops the loop when it aborts; a command under a monitor stops when its
   * process is killed, so this is for a program that runs it in-process */
  stop?: AbortSignal
}

let pause = (ms: number, stop?: AbortSignal) =>
  new Promise<void>((done) => {
    let timer = setTimeout(done, ms)
    stop?.addEventListener('abort', () => (clearTimeout(timer), done()), {
      once: true,
    })
  })

/** One pass: read what is addressed to the session, say each item, mark each
 * said. Returns how many were said. */
export let hear = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'storage' | 'apply'>,
  actor: Actor | null,
  session: Eid,
  out: (line: string) => void,
): Promise<number> => {
  let vocab = graph.vocab
  let seen = new Set<string>()
  let items: Bundle[] = []
  for (let q of addressedTo(vocab, session)) {
    for (let b of await graph.read(q)) {
      if (seen.has(b.entity.eid) || author(b) == session) continue
      seen.add(b.entity.eid)
      items.push(b)
    }
  }
  if (!items.length) return 0
  let pointed = [
    ...new Set(
      items.flatMap((b) => [
        str(comp(b, 'comment').target),
        str(comp(b, 'knock').target),
        author(b),
      ]).filter(Boolean),
    ),
  ]
  let names = new Map<string, string>()
  for (let b of await detached(graph.storage).get(pointed)) {
    names.set(b.entity.eid, human(vocab)(b))
  }
  let named = (eid: string) => names.get(eid) ?? eid
  for (let b of items) out(said(vocab, b, named))
  await graph.apply(
    signed(
      items.map((b) => ({ entity: { eid: b.entity.eid }, [NOTIFIED]: {} })),
      actor,
    ),
  )
  return items.length
}

/** Say everything addressed to the session as it arrives, until `stop`
 * aborts. */
export let listen = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'storage' | 'apply'>,
  actor: Actor | null,
  session: Eid,
  ear: Ear,
): Promise<void> => {
  if (!graph.vocab.comp(NOTIFIED)) {
    throw new Error(
      'session listen marks what it said with `notified`, which @yaks/mail ' +
        'declares — compose that plugin',
    )
  }
  while (!ear.stop?.aborted) {
    await hear(graph, actor, session, ear.out)
    await pause(ear.every, ear.stop)
  }
}
