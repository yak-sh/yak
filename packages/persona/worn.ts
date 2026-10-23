// What documents a persona is built from, read out of the graph: the
// `contains` and `reads` edges leaving it, resolved to the documents at their
// far ends, in the order they were authored in. {@link voice} renders what
// this function collects, and neither knows how the other does its job.
//
// Two relations, borrowed rather than invented. `contains` is @yaks/task's and
// `reads` is @yaks/kernel's, and both already mean what is needed here: this
// persona contains that document, this persona reads that one. A relation the
// composed vocabulary does not declare contributes nothing rather than
// throwing — a graph with no @yaks/task in it has no `contains`, so a persona
// there includes no documents, which is a fair reading of that graph and not a
// misconfiguration this package is entitled to refuse.
//
// It reads the EDGE entities rather than walking them (@yaks/edge `walk`
// returns the far ends, and a far end no longer carries the edge's `ord`) —
// the one property the authored order depends on.
//
// An included persona is folded in: its instruction text is included like any
// other document, and the documents it links to are added to the ones this
// persona links to, which is how a base persona reaches every persona built on
// top of it without anybody copying its text. A persona reached by `reads` is
// only listed: the edge records where it is, not that its text belongs here.
// A registered tool it contains is offered to whoever wears it rather than
// said, and an included persona's tools are offered with its own.
// This walks level by level rather than recursing, so an embedded store
// answers the whole read synchronously and a remote one needs exactly one
// chain of calls (@yaks/edge's `reach` walks the same way).
//
// Two sets of what personas say combine the same way: {@link fold} says
// several as one, the way a sub-project's agents hear every common persona
// above them, and {@link beside} leaves out what another file already says.

import { and, eq, type Input, list, present } from '@yaks/query'
import { after, each } from '@yaks/fp'
import type { Bundle, Eid, Storage } from '@yaks/graph'
import { EDGE, relations } from '@yaks/edge'
import { DOC } from '@yaks/doc'
import type { Vocab } from '@yaks/vocab'
import { PERSONA } from './comp.ts'
import type { Worn } from './voice.ts'

/** The relation whose far end is included in full. */
export let CARRIES = 'contains'

/** The relation whose far end is only listed by id. */
export let READS = 'reads'

/** A registered tool (@yaks/tools): contained, it is offered, not said. */
export let TOOL = 'tool'

// How deep personas may be nested. A base under a base under a base is a graph
// somebody drew by hand; deeper than this means a cycle, and a cycle is what
// the `seen` set already stops.
let DEPTH = 8

/** What composing a persona reads of a storage: queries, and entities by
 * eid. A page hands it a storage over what it holds (@yaks/inspect's
 * `useReading`), so the page composes with this very code. */
export type Reads = Pick<Storage, 'read' | 'get'>

let value = (eids: Eid[]): Input => eids.length == 1 ? eids[0] : list(...eids)

// A document put forward for a decision (@yaks/kernel's `proposed`) is a
// suggestion until somebody decides it, and one declined stays a suggestion:
// linking it to a persona files it where it belongs, but the persona does not
// say it.
let undecided = (b: Bundle): boolean => {
  if (!b.proposed) return false
  let decided = b.decided as { verdict?: unknown } | undefined
  return !decided || decided.verdict == 'declined'
}

let far = (b: Bundle): Eid => {
  let to = (b[EDGE] as { to?: unknown } | undefined)?.to
  return typeof to == 'string' ? to : ''
}

let ordOf = (b: Bundle): number =>
  Number((b[EDGE] as { ord?: unknown })?.ord ?? Number.MAX_SAFE_INTEGER)

/**
 * The order links are read in, the order an agent is given what they lead
 * to: an edge's own `ord` where its author set one, then the entity it points
 * at, so two unordered siblings never swap places between reads. A sort's
 * comparator, for anything drawing them in that order.
 */
/// let to = (to: string, ord?: number) => ({ entity: { eid: to }, edge: { from: 'p', to, ...ord == null ? {} : { ord } } })
/// [to('b'), to('a'), to('c', 1)].sort(served).map((b) => b.entity.eid) -> ['c', 'a', 'b']
export let served = (a: Bundle, b: Bundle): number =>
  ordOf(a) - ordOf(b) || far(a).localeCompare(far(b))

// The links of one relation out of a whole level, in the order they are
// served.
let links = (storage: Reads, from: Eid[], tag: string | undefined) =>
  !tag || !from.length ? [] : after(
    storage.read(and(eq(`${EDGE}.from`, value(from)), present(tag))),
    (found) => found.filter(far).sort(served).map(far),
  )

/**
 * The documents one persona is built from, read out of a storage. Returns
 * `undefined` when the eid does not exist, or is not a persona — what to do
 * about that is the caller's decision, since a tool call refuses while a
 * report might not.
 *
 * ```ts ignore
 * let worn = await wear(storage, vocab)('N-1')
 * if (worn) console.log(voice(vocab)(worn))
 * ```
 *
 * Synchronous in, synchronous out: over an embedded database this returns a
 * value directly, and over a storage that returns promises it returns a
 * promise.
 */
