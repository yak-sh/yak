import { Time } from '@yaks/ui/parts'
// What the Operator's chat app shows of its work (operator-page.ts
// `chatPage`): each task as one conversation, its lines drawn by
// operator-draw.ts under a line for what it is doing now, and the list of
// conversations beside it. Pure: the page draws the conversation, and the
// Builder object sends the lines a step changed to the page's socket
// (`frame`) as the entries each draws, which the page draws again and puts
// in place by its id.
import type { Bundle, Comp } from '@yaks/graph'
import { statusOf } from '@yaks/session/status'
import { toolEid } from '@yaks/tools/result'
import { blocks, parse } from '@yaks/markdown/structural'
import type { H } from '@yaks/render'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Button, Card, Loading, Rows } from '@yaks/ui/parts'
import { moment } from './html.ts'
import { chatPath } from './route.ts'
import type { Declared } from './operator-persona.ts'
import type { Doing } from './mascot.ts'
import {
  asked,
  helped,
  type Helper,
  type Line,
  type Lines,
  lines,
  type Names,
  type Seen,
  spoken,
  theirs,
  told,
  VIA,
  wire,
} from './operator-draw.ts'
import { drawn, type Row, rowsOf } from './operator-rows.ts'
import type { HelperLine, Standing, Turn } from './operator-aside.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** How words written on a yaks.app page reach the Operator: after the
 * address of the page they were sent from, and the app open beside the chat
 * there (operator-page.ts `chatPage`), which the person's own words on the
 * page leave out. */
export let onPage = (page: string, app?: string) =>
  `In the chat on their yaks.app page ${page}${
    app ? `, with the app ${app} open beside it` : ''
  }: `

// What that page shows (operator-page.ts `side`, `canvas`), so the Operator
// knows what "here" is. The base persona contains it (operator-persona.ts).
export let paged: Declared = {
  key: 'page',
  title: 'Where they are',
  body:
    'Each message says how it came: by email, by text, by phone, in their Updates, or in the chat on their yaks.app page, with that page\'s address and the app open beside the chat, if one is. Your page is that chat. Down its left side, its sidebar holds the space\'s name, which switches spaces; your name, which opens your conversation with them; Updates from you, with how many wait on them; Your apps, the first few with each one\'s icon beside its name, and All N apps; and Manage at the foot, the settings behind the page (its apps, people, billing and the rest). A button at its top collapses the sidebar to its icons, each named when pointed at, and opens it again; the choice holds on every page and device. Beside the sidebar is your conversation and the box they write in, and with an app open, a column beside the chat holds it under its icon, name and address, in three tabs: What it keeps (the components of its vocab.json, in plain words), What it can do (its commands, and its pages by their titles, each shown in Screens when pressed), and Screens (its draft preview while the draft holds a page with changes not deployed yet, and the app running live once deployed, with Draft and Live to switch between them while both are there). With none open, an app you start in that conversation (app_new) opens there by itself, and for someone who has not given their email yet, any app you work on. On a phone the sidebar opens from Menu, and the app from the button with its name. When they write "here" or "this" on the page, they mean what that page shows. By email, text or phone they are not looking at it.',
}

/** How the caller's words on a call its talking model hears reach the
 * Operator (operator.ts `note`). The model's own words need no framing: the
 * Operator reads them as its own. */
export let HEARD = 'By phone: '

/** What the Operator reads where such a call began, before anything said on
 * it, which the conversation leaves out. */
export let CALLED = 'They called you, and your voice on the call answered.'

/** What a helper the person stopped from its page says as it stops
 * (operator.ts `stop`), which the session that started it reads in the
 * helper's report, from the system: who stopped it, by the id their own
 * words are labeled with, and that it stays stopped until they talk. */
export let stoppedHere = (person: string, helper: string) =>
  `The person (${person}) stopped helper ${helper} from the chat page, so leave it stopped, and don't start its work again another way, until you have talked with them.`

/** What the person's conversation hears from the system when they stop a
 * helper one of its helpers started (`operator_stopped`), which no report
 * of its own would tell it. */
