// What a call's voice knows of the Operator it speaks for (T-145832): the
// newest of the person's conversation, the work the Operator has going for
// them and how far it got, what waits on them in their Updates, and their
// apps. It is told the first two as the call starts and the work again as it
// moves (operator-calls.ts `talking`), and looks up any of it with its status
// tools (`looks`). All of it is read: every action stays with the Operator,
// which the voice asks (operator-calls.ts `ASK`).
import type { Directory } from './directory.ts'
import { moment } from './html.ts'
import { rootAt } from './operator-root.ts'
import { type Helping, helpingOf } from './operator-host.ts'
import { word } from './operator-aside.ts'
import type { OperatorStore } from './operator-store.ts'
import { updatesOf } from './operator-updates.ts'
import { message } from '@yaks/model'
import { kindOf, ordered, source, textOf } from '@yaks/session'
import type { Comp } from '@yaks/graph'
import { inputSource } from './operator-provenance.ts'

type Store = OperatorStore

/** Whose Operator a call's voice speaks for, and where it reads. */
export type Glance = {
  store: Store
  space: string
  person: string
  /** the directory their apps are read from */
  dir: Pick<Directory, 'reachable'>
  /** now, in milliseconds: the runtime's */
  now?: () => number
}

// How many of the conversation's newest lines the voice is told as the call
// starts, and how many its `conversation` tool reads.
let RECENT = 20, EARLIER = 60
// The longest one line it is told runs, in characters.
let LONGEST = 400

let cut = (text: string, most = LONGEST) => {
  let flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > most ? flat.slice(0, most) + '…' : flat
}

/** The newest `most` lines of the person's conversation, oldest first, or
 * nothing when they have said nothing yet. */
export let recentOf = async (g: Glance, most = RECENT) => {
  // Most entries are steps and tool calls, not words.
  let entries = await g.store.g.read(
    `.entry.session=${await rootAt(
      g.store,
      g.space,
      g.person,
    )}&.order=-entry.seq&.limit=${most * 8}&*`,
  )
  let names = new Map([[g.person, 'the person']])
  return ordered(entries).flatMap((entry) => {
    if (
      entry.archived || entry.checkpoint ||
      !['input', 'output'].includes(kindOf(entry) ?? '')
    ) return []
    let text = textOf(entry)
    if (!text || entry.prompt) return []
    let from = (entry.entry as Comp).from as string | undefined
    from ??= inputSource(entry) ?? source(entry, names) ?? 'the Operator'
    let at = moment(String((entry.created as Comp | undefined)?.at ?? ''))
    let words = message({ kind: 'user', text: cut(text) }, from).text
    return [`${at ? at + ', ' : ''}${words}`]
  }).slice(-most).join('\n\n')
}

// One piece of work as the voice hears it: what was asked, how it stands and
// since when, and while it works what it is doing and how far it got.
let workLine = (w: Helping) =>
  [
    `- ${cut(w.title, 160)}: ${word(w.standing)}, ${moment(w.at)}`,
    w.standing == 'running' && w.step && `  doing now: ${w.step}`,
    w.wrote && `  latest it wrote: ${cut(w.wrote)}`,
  ].filter(Boolean).join('\n')

/** The work the Operator set going for them, newest first: what is under way,
 * and what it finished lately. */
export let workingOf = async (g: Glance, most = 6) => {
  let work = await helpingOf(g.store, g.space, g.person, most)
  return work.length
    ? work.map(workLine).join('\n')
    : 'No work has been started for them.'
}

/** What waits on them in their Updates (a question only they can answer,
 * with its choices), then the newest of what they were told. */
export let updatesText = async (g: Glance, most = 8) => {
  let { updates } = await updatesOf(g.store, g.person, g.space, most)
  return updates.length
    ? updates.map((u) =>
      `- ${u.needs ? 'Needs them' : u.unread ? 'Unread' : 'Seen'}, ${
        moment(u.at)
      }: ${cut(u.words, 240)}${
        u.choices?.length
          ? ` (choices: ${u.choices.map((c) => c.label).join(', ')})`
          : ''
      }`
    ).join('\n')
    : 'Their Updates are empty.'
}

/** Their apps, in every space they are in, as space/app and its title. */
export let appsText = async (g: Glance) => {
  let apps = await g.dir.reachable(g.person)
  return apps.length
    ? apps.map(({ space, app }) =>
      `- ${space.slug}/${app.slug}: ${app.title || app.slug}`
    ).join('\n')
    : 'They have no apps.'
}

/** What the voice is told: as the call starts, the time and the newest of
 * the conversation (`recent`) and the work (`work`), and the work again
 * whenever it moves. */
export let glanceOf = (g: Glance) => ({
  recent: async () => {
    let said = await recentOf(g)
    return [
      `It is ${moment(new Date(g.now?.() ?? Date.now()).toISOString())}.`,
      said
        ? `The newest of your conversation with them, oldest first:\n${said}`
        : 'They have not talked with you before.',
    ].join('\n')
  },
  work: async () =>
    `The work you have going for them, newest first:\n${await workingOf(g)}`,
})

/** A status tool of the call's voice: read-only, answered at once. */
export type Look = {
  name: string
  description: string
  parameters: object
  read: () => Promise<string>
}

let NONE = { type: 'object', properties: {} }

/** The voice's status tools, beside `ask`: each reads, none acts. */
export let looks = (g: Glance): Look[] => [
  {
    name: 'work',
    description:
      'What you are working on for them and what you finished lately, newest first: how each piece stands, the step under way, and the latest it wrote. Use it when they ask how something is going.',
    parameters: NONE,
    read: () => workingOf(g, 12),
  },
  {
    name: 'updates',
    description:
      'What waits on them in their Updates (questions only they can answer, with the choices) and the newest of what they were told. Use it when they ask whether anything needs them or what happened.',
    parameters: NONE,
    read: () => updatesText(g),
  },
  {
    name: 'apps',
    description:
      'Their apps, in every space they are in, as space/app and its title. Use it when they ask which apps they have.',
    parameters: NONE,
    read: () => appsText(g),
  },
  {
    name: 'conversation',
    description:
      'More of your conversation with them than you were told, oldest first, with when and how each line came. Use it when they ask what was said earlier.',
    parameters: NONE,
    read: () => recentOf(g, EARLIER).then((s) => s || 'Nothing was said yet.'),
  },
]