export let wear = (
  storage: Reads,
  vocab: Vocab,
): (eid: Eid) => Worn | undefined | Promise<Worn | undefined> => {
  let tags = relations(vocab)
  return (eid) =>
    after(storage.get([eid]), (found) => {
      let persona = found[0]
      if (!persona?.[PERSONA]) return undefined
      let carries = new Map<Eid, Bundle>()
      let names = new Map<Eid, Bundle>()
      let tools = new Map<Eid, Bundle>()
      let seen = new Set<Eid>([eid])
      let level = [eid]
      return after(
        each(Array.from({ length: DEPTH }, (_, i) => i), null, () => {
          if (!level.length) return null
          return after(links(storage, level, tags[CARRIES]), (held) =>
            after(links(storage, level, tags[READS]), (said) =>
              after(
                storage.get([...new Set([...held, ...said])]),
                (docs) => {
                  let by = new Map(docs.map((b) => [b.entity.eid, b]))
                  let next: Eid[] = []
                  for (let id of held) {
                    let b = by.get(id)
                    if (b?.[TOOL]) {
                      tools.set(id, b)
                      continue
                    }
                    // `seen` holds the persona itself, so a cycle of
                    // personas never includes the text it started from
                    // twice.
                    if (
                      !b || !(b[DOC] || b.content) || seen.has(id) ||
                      undecided(b)
                    ) {
                      continue
                    }
                    seen.add(id)
                    carries.set(id, b)
                    // An included persona's text is included like any other
                    // document; the documents it links to are read on the
                    // next level.
                    if (b[PERSONA]) {
                      next.push(id)
                    }
                  }
                  for (let id of said) {
                    let b = by.get(id)
                    if (
                      b && (b[DOC] || b.content) && !names.has(id) &&
                      !undecided(b)
                    ) {
                      names.set(id, b)
                    }
                  }
                  level = next
                  return null
                },
              )))
        }),
        () => {
          // Inclusion wins: a document listed in one place and included in
          // another is included once, and never appears twice. The persona
          // itself is neither — its text is what the document opens with.
          for (let id of carries.keys()) {
            names.delete(id)
          }
          names.delete(eid)
          return {
            persona,
            carries: [...carries.values()],
            names: [...names.values()],
            tools: [...tools.values()],
          }
        },
      )
    })
}

let eidOf = (b: Bundle): Eid => b.entity.eid

/**
 * Several personas said as one: the first leads, and each after it is
 * included the way a persona it contained would be — its text as a document,
 * then the documents it includes, its tools offered with the rest — with
 * nothing said twice. How a sub-project's agents hear the common persona of
 * every project above theirs.
 */
export let fold = (head: Worn, ...more: Worn[]): Worn => {
  let lead = eidOf(head.persona)
  let carries = new Map(head.carries.map((b) => [eidOf(b), b]))
  let names = new Map(head.names.map((b) => [eidOf(b), b]))
  let tools = new Map(head.tools.map((b) => [eidOf(b), b]))
  for (let w of more) {
    for (let b of [w.persona, ...w.carries]) {
      if (eidOf(b) != lead && !carries.has(eidOf(b))) carries.set(eidOf(b), b)
    }
    for (let b of w.names) if (!names.has(eidOf(b))) names.set(eidOf(b), b)
    for (let b of w.tools) if (!tools.has(eidOf(b))) tools.set(eidOf(b), b)
  }
  for (let id of [lead, ...carries.keys()]) names.delete(id)
  return {
    persona: head.persona,
    carries: [...carries.values()],
    names: [...names.values()],
    tools: [...tools.values()],
  }
}

/**
 * What `w` says that `said` does not: a document `said` includes is dropped in
 * both forms, and one it only names loses only its name, since including it in
 * full still earns its place. `w` keeps its own lead and its tools, which are
 * offered, not said. How a file read beside another avoids saying anything
 * twice.
 */
export let beside = (w: Worn, said: Worn): Worn => {
  let carried = new Set([said.persona, ...said.carries].map(eidOf))
  let named = new Set([...carried, ...said.names.map(eidOf)])
  return {
    persona: w.persona,
    carries: w.carries.filter((b) => !carried.has(eidOf(b))),
    names: w.names.filter((b) => !named.has(eidOf(b))),
    tools: w.tools,
  }
}

/** The names of the tools a session wearing `w` is offered: nothing where it
 * contains none, which leaves its runner's own set. */
export let offer = (w: Worn | undefined): string[] | undefined => {
  let names = (w?.tools ?? []).flatMap((b) => {
    let name = (b[TOOL] as { name?: unknown }).name
    return typeof name == 'string' && name ? [name] : []
  })
  return names.length ? names : undefined
}