export let stoppedBy = (person: string, asked: string, helper: string) =>
  `The person (${person}) stopped helper ${helper} ("${asked}"), which one of your helpers started, from the chat page, so leave it stopped, and don't start its work again another way, until you have talked with them.`

/** How words came (`operator_channel`): their channel, and the framing the
 * model reads before them, which the conversation leaves out. */
export let channelOf = (channel: string, framing = '') => ({
  channel,
  ...framing ? { framing } : {},
})

/** Every line of a transcript worth showing, drawn, in order. */
export let rows = (entries: Bundle[], names: Names, seen: Seen = {}): Row[] =>
  lines(entries, names, seen).map(drawn)

/**
 * A conversation's words as plain lines, for a reader that hears rather than
 * sees it (a call's voice, operator-glance.ts): each of the person's words
 * and each of the Operator's replies, oldest first, with when, who and how
 * it came. What a call's voice asked inside its turns is left out, what was
 * said aloud on the call standing for it, as are helpers' reports and the
 * platform's words.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { HEARD, wordsOf } from './operator-view.ts'
 * let at = '2026-11-06T21:04:00.000Z'
 * let line = (seq: number, b: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq },
 *   created: { at }, ...b,
 * })
 * equal(wordsOf([
 *   line(1, {
 *     content: { body: 'Build me a recipe box' },
 *     operator_channel: { channel: 'text' },
 *   }),
 *   line(2, { output: {}, content: { body: 'On it.' } }),
 *   line(3, {
 *     notice: {}, operator_call: { call: 'c' },
 *     operator_channel: { channel: 'voice', framing: HEARD },
 *     content: { body: HEARD + 'Is it done?' },
 *   }),
 *   line(4, {
 *     operator_call: { call: 'c', asked: true },
 *     content: { body: 'Is the recipe box done?' },
 *   }),
 *   line(5, { output: {}, content: { body: 'Nearly.' } }),
 *   line(6, {
 *     notice: { own: true }, operator_call: { call: 'c', said: true },
 *     content: { body: 'Nearly there.' },
 *   }),
 * ]), [
 *   'Nov 6th, 2026, 9:04 PM UTC, they, by text: Build me a recipe box',
 *   'Nov 6th, 2026, 9:04 PM UTC, you: On it.',
 *   'Nov 6th, 2026, 9:04 PM UTC, they, by phone: Is it done?',
 *   'Nov 6th, 2026, 9:04 PM UTC, you, by phone: Nearly there.',
 * ])
 * ```
 */
export let wordsOf = (entries: Bundle[]): string[] => {
  let sorted = entries.toSorted((a, b) =>
    Number(comp(a, 'entry')?.seq) - Number(comp(b, 'entry')?.seq)
  )
  let inside = asked(sorted)
  return sorted.flatMap((b) => {
    let body = String(comp(b, 'content')?.body ?? '')
    let called = comp(b, 'operator_call')
    if (!body || inside.has(b.entity.eid) || called?.began) return []
    // A helper's report and the platform's own words are no one's speech.
    if (told(b, body) || b.system) return []
    let how = VIA[String(comp(b, 'operator_channel')?.channel)]?.[1]
    let who = called?.said
      ? 'you, by phone'
      : b.output && !b.notice
      ? 'you'
      : (called && b.notice) || theirs(b)
      ? `they${how ? `, ${how[0].toLowerCase()}${how.slice(1)}` : ''}`
      : ''
    let said = who.startsWith('they') ? spoken(b, body) : body
    if (!who || !said) return []
    let at = moment(String(comp(b, 'created')?.at ?? ''))
    return [`${at ? `${at}, ` : ''}${who}: ${said}`]
  })
}

/** The line a step changed: a new line, or the call a new answer belongs to. */
export let touched = (
  entries: Bundle[],
  names: Names,
  from: number,
  seen: Seen = {},
): Line[] => {
  let ids = new Set(
    entries.filter((b) => Number(comp(b, 'entry')?.seq ?? 0) > from)
      .map((b) => b.result ? String(comp(b, 'result')!.call) : b.entity.eid),
  )
  return lines(entries, names, seen)
    .filter((l) => (l.of ?? [l.id]).some((id) => ids.has(id)))
}

