// What @yaks/session says at the start of a transcript: the `digest` facet a
// host takes (`@yaks/session/digest`), and the lines `session_context` answers
// with where no host composed one.
//
// Three sections, in the order a session reads them. The OWNER'S WORDS lead —
// the last turns typed to this actor, across its recent transcripts, because
// the signal a session most needs is the one a person put into the system
// (M-31946). Then the HANDOFF: the newest brief by the same actor, quoted
// whole, since a truncated handoff is a handoff nobody trusts. Then what this
// transcript HOLDS, the locks it took and has not let go.
//
// It is deliberately short. Every session ever started here reads it, so what
// goes in is what CHANGES what the session does next; anything else is a read
// somebody can make. The memories and the standing goals a fleet also injects
// are @yaks/memory's and @yaks/goal's to contribute, from their own packages —
// this one neither knows nor asks.
//
// A FRESH TRANSCRIPT IS NOT AN EMPTY ONE. A session at its first hook has no
// entity yet, so the entries under its own name are nothing — and the owner
// was still talking a minute ago, in the transcript that just ended. That is
// why the turns are read across the ACTOR's recent transcripts rather than
// this one's: the actor is the thread a person is talking to, and a session is
// one stretch of it.

import type { Bundle, Comp } from '@yaks/graph'
import { type Reading, type Sections, snip } from '@yaks/context'
import { human } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'
import { CLAIM, SESSION } from './comp.ts'
import { ENTRY } from './native.ts'
import { kindOf, textOf } from './status.ts'

/** How many of the owner's turns a digest carries. */
export let TURNS = 5

// How far back the turns are looked for: the actor's newest transcripts, and
// within them the newest entries. A turn is rare among tool calls and their
// results, so the entry window is the wider of the two.
let TRANSCRIPTS = 8
let ENTRIES = 40

/** Where these sections sit in a composed digest: ahead of everything a host
 * adds, because what the owner said and what this session holds are what it is
 * about to act on. */
export let weight = -10

let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let quoted = (v: string) => JSON.stringify(v)

// An eid a query may name: a `$alias` is a bundle the batch has yet to mint,
// and nothing in the graph refers to it.
let minted = (eid: string) => !eid.startsWith('$')

/** One entity as a person reads it: its id, and its title where it has one. */
export let line = (vocab: Vocab, b: Bundle): string => {
  let id = human(vocab)(b)
  let title = str(comp(b, 'doc').title)
  return title ? `${id} — ${title}` : id
}

// The owner's last turns to this actor, oldest first so the newest sits at the
// bottom — the line a session reads last is the one it acts on.
let turns = async (read: Reading, actor: string): Promise<string[]> => {
  if (!actor) return []
  let mine = await read(
    `.${SESSION}.actor=${quoted(actor)}&.order=-entity.num` +
      `&.limit=${TRANSCRIPTS}`,
  )
  let eids = mine.map((b) => b.entity.eid).filter(minted)
  if (!eids.length) return []
  let entries = await read(
    `.${ENTRY}.session=${eids.join(',')}&.content&.order=-entity.num` +
      `&.limit=${ENTRIES}`,
  )
  // An INPUT is prose nothing produced: what a person typed, as against what a
  // model said or a tool answered (./status.ts reads the comp beside it).
  return entries.filter((b) => kindOf(b) == 'input')
    .slice(0, TURNS)
    .reverse()
    .map((b) => str(textOf(b).split('\n').find((l) => l.trim())).trim())
    .filter(Boolean)
    .map((text) => `- ${snip(text)}`)
}

// The thread from last time: the newest brief by the same actor, whole.
let previously = async (
  read: Reading,
  actor: string,
  eid: string,
): Promise<string[]> => {
  if (!actor) return []
  let was = (await read(
    `.brief!&.${SESSION}.actor=${quoted(actor)}&.limit=2`,
  )).filter((b) => b.entity.eid != eid)
  let text = str(comp(was[0], 'brief').text)
  return text ? [text] : []
}

// What this transcript is in the middle of: the locks it holds.
let claimed = async (
  read: Reading,
  eid: string,
  vocab: Vocab,
): Promise<string[]> => {
  if (!minted(eid)) return []
  let held = await read(`.${CLAIM}.session=${quoted(eid)}`)
  return held.map((b) => `- ${line(vocab, b as Bundle)}`)
}

/** This package's sections, as a host's `digest` facet builds them. The
 * vocabulary is what a held entity is named with; nothing else is needed from
 * the host. */
export let digest =
  (host: { vocab: Vocab }): Sections => async (session, read) => {
    let eid = session.entity.eid
    let actor = str(comp(session as Bundle, SESSION).actor)
    return [
      { heading: 'owner said', lines: await turns(read, actor) },
      { heading: 'previously', lines: await previously(read, actor, eid) },
      { heading: 'claimed', lines: await claimed(read, eid, host.vocab) },
    ]
  }
