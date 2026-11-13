// A standing duty is a wake aimed at who is to do it (@yaks/wake's
// `wake{every, target, note}`, read by name). Each time the box's clock fires
// it, `session_woken` knocks once with the wake's note, the way a text that
// arrived does (./texted.ts); one that watches a query (`watch`) fires only
// when its rows changed, and says what changed. Nothing starts a session, and
// what the duty asks for is the woken session's to do.
//
// Aimed at a persona, it knocks the persona's operator: TaskMaster's morning
// standup is `0 7 * * * America/Detroit`, the owner's morning in his time
// zone, and it reaches the session a person opened wearing TaskMaster, else
// its project, where the knock waits for the next session at work
// (./listen.ts).
//
// Aimed at a topic, it knocks the session opened on that topic (@yaks/topic's
// `session.topic`, read by name too): a goal that is its own topic, as a
// project is, has one long-lived session that stays on it, which nobody opened
// by hand and so is no operator. A wake still to fire keeps that session from
// being marked over while it rests ({@link awaited}, ./ended.ts), so the
// session a daily wake reaches is the one that has not ended, not a run that
// once answered a question about the topic.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { SESSION } from './comp.ts'
import { ended } from './listen.ts'
import { targets } from './watch.ts'

type G = Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''

/** The session a wake aimed at `topic` reaches: the one opened on it that can
 * still hear, the one opened first where several can. */
export let attending = async (g: G, topic: Eid): Promise<Eid | undefined> => {
  if (!g.vocab.prop(SESSION, 'topic')) return
  let open = await g.read(
    `.${SESSION}.topic=${topic}&!${SESSION}.ended` +
      `&.fields=${SESSION}.ended,created.at`,
  )
  let gone = await ended(g, open)
  let opened = (b: Bundle) => str(comp(b, 'created').at) + b.entity.eid
  return open.filter((s) => !gone.has(s.entity.eid))
    .toSorted((a, b) => opened(a).localeCompare(opened(b)))[0]?.entity.eid
}

/** The sessions a wake still to fire reaches ({@link attending}): each has a
 * turn coming, so it is not over however long it has rested. */
export let awaited = async (g: G): Promise<Set<Eid>> => {
  if (!g.vocab.comp('wake') || !g.vocab.prop(SESSION, 'topic')) return new Set()
  let open = await g.read(
    `.${SESSION}.topic&!${SESSION}.ended&.fields=${SESSION}.topic`,
  )
  let topics = [...new Set(open.map((s) => str(comp(s, SESSION).topic)))]
  if (!topics.length) return new Set()
  let coming = await g.read(
    `.wake.at&.wake.target=${topics.join(',')}&.fields=wake.target`,
  )
  let aimed = [...new Set(coming.map((w) => str(comp(w, 'wake').target)))]
  let reached = await Promise.all(aimed.map((topic) => attending(g, topic)))
  return new Set(reached.filter((s): s is Eid => !!s))
}

/** The knock a wake owes for its latest firing: to its persona's operator, or
 * to the session opened on its topic. None where `eid` is no wake aimed at
 * either, it has not fired, or that firing was knocked for already. */
export let woken = async (g: G, eid: Eid): Promise<Bundle[]> => {
  if (!g.vocab.comp('knock') || !g.vocab.comp('wake')) return []
  let [row] = await g.get(
    [eid],
    ['wake', 'fired', ...g.vocab.comp('watch') ? ['watch'] : []],
  )
  let target = str(comp(row, 'wake').target)
  let at = str(comp(row, 'fired').at)
  if (!target || !at) return []
  let knock = derivedEid(`session woken ${eid} ${at}`)
  if ((await g.get([knock], ['knock']))[0]?.knock) return []
  let persona = g.vocab.comp('persona') &&
    (await g.get([target], ['persona']))[0]?.persona
  let to = persona
    ? (await targets(g, [target], new Set()))[0]
    : await attending(g, target)
  if (!to) return []
  return [{
    entity: { eid: knock },
    knock: { target: to },
    // A wake that watches a query fired because its rows changed: the knock
    // says what changed after the note.
    doc: {
      body: [
        str(comp(row, 'wake').note) || `a wake fired at ${at}`,
        str(comp(row, 'watch').changes),
      ].filter(Boolean).join('\n\n'),
    },
  }]
}

/** The code behind `session_woken`. */
export let knock = async (g: G, eid: Eid): Promise<void> => {
  let owed = await woken(g, eid)
  if (owed.length) await g.apply(owed, { trusted: true })
}