// The calls a session made that no result answers yet.
let unanswered = (entries: Bundle[]) => {
  let answered = new Set(
    entries.filter((b) => b.result).map((b) => String(comp(b, 'result')!.call)),
  )
  return entries.filter((b) => b.call && !answered.has(b.entity.eid))
}

let atWork = (entries: Bundle[]) =>
  ['pending', 'running'].includes(statusOf(entries))

/** What the session is doing now, in a line; nothing once it ended, however
 * it ended: its lines say how. */
export let now = (entries: Bundle[], names: Names) => {
  if (!atWork(entries)) return ''
  let open = unanswered(entries)
  return open.length
    ? open.map((b) => {
      let c = comp(b, 'call')!
      return names(String(c.to), c.args as Record<string, unknown>).doing
    }).join(' ')
    : 'Thinking…'
}

let at = (b: Bundle | undefined) => String(comp(b, 'created')?.at ?? '')

/**
 * The turn a session has under way, for the aside (operator-aside.ts): the
 * tools it waits on, from the first one called, or its model thinking, from
 * the line it answers; none once it ended.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { turnOf } from './operator-view.ts'
 * let names = (to: string) => ({ doing: `Running ${to}…`, done: '' })
 * let line = (seq: number, b: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq },
 *   created: { at: `2026-11-08T15:00:0${seq}.000Z` }, ...b,
 * })
 * let asked = [
 *   line(1, { content: { body: 'Sort my people' }, using: {} }),
 *   line(2, { ask: {}, using: {} }),
 * ]
 * equal(turnOf(asked.slice(0, 1), names), {
 *   what: 'Thinking…', since: '2026-11-08T15:00:01.000Z',
 * })
 * equal(turnOf([...asked, line(3, { call: { to: 'shell' } })], names), {
 *   what: 'Running shell…', since: '2026-11-08T15:00:03.000Z',
 * })
 * equal(turnOf([...asked, line(3, { output: {}, content: { body: 'Done.' } })], names), null)
 * ```
 */
export let turnOf = (entries: Bundle[], names: Names): Turn | null => {
  let what = now(entries, names)
  if (!what) return null
  let open = unanswered(entries)
  return { what, since: at(open[0] ?? entries.at(-1)) }
}

/** Where a helper stands for a place to run (@yaks/session/admission
 * `dispatchStatus`): queued behind others, or stepped aside while its own
 * helpers work. */
export type Place = 'queued' | 'waiting' | 'active' | null

// How a session that ended stands, by its status.
let STANDING: Record<string, Standing> = {
  settled: 'done',
  failed: 'failed',
  stopped: 'stopped',
}

/**
 * A helper as the aside lists it, from its newest lines: how it stands, its
 * step under way (or, once it failed, why), when it began and, once it ended,
 * when.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { helping } from './operator-view.ts'
 * let names = (to: string) => ({ doing: `Running ${to}…`, done: '' })
 * let line = (seq: number, b: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 'h', seq },
 *   created: { at: `2026-11-08T15:00:0${seq}.000Z` }, ...b,
 * })
 * let begun = [line(1, { content: { body: 'Import the CSV' }, using: {} }), line(2, { ask: {}, using: {} })]
 * let of = { session: 'h', title: 'Import the CSV', since: '2026-11-08T15:00:00.000Z' }
 * equal(helping({ ...of, entries: [...begun, line(3, { call: { to: 'shell' } })] }, names), {
 *   ...of, standing: 'running', step: 'Running shell…',
 * })
 * equal(helping({ ...of, entries: begun, place: 'queued' }, names), {
 *   ...of, standing: 'waiting', step: 'Waiting for a place to run',
 * })
 * equal(helping({ ...of, entries: [...begun, line(3, { output: {}, content: { body: 'Imported.' } })] }, names), {
 *   ...of, standing: 'done', step: '', until: '2026-11-08T15:00:03.000Z',
 * })
 * equal(helping({ ...of, entries: [...begun, line(3, { exception: {}, content: { body: 'The sandbox stopped.\nat …' } })] }, names).step,
 *   'The sandbox stopped.')
 * ```
 */
