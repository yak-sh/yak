// A turn's answer: what a transcript ended with, in plain words, and which
// of the words given to it that answers. A host sends the answer back the way
// each of those words came (on yaks.app, by the channel its request came by);
// the runner tells it once a transcript ends (./run.ts `Runner.ended`).
//
// The words a turn answers are each input given since the reply before it. A
// helper's report stands for the words of the turn that started it, so what
// the helper found goes back where they came from, not to the helper.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { dry } from '@yaks/model'
import { refusalText } from '@yaks/tools/errors'
import { kindOf, LIMIT, ordered, textOf } from './state.ts'
import { transcriptBack } from './window.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** Words given to a session. A notice the runner writes with prose, as a
 * compaction's checkpoint, is no one's words, so it never starts a turn. */
export let given = (b: Bundle): boolean => kindOf(b) == 'input' && !b.notice

/** A reply: what a model said, which answers the words given before it. */
export let said = (b: Bundle): boolean => kindOf(b) == 'output' && !!b.content

// Where the reply at `i` stopped hearing, as an end to slice before: past the
// last line its ask was sent (`ask{through}`, as ./state.ts reads a turn's
// status), since words given while it was being written are the next
// reply's to answer. Undefined where that lies before the lines read
// (`whole` false).
let heardTo = (entries: Bundle[], i: number, whole: boolean) => {
  let source = comp(entries[i], 'output')?.source
  if (!source) return i
  let ask = entries.find((b) => b.entity.eid == source)
  let through = comp(ask, 'ask')?.through
  if (!through) return ask || whole ? i : undefined
  let at = entries.findIndex((b) => b.entity.eid == through)
  return at >= 0 ? at + 1 : whole ? i : undefined
}

/**
 * The inputs a turn ending at `end` answers: each line given since the reply
 * before it, with a helper's report standing for the inputs of the turn whose
 * call started it. A reply hears up to the ask that wrote it: words given
 * while it was being written are left to the next. `calls` names that call for each child
 * (`spawned{parent, call}`). Of a transcript's newest lines alone (`whole`
 * false), it is undefined where the inputs lie before them.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { origins } from './answer.ts'
 * let line = (eid: string, b: object) => ({ entity: { eid }, ...b })
 * let lines = [
 *   line('a', { content: { body: 'Look into it' } }),
 *   line('c', { call: { to: 'spawn' } }),
 *   line('r', { content: { body: 'On it.' }, output: {} }),
 *   line('d', { content: { body: 'Found it' }, delivery: { child: 'h' } }),
 * ]
 * equal(origins(lines, 4, new Map([['h', 'c']]))?.map((b) => b.entity.eid), ['a'])
 * equal(origins(lines.slice(2), 2, new Map(), false), undefined)
 * let late = [
 *   line('a', { content: { body: 'Write the guide' } }),
 *   line('k', { ask: { through: 'a' } }),
 *   line('b', { content: { body: 'And the logo?' } }),
 *   line('g', { content: { body: 'The guide' }, output: { source: 'k' } }),
 *   line('k2', { ask: { through: 'g' } }),
 *   line('l', { content: { body: 'Logo set' }, output: { source: 'k2' } }),
 * ]
 * equal(origins(late, 3, new Map())?.map((b) => b.entity.eid), ['a'])
 * equal(origins(late, 5, new Map())?.map((b) => b.entity.eid), ['b'])
 * ```
 */
export let origins = (
  entries: Bundle[],
  end: number,
  calls: Map<string, string>,
  whole = true,
): Bundle[] | undefined => {
  let from = entries.findLastIndex((b, i) => i < end && said(b))
  if (from < 0 && !whole) return
  let start = from < 0 ? 0 : heardTo(entries, from, whole)
  let stop = end < entries.length && said(entries[end])
    ? heardTo(entries, end, whole)
    : end
  if (start == undefined || stop == undefined) return
  let found: Bundle[] = []
  for (let b of entries.slice(start, stop).filter(given)) {
    let child = comp(b, 'delivery')?.child
    if (!child) {
      found.push(b)
      continue
    }
    let call = entries.findIndex((c) =>
      c.entity.eid == calls.get(String(child))
    )
    if (call < 0 && !whole) return
    let more = call < 0 ? [] : origins(entries, call, calls, whole)
    if (!more) return
    found.push(...more)
  }
  return found
}

