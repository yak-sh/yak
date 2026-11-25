// A pending wake set before a steered turn's wakes kept its mark (T-3461,
// T-3472) is given the `heard` mark the turn that set it would give it now,
// so a privileged act it calls waits for the person's tap when it fires
// (operator-schedules.ts `fired`). Each wake whose call is a privileged act
// (operator-approvals.ts `ESCALATING`) is judged by the turn whose
// `wake_set` call made it, as `steering` judges a turn today: how its words
// came, and what it heard since. A wake whose setting turn can no longer be
// read is marked too: a tap the person didn't need costs less than an act a
// stranger scheduled. The pass runs once a store from the Builder's alarm,
// beside the store's other passes, and says what it checked and marked.
import { line, sub } from '@yaks/query'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { short } from '@yaks/id'
import { askedFor, given } from '@yaks/session'
import { toolEid } from '@yaks/tools'
import { ESCALATING, steering } from './operator-approvals.ts'
import { RELAYED, SMS } from './operator-channels.ts'
import { HEARD_WAKES, wakesJudged } from './wake-move.ts'

/** Wakes set from this instant on were marked as they were set: the fix was
 * promoted to every request at 14:06:51Z (kernel #7910a58903), and a few
 * minutes are left for isolates of the version before it. */
export let BEFORE = '2026-11-25T14:20:00.000Z'

let privileged = (tool: unknown) =>
  Object.keys(ESCALATING).some((name) => toolEid(name) == tool)

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** Whether a turn read back from its transcript, `entries` through the
 * `wake_set` `call` in order, was steered, its words having come by
 * `channel`: as `steering` decides it when the turn runs (operator.ts
 * `came`), for whom the call's turn worked (@yaks/session `askedFor`). Its
 * words don't keep whether a call was in a room, so a turn by voice counts
 * as a phone call's, which a number alone could start. */
export let steeredBy = (entries: Bundle[], channel: string, call: Bundle) =>
  steering(
    {
      texted: SMS.has(channel) || channel == 'voice',
      relayed: RELAYED.has(channel),
      person: askedFor(entries, call),
    },
    { entries },
  )

// The setting turn's lines through `seq`, oldest first: back to its words
// and the notices they came after (@yaks/session `steered`), else the whole
// session.
let turnThrough = async (g: Graph, session: string, seq: number) => {
  let lines: Bundle[] = []
  let below = line`&.entry.seq<=${seq}`
  for (;;) {
    let page = await g.read(
      line`.entry.session=${session}${
        sub(below)
      }&.order=-entry.seq&.limit=50&*`,
    )
    lines.push(...page)
    let words = lines.findIndex(given)
    let opened = words >= 0 &&
      lines.slice(words + 1).some((b) => !b.notice)
    if (opened || page.length < 50) return lines.reverse()
    below = line`&.entry.seq<${Number(comp(page.at(-1), 'entry')?.seq)}`
  }
}

// How a turn's words came: on the words, else as their session last kept it.
let channelOf = async (g: Graph, session: string, lines: Bundle[]) => {
  let words = lines.findLast(given)
  let name = comp(words, 'channel')?.name
  if (name) return String(name)
  let [row] = await g.get([session], ['operator_session'])
  return String(comp(row, 'operator_session')?.channel ?? '')
}

/** Each `wake_set` call kept in the store, by the short id of the wake its
 * answer names. */
let setters = async (g: Graph) => {
  let calls = await g.read(
    '.call.name=wake_set&.fields=entity.eid,entry.session,entry.seq',
  )
  let by = new Map<string, Bundle>()
  if (!calls.length) return by
  let call = new Map(calls.map((c) => [c.entity.eid, c]))
  let answers = await g.read(
    line`.result.call=${[...call.keys()]}&.fields=result.call,content.body`,
  )
  for (let a of answers) {
    let body = String(comp(a, 'content')?.body ?? '')
    let wake = body.match(/"wake":"(#[0-9a-f]+)"/)?.[1]
    let set = call.get(String(comp(a, 'result')?.call))
    if (wake && set) by.set(wake, set)
  }
  return by
}

/** What a store's pass did: the wakes checked, and the ones marked. */
export type Judged = { checked: number; marked: string[] }

/** The pass, once a store: every pending wake set `before` ({@link BEFORE})
 * whose call is a privileged act, judged by its setting turn and marked
 * `heard` where it was steered or can no longer be read. Answers what it
 * did, or nothing where the store owes no pass. */
export let heardWakes = async (
  store: { g: Graph; marks?: Pick<Meta, 'get' | 'set'> },
  before = BEFORE,
): Promise<Judged | undefined> => {
  let { g, marks } = store
  if (!marks || wakesJudged(marks)) return
  let pending = (await g.read(
    line`.wake.at&.call&!heard&!watch&.created.at<${before}&.fields=entity.eid,call.to`,
  )).filter((w) => privileged(comp(w, 'call')?.to))
  let marked: string[] = []
  let set = pending.length ? await setters(g) : new Map()
  for (let wake of pending) {
    let call = set.get(short(wake.entity.eid))
    let at = comp(call, 'entry')
    let session = String(at?.session ?? '')
    let lines = at ? await turnThrough(g, session, Number(at.seq)) : []
    let made = lines.find((b) => b.entity.eid == call?.entity.eid)
    if (!made || steeredBy(lines, await channelOf(g, session, lines), made)) {
      marked.push(wake.entity.eid)
    }
  }
  for (let i = 0; i < marked.length; i += 50) {
    await g.apply(
      marked.slice(i, i + 50).map((eid) => ({ entity: { eid }, heard: {} })),
      { trusted: true, stamp: false },
    )
  }
  marks.set(HEARD_WAKES, 'done')
  return { checked: pending.length, marked }
}