export let helping = (
  helper: {
    session: string
    title: string
    since: string
    entries: Bundle[]
    place?: Place
    href?: string
  },
  names: Names,
): HelperLine => {
  let { entries, place, ...of } = helper
  let status = statusOf(entries)
  let [standing, step]: [Standing, string] = status == 'empty'
    ? ['waiting', 'Waiting to start']
    : !atWork(entries)
    ? [
      STANDING[status] ?? 'done',
      status == 'failed'
        ? String(comp(entries.at(-1), 'content')?.body ?? '').split('\n')[0]
          .slice(0, 120)
        : '',
    ]
    : place == 'queued'
    ? ['waiting', 'Waiting for a place to run']
    : place == 'waiting'
    ? ['waiting', 'Waiting on its helpers']
    : ['running', now(entries, names)]
  let ended = !['running', 'waiting'].includes(standing)
  return {
    ...of,
    standing,
    step,
    ...ended ? { until: at(entries.at(-1)) } : {},
  }
}

/** What the session is doing as its yak shows it (mascot.ts `MOVES`):
 * thinking or using a tool while it works, done or failed as it ends, and
 * idle once stopped or before it starts. Writing is heard only as it is
 * written. */
export let doingOf = (entries: Bundle[]): Doing => {
  let status = statusOf(entries)
  if (atWork(entries)) return unanswered(entries).length ? 'tool' : 'thinking'
  return status == 'settled' ? 'done' : status == 'failed' ? 'failed' : 'idle'
}

// What it is doing now, in words, as the yak shows it, and as the aside
// shows its turn.
let doingNow = (entries: Bundle[], names: Names) => ({
  now: now(entries, names),
  doing: doingOf(entries),
  turn: turnOf(entries, names),
})

/** An app a step put out a new version of: the space its call named ('' for
 * the Operator's own) and the app's slug. */
export type Changed = { space: string; app: string }

// The tools that put out a new version of an app, by the id a call points
// at (@yaks/tools `toolEid`), each with the argument that names the app.
// Writing files only stages them; app_deploy releases them.
let RELEASING = {
  app_new: 'slug',
  app_deploy: 'app',
  app_rollback: 'app',
  app_update: 'app',
}
let byEid = (tools: Record<string, string>) =>
  new Map(Object.entries(tools).map(([name, arg]) => [toolEid(name), arg]))
let CHANGES = byEid(RELEASING)
// The tools that work on an app: those, and those that read or write the
// files of its draft.
let WORKS = byEid({ ...RELEASING, app_files: 'app', sandbox_ship: 'app' })
// The tool that starts a new app.
let STARTS = byEid({ app_new: 'slug' })
// The tools that change an app's draft without releasing it.
let WRITES = byEid({ app_files: 'app', sandbox_ship: 'app' })

// Each call to one of `tools` whose answer came back past `from` (by
// `entry.seq`) and was not refused: the app it named, and when it answered.
// An app named as space/app is that space's.
let answered = (tools: Map<string, string>, entries: Bundle[], from = -1) => {
  let calls = new Map(
    entries.filter((b) => b.call).map((b) => [b.entity.eid, comp(b, 'call')!]),
  )
  return entries.flatMap((b) => {
    if (!b.result || b.refusal || b.exception) return []
    if (Number(comp(b, 'entry')?.seq ?? 0) <= from) return []
    let call = calls.get(String(comp(b, 'result')!.call))
    let args = (call?.args ?? {}) as Record<string, unknown>
    let named = args[tools.get(String(call?.to)) ?? '']
    if (typeof named != 'string' || !named) return []
    let [space, app] = named.includes('/')
      ? named.split('/', 2)
      : [typeof args.space == 'string' ? args.space : '', named]
    return [{ space, app, at: String(comp(b, 'created')?.at ?? '') }]
  })
}
let apps =
  (tools: Map<string, string>) => (entries: Bundle[], from = -1): Changed[] =>
    answered(tools, entries, from).map(({ space, app }) => ({ space, app }))