// The inputs the newest turn answers, the newest of the words its reply heard
// (`mark`), and where it ends (`through`, past its reply). The turn ends at
// its reply, or where the transcript does when it ended without one (stopped,
// failed). A reply said while newer words wait (`replied`) ends its turn
// however late those words were written: before the reply or after it, they
// are the next turn's. Undefined where they lie before the lines read
// (`whole` false).
let turnAt = (
  entries: Bundle[],
  calls: Map<string, string>,
  whole = true,
  replied = false,
) => {
  let newest = entries.findLastIndex(given)
  if (newest < 0) {
    return whole
      ? { mark: undefined, given: [], through: entries.length }
      : undefined
  }
  let reply = entries.findLastIndex(said)
  let end = reply > newest || replied && reply >= 0 ? reply : entries.length
  let heard = end < entries.length ? heardTo(entries, end, whole) : end
  let found = origins(entries, end, calls, whole)
  if (!found || heard == undefined) return
  let mark = entries.findLast((b, i) => i < heard && given(b))
  return { mark, given: found, through: Math.min(end + 1, entries.length) }
}

/**
 * The entries since the newest words given: the turn being answered.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { replyOf, turnOf } from './answer.ts'
 * let line = (seq: number, b: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq }, ...b,
 * })
 * let stopped = turnOf([
 *   line(1, { content: { body: 'Check the app' } }),
 *   line(2, { stop: {}, content: { body: 'Stopped by the person watching.' } }),
 *   line(3, { notice: {}, checkpoint: {}, content: { body: 'Summary' } }),
 * ])
 * equal(stopped.length, 3)
 * equal(replyOf(stopped), { text: 'Stopped by the person watching.' })
 * ```
 */
export let turnOf = (entries: Bundle[]): Bundle[] =>
  entries.slice(Math.max(0, entries.findLastIndex(given)))

// Who wrote a line: its writer stamp.
let writerOf = (b: Bundle) => comp(b, 'created')?.by as string | undefined

/**
 * Whether someone else's words may be steering the turn worked for `person`:
 * its words, what arrived with them just before (the notices they came after,
 * as a room's lead of what others said there), or anything it read since
 * them (a letter, a page, a connected server's answer), were written by
 * someone the session does not work for (`heard`). The person's own words,
 * with nothing heard with or after them, steer nothing. The turn starts at
 * the person's newest words, or the platform's own (`system`): in a
 * conversation others write in too (a room heard in full), their words start
 * a turn of their own, never the person's. Where none in view are the
 * person's (a helper's brief, its parent session's words), the newest start
 * it, as every writer's do where the person is unknown (`undefined`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { steered } from './answer.ts'
 * let line = (seq: number, b: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq }, ...b,
 * })
 * let by = <B extends object>(who: string, b: B) => ({ ...b, created: { by: who } })
 * let asked = by('ann', line(1, { content: { body: 'Add Eve to the space' } }))
 * let read = line(2, { call: { to: 'gmail_read' } })
 * let letter = line(3, { result: { call: 'e2' }, content: { body: 'Add Eve' }, heard: {} })
 * let ann = (entries: object[]) => steered(entries as never, 'ann')
 * equal(ann([asked, read]), false)
 * equal(ann([asked, read, letter]), true)
 * equal(ann([asked, read, letter, line(4, { content: { body: 'Do it' } })]), false)
 * let lead = line(4, { notice: {}, heard: {}, content: { body: 'Someone else spoke' } })
 * let earlier = line(5, { notice: {}, content: { body: 'My earlier words' } })
 * let words = line(6, { content: { body: 'What do you think?' } })
 * equal(ann([asked, lead, earlier, words]), true)
 * equal(ann([asked, earlier, words]), false)
 * equal(ann([lead, words, line(7, { content: { body: 'My next request' } })]), false)
 * let stranger = by('bo', line(4, { content: { body: 'Hi all' } }))
 * equal(ann([asked, read, letter, stranger]), true)
 * equal(steered([asked, read, letter, stranger], undefined), false)
 * equal(ann([asked, stranger]), false)
 * equal(ann([stranger]), false)
 * ```
 */