/** The apps these lines put out a new version of, oldest first. */
export let changed = apps(CHANGES)

/** The apps these lines worked on, oldest first: those they changed, and
 * those whose draft they read or wrote, which the chat draws beside the
 * conversation as each step lands (operator-page.ts `canvas`). */
export let worked = apps(WORKS)

/** The apps these lines started, oldest first, which open beside the
 * conversation that started them (operator-page.ts `chatPage`). */
export let started = apps(STARTS)

// What `app_files` does without changing a file.
let LOOKS = ['list', 'read', 'history']

// A reply's words as they are said aloud: its Markdown without the markup or
// code, and only its first sentences, the most a person on their feet hears.
let SENTENCES = 2
let plainly: H<string> = (tag, _props, ...inside) => {
  if (tag == 'pre' || tag == 'img') return ''
  if (tag == 'br') return ' '
  let words = (inside as unknown[]).flat(Infinity)
    .filter((c) => typeof c == 'string' || typeof c == 'number').join('')
  return /^(p|h\d|li|blockquote|tr)$/.test(tag) ? words + '\n' : words
}
let firstSaid = (text: string) =>
  blocks(parse(text), plainly).join('').split('\n').map((l) => l.trim())
    .filter(Boolean).join(' ').split(/(?<=[.!?])\s+/).slice(0, SENTENCES)
    .join(' ')

/**
 * What a step past `from` says aloud, oldest first: a short line for each
 * change that landed in an app (a release, a new app, files written), in
 * the words its step reads in, and the first sentences of each reply. The
 * chat page speaks them to a person who talked to it (public/voice.js).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { toolEid } from '@yaks/tools/result'
 * import { aloud } from './operator-view.ts'
 * let names = (_: string, args?: Record<string, unknown>) =>
 *   ({ doing: '', done: `Wrote ${args?.path}` })
 * let call = (n: number, op: string) => [
 *   { entity: { eid: `c${n}` }, entry: { session: 's', seq: n },
 *     call: { to: toolEid('app_files'), args: { app: 'notes', op, path: `${n}.css` } } },
 *   { entity: { eid: `r${n}` }, entry: { session: 's', seq: n }, result: { call: `c${n}` } },
 * ]
 * let reply = { entity: { eid: 'o' }, entry: { session: 's', seq: 3 }, output: {},
 *   content: { body: 'Done. **Warmer** now. Tell me more.\n\n```css\na{}\n```' } }
 * equal(aloud([...call(1, 'read'), ...call(2, 'write'), reply], names, 0), [
 *   'Wrote 2.css', 'Done. Warmer now.',
 * ])
 * equal(aloud([...call(1, 'write'), reply], names, 2), ['Done. Warmer now.'])
 * ```
 */
export let aloud = (entries: Bundle[], names: Names, from: number) => {
  let calls = new Map(
    entries.filter((b) => b.call).map((b) => [b.entity.eid, comp(b, 'call')!]),
  )
  return entries.flatMap((b) => {
    if (Number(comp(b, 'entry')?.seq ?? 0) <= from) return []
    let body = String(comp(b, 'content')?.body ?? '')
    if (b.output && !b.notice && body.trim()) return [firstSaid(body)]
    if (!b.result || b.refusal || b.exception) return []
    let call = calls.get(String(comp(b, 'result')!.call))
    let args = (call?.args ?? {}) as Record<string, unknown>
    let to = String(call?.to)
    let lands = CHANGES.has(to) || WRITES.has(to) && !LOOKS.includes(
          String(args.op ?? ''),
        )
    return lands ? [names(to, args).done] : []
  }).filter(Boolean)
}

// One app, however each call named its space.
let same = (a: Changed, b: Changed) =>
  a.app == b.app && (!a.space || !b.space || a.space == b.space)

/**
 * The app a conversation is making: the one its newest step worked on, of
 * its own lines and its helpers', which do most of its work, and whether
 * the conversation started it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { toolEid } from '@yaks/tools/result'
 * import { making } from './operator-view.ts'
 * let step = (n: number, app: string) => [
 *   { entity: { eid: `c${n}` }, entry: { session: 's', seq: n },
 *     call: { to: toolEid('app_files'), args: { app } } },
 *   { entity: { eid: `r${n}` }, entry: { session: 's', seq: n + 1 },
 *     created: { at: `2026-11-07T0${n}:00:00Z` }, result: { call: `c${n}` } },
 * ]
 * let begun = [
 *   { entity: { eid: 'n' }, entry: { session: 's', seq: 0 },
 *     call: { to: toolEid('app_new'), args: { slug: 'chores' } } },
 *   { entity: { eid: 'm' }, entry: { session: 's', seq: 0 },
 *     created: { at: '2026-11-07T00:00:00Z' }, result: { call: 'n' } },
 * ]
 * equal(making(step(2, 'recipes'), [{ entries: step(1, 'chores') }]), {
 *   space: '', app: 'recipes', started: false,
 * })
 * equal(making(step(1, 'recipes'), [{ entries: step(2, 'chores') }]), {
 *   space: '', app: 'chores', started: false,
 * })
 * equal(making(begun, [{ entries: step(2, 'chores') }]), {
 *   space: '', app: 'chores', started: true,
 * })
 * equal(making([]), null)
 * ```
 */
export let making = (
  entries: Bundle[],
  helpers: Helper[] = [],
): Underway | null => {
  let lines = [entries, ...helpers.map((h) => h.entries)]
  let newest = lines.flatMap((l) => answered(WORKS, l))
    .sort((a, b) => a.at.localeCompare(b.at)).at(-1)
  if (!newest) return null
  let app = { space: newest.space, app: newest.app }
  return {
    ...app,
    started: lines.some((l) => started(l).some((s) => same(s, app))),
  }
}

/** An app underway in a conversation, and whether it started it. */
export type Underway = Changed & { started: boolean }

/** One task's frame: the lines a step changed, as the entries each draws
 * (operator-draw.ts `Lines`), what it is doing now, the apps it changed,
 * worked on and started, and what it says aloud. */
export let frame = (
  task: string,
  entries: Bundle[],
  names: Names,
  from: number,
  seen: Seen = {},
) => ({
  operator: {
    task,
    lines: wire(touched(entries, names, from, seen), entries, seen),
    changed: changed(entries, from),
    worked: worked(entries, from),
    started: started(entries, from),
    said: aloud(entries, names, from),
    ...doingNow(entries, names),
  },
})

/** A helper's frame: what it was told past `from`, drawn inside the step
 * that started it (that step drawn again) or, for a helper no step drawn
 * started, on its own; the apps it changed, worked on and started, and the
 * changes it landed said aloud, never its replies, which are the Operator's
 * to hear; what the Operator that started it is doing now; and the helper
 * as the aside lists it (`helping`). */
export let helperFrame = (
  task: string,
  helper: Helper,
  entries: Bundle[],
  names: Names,
  from: number,
  seen: Seen = {},
  listed?: HelperLine,
) => {
  let seq = (id: string) =>
    Number(
      comp(helper.entries.find((b) => b.entity.eid == id), 'entry')?.seq ?? 0,
    )
  let told = helped(helper, seen.offers).filter((r) => seq(r.id) > from)
  let call = entries.some((b) => b.entity.eid == helper.call)
  let shown = { ...seen, helpers: [helper] }
  return {
    operator: {
      task,
      lines: wire(
        told.length && call
          ? lines(entries, names, shown).filter((l) => l.id == helper.call)
          : told.map((r) => ({ id: r.id, uses: [], node: r.draw() })),
        entries,
        shown,
      ),
      changed: changed(helper.entries, from),
      worked: worked(helper.entries, from),
      started: started(helper.entries, from),
      said: aloud(helper.entries.filter((b) => !b.output), names, from),
      ...doingNow(entries, names),
      ...listed ? { helping: listed } : {},
    },
  }
}