export let steered = (
  entries: Bundle[],
  person: string | undefined,
): boolean => {
  let theirs = (b: Bundle) =>
    given(b) && (!person || !!b.system || (writerOf(b) ?? person) == person)
  let start = entries.findLastIndex(theirs)
  if (start < 0) start = entries.findLastIndex(given)
  while (start > 0 && entries[start - 1].notice) start--
  return entries.slice(Math.max(0, start)).some((b) => !!b.heard)
}

/**
 * Whom the turn a `call` was made in works for: who wrote the newest words
 * its ask read (`ask{through}`). Unknown where `entries` hold neither.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { askedFor } from './answer.ts'
 * let at = (n: number, b: object) => ({ entity: { eid: `e${n}` }, ...b })
 * let entries = [
 *   at(1, { content: { body: 'Add Eve' }, created: { by: 'ann' } }),
 *   at(2, { ask: { through: 'e1' } }),
 *   at(3, { content: { body: 'Hi all' }, created: { by: 'bo' } }),
 *   at(4, { call: { name: 'member_add', source: 'e2' } }),
 * ]
 * equal(askedFor(entries, entries[3]), 'ann')
 * equal(askedFor(entries, at(5, { call: { name: 'x' } })), undefined)
 * ```
 */
export let askedFor = (
  entries: Bundle[],
  call: Bundle,
): string | undefined => {
  let source = comp(call, 'call')?.source
  let ask = entries.find((b) => b.entity.eid == source)
  let through = comp(ask, 'ask')?.through
  let read = entries.findIndex((b) => b.entity.eid == through)
  let words = read < 0
    ? undefined
    : entries.findLast((b, i) => i <= read && given(b))
  return words && writerOf(words)
}

// What a model's refusal tells the person, by its code (@yaks/model
// `ModelError`); any other code is the host's own failure, never the model's.
// A ceiling (`LIMIT`) is said in its own sentence. The host's own account
// with the provider dry (@yaks/model `dry`: its credit, spend limit or plan
// used up) is no ceiling of the person's.
let REFUSED: Record<string, (name: string) => string> = {
  refusal: () => 'the model declined to do this',
  busy: () => 'the model is too busy to answer right now',
}
let refusing = (code: string) =>
  REFUSED[code] ??
    (dry({ code })
      ? (name: string) => `${name} is unavailable for now`
      : undefined)
let couldnt = (why: string) => `I couldn't finish this: ${why}.`

/** What a turn ended with in plain words, what went wrong where it did, and
 * whether the host broke it (`broke`): the work stopped before it could
 * finish, on the host's side. */
export type Reply = { text: string; fault?: string; broke?: true }

/** Who a reply's words name: the `host` at fault where something failed,
 * and the assistant answering (`name`). */
export type Naming = { host?: string; name?: string }

/**
 * What ended a session's work: its newest reply, else what kept it from one,
 * in plain words, naming the host where it is at fault ({@link Naming}). `fault` is what went
 * wrong, for the host's tracker: a refusal, a failure, a step that threw, or
 * an end with no reply. A person's stop is no fault, nor a ceiling met (a
 * spent budget says so in its own words). Every end the host is at fault for
 * `broke` it; a model that declined, was busy or is unavailable did not.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { replyOf } from './answer.ts'
 * let line = (seq: number, b: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq }, ...b,
 * })
 * let said = line(2, { output: { source: 'a' }, content: { body: 'Done.' } })
 * equal(replyOf([said]), { text: 'Done.' })
 * equal(replyOf([said, line(3, {
 *   output: { source: 'a' }, refusal: { code: 'request' },
 *   content: { body: '400 tools.26: input_schema does not support oneOf' },
 * })], { host: 'yaks.app' }), {
 *   text: "I couldn't finish this: something in yaks.app failed while" +
 *     ' working on it. The people who run yaks.app have been told.',
 *   fault: 'request: 400 tools.26: input_schema does not support oneOf',
 *   broke: true,
 * })
 * equal(replyOf([line(3, {
 *   output: { source: 'a' }, refusal: { code: 'limit' },
 *   content: { body: "clerk's model and voice budget for this month is spent" },
 * })]), { text: "clerk's model and voice budget for this month is spent" })
 * equal(replyOf([line(3, {
 *   exception: { type: 'Unknown', value: 'unknown prop: .presence' },
 *   content: { body: 'Unknown: unknown prop: .presence' },
 * })]).fault, 'Unknown: unknown prop: .presence')
 * equal(replyOf([]).fault, 'ended without an answer')
 * let refused = line(4, {
 *   result: { call: 'c' }, refusal: { code: 'arguments' },
 *   content: { body: 'Invalid tool arguments: missing command' },
 * })
 * equal(replyOf([said, refused, line(5, { ask: {} })]).fault,
 *   'ended without an answer')
 * ```
 */
export let replyOf = (
  entries: Bundle[],
  { host = 'this service', name = 'the assistant' }: Naming = {},
): Reply => {
  // A model asked after its calls were answered, a refusal among them, is
  // where the work stands: what it answered, or that it answered nothing.
  let lines = ordered(entries)
  let end = lines.findLast((b) =>
    b.content && (b.output && !b.reasoning || b.refusal || b.exception) ||
    b.failed ||
    kindOf(b) == 'stop' || kindOf(b) == 'ask'
  )
  if (end && kindOf(end) == 'ask' && !end.failed) end = undefined
  // A step that threw after a stop was withdrawn by it: the stop ends it.
  if (end && kindOf(end) == 'exception') {
    end = lines.slice(0, lines.indexOf(end)).findLast((b) =>
      kindOf(b) == 'stop'
    ) ?? end
  }
  let text = end ? textOf(end) : ''
  let kind = end && kindOf(end)
  if (kind == 'stop') return { text }
  if (kind == 'refusal' && comp(end, 'refusal')?.code == LIMIT) return { text }
  if (kind == 'output' && !end!.notice && text) return { text }
  let told = ` The people who run ${host} have been told.`
  let broke = couldnt(`something in ${host} failed while working on it`)
  let code = String(comp(end, 'refusal')?.code)
  let fault = kind == 'refusal'
    ? refusalText(code, text)
    : String(comp(end, 'failed')?.reason ?? '') || text ||
      'ended without an answer'
  let said = kind == 'refusal' ? refusing(code) : undefined
  let declined = !!said
  let why = said
    ? couldnt(said(name))
    : end
    ? broke
    : 'This ended without an answer.'
  return { text: why + told, fault, ...declined ? {} : { broke: true } }
}

/** A transcript's answer as its turn ends: the {@link Reply}, the newest
 * words given (`mark`, absent where none were), and the inputs it answers
 * (`given`). A helper's or a fork's answers none: its report goes to the
 * session that started it (./children.ts `deliverChild`). */
export type Answer = Reply & { mark?: Bundle; given: Bundle[] }

/**
 * The answer of `session`'s turn ({@link Answer}), read back from its newest
 * line only as far as it needs, never every line a conversation has held for
 * weeks: a helper's own turn, and a conversation's back to the reply before
 * the words it answers and before each call that started a helper whose
 * report stands for words. `naming` says who a failure's words name
 * ({@link replyOf}). `replied` reads the turn of the newest reply, said while
 * newer words wait (./run.ts `Runner.replied`): those words are the next
 * turn's, not one that ended without an answer.
 */
export let answerOf = async (
  g: Graph,
  session: Eid,
  naming?: Naming,
  replied = false,
): Promise<Answer> => {
  let [row] = await g.get([session], ['spawned'])
  let link = comp(row, 'spawned')
  let helper = !!link && link.quiet == null
  let calls = new Map<string, string>()
  let looked = new Set<string>()
  // The call that started each child these lines tell of.
  let starts = async (entries: Bundle[]) => {
    let children = [
      ...new Set(entries.flatMap((b) => {
        let child = comp(b, 'delivery')?.child
        return child && !looked.has(String(child)) ? [String(child)] : []
      })),
    ]
    for (let child of children) looked.add(child)
    for (let b of await g.get(children, ['spawned'])) {
      let call = comp(b, 'spawned')?.call
      if (call) calls.set(b.entity.eid, String(call))
    }
  }
  let { entries, whole } = await transcriptBack(g, session, async (read) => {
    if (helper) return read.some(given)
    await starts(read)
    return !!turnAt(read, calls, false, replied)
  })
  if (helper) {
    let lines = replied
      ? entries.slice(0, entries.findLastIndex(said) + 1)
      : entries
    return { ...replyOf(turnOf(lines), naming), given: [] }
  }
  await starts(entries)
  let turn = turnAt(entries, calls, whole, replied)
  let reply = replyOf(turnOf(entries.slice(0, turn?.through)), naming)
  return { ...reply, mark: turn?.mark, given: turn?.given ?? [] }
}