/** A task as its conversation draws it: every line, what it is doing now,
 * and the files sent with it. */
export let talk = (
  task: Bundle,
  entries: Bundle[],
  names: Names,
  files: { request: string; name: string; index: number }[],
  at: string,
  seen: Seen = {},
) => {
  let working = now(entries, names)
  // Files drawn under the words they came with are not listed again.
  let sent = new Set(
    entries.map((b) => comp(b, 'operator_files')?.request).filter(Boolean),
  )
  let rest = files.filter((f) => !sent.has(f.request))
  return renderToString(h(
    'div',
    {
      class: 'Talk_Thread',
      'data-task': task.entity.eid,
      'data-pending': working ? '' : undefined,
      'data-doing': working ? doingOf(entries) : undefined,
    },
    h(
      'div',
      { class: 'Talk_Said', 'data-rows': '' },
      lines(entries, names, seen).map((r) =>
        h('div', { id: `row-${r.id}` }, r.node)
      ),
    ),
    // the words a screen reader hears; the yak beside the box shows them
    h(
      Loading,
      { class: 'Talk_Now' },
      h('span', { 'data-now': '' }, working),
    ),
    rest.length
      ? h(
        'p',
        { class: 'Talk_Files' },
        rest.map((f) =>
          h(
            'a',
            { href: `${at}?attachment=${f.request}&file=${f.index}` },
            f.name,
          )
        ),
      )
      : null,
  ))
}

/** A piece of the Operator's work as its lists show it, in plain words. */
export type Worked = {
  /** what the page opens it by: a task, or a request no task has taken yet */
  open: string
  title: string
  state: string
  at: string
  busy: boolean
  /** for a helper, the title of the conversation that started it */
  from?: string
}

// What a task's newest session says of it, in the words its list shows.
export let stateOf = (entries: Bundle[], done: boolean) => {
  let status = statusOf(entries)
  if (status == 'failed') return 'Could not finish'
  if (status == 'stopped') return 'Stopped'
  if (status == 'settled') return done ? 'Done' : 'Answered'
  return status == 'empty' ? 'Waiting to start' : 'Working on it'
}

/** A conversation as a list shows it, with where it is when the list holds
 * more than one space's. */
export type Listed = Worked & { where?: string }

// A list across spaces says when each last changed, to the minute.
let meta = (w: Listed) =>
  [
    w.where,
    w.from && `Helper of the ${w.from[0].toLowerCase()}${w.from.slice(1)}`,
    w.state,
    h(Time, { at: w.at }),
  ].filter(Boolean).flatMap((part, i) => i ? [' · ', part] : [part])

/** The Operator's conversations as rows, newest first, each a link to the
 * page `href` gives it. */
export let listed = <W extends Listed>(items: W[], href: (w: W) => string) =>
  renderToString(h(
    Rows,
    null,
    items.map((w) =>
      h(
        Rows.Item,
        { 'data-pending': w.busy ? '' : undefined },
        h(
          Rows.Main,
          null,
          h(Rows.Name, { href: href(w) }, w.title),
          h(Rows.Meta, null, meta(w)),
        ),
      )
    ),
  ))

/** Where the Operator's settings send a person for its conversations: the
 * chat app, which holds them. Settings list none (T-144779). */
export let talks = (space: string) =>
  h(
    Card,
    null,
    h(Card.Head, null, h(Card.Title, null, 'Conversations')),
    h(
      'p',
      null,
      'Your conversations with the Operator are in its chat. ',
      h(Button, { mod: 'go', href: chatPath(space) }, 'Open the chat'),
    ),
  )

/** A frame as a page reads it that opened its socket before lines were sent
 * as data: each line drawn as HTML (`rows`), and no `lines`. */
export let withRows = <F extends { operator: { lines?: Lines } }>(f: F) => {
  let { lines, ...operator } = f.operator
  return { ...f, operator: { ...operator, rows: lines ? rowsOf(lines) : [] } }
}
