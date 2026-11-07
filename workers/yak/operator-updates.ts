/**
 * A person's Updates from a space's Operator: @yaks/inbox read in the
 * Operator's store for them standing in the space (`readInbox`'s scope), in
 * its lanes Needs you and Updates. Their chats are the chat app's.
 *
 * What the Operator tells them is a @yaks/notify `notification{about}` with
 * its words in `doc{body}`, for whoever `deliver{to}` names: the person, or
 * the space for everyone in it (`notification`). What it asks them is a @yaks/task
 * decision, assigned to them (operator.ts gives every session
 * `decision_new`). A choice, or words sent from their Updates, go into their
 * conversation on the `update` channel (operator-channels.ts `BY`), which is
 * the chat about it.
 */
import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { readInbox } from '@yaks/inbox/read'
import type { Thread } from '@yaks/inbox'
import { markAttention } from '@yaks/notify/attention'
import type { Choice } from '@yaks/task'
import { refuse } from './tool.ts'
import type { operatorStore } from './operator-store.ts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { caught } from './defects.ts'
import { builderOf, SPACE } from './build-door.ts'

type Store = ReturnType<typeof operatorStore>
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** The lanes a person's Updates show: what needs them, then what happened. */
export let LANES = ['Needs you', 'Updates']

/** One item of a person's Updates, as their page draws it. */
export type Update = {
  eid: string
  /** It asks them something (Needs you). */
  needs: boolean
  at: string
  unread: boolean
  /** Its words: what happened, or the question. */
  words: string
  /** What it tells of: an app, the space, or a task of the Operator's. */
  about?: string
  /** A task of theirs the Operator worked on, opened in the chat. */
  work?: string
  choices?: Choice[]
  recommended?: string
}

/** Something to tell a space's people. `to` is a person, or the space for
 * everyone in it; `by` is whoever did what it tells, who is not told it;
 * `id` names the event, so telling it twice tells it once. */
export type Telling = {
  to: string
  words: string
  about?: string
  by?: string
  id?: string
}

/** A notification's row. */
export let notification = ({ to, words, about, by, id }: Telling): Bundle => ({
  entity: {
    eid: id ? derivedEid('operator-told|' + id) : crypto.randomUUID(),
  },
  notification: about ? { about } : {},
  deliver: { to },
  doc: { body: words },
  ...by ? { $actor: { by } } : {},
})

// How a task of theirs stands, in a word before its title.
let STANDING: [string, string][] = [
  ['completed', 'Finished'],
  ['failed', 'Could not finish'],
  ['cancelled', 'Stopped'],
]

let updateOf = (t: Thread, row: Bundle | undefined): Update => {
  let decision = comp(row, 'decision')
  let note = comp(row, 'notification')
  let title = String(comp(row, 'doc')?.title ?? '')
  let standing = STANDING.find(([mark]) => row?.[mark])?.[1]
  return {
    eid: t.eid,
    needs: t.lane == 'Needs you',
    at: t.at,
    unread: t.unread,
    words: decision
      ? String(decision.question)
      : note
      ? String(comp(row, 'doc')?.body ?? '')
      : standing
      ? `${standing}: ${title}`
      : title,
    ...note?.about ? { about: String(note.about) } : {},
    ...row?.task && !decision ? { work: t.eid } : {},
    ...decision
      ? {
        choices: decision.choices as Choice[],
        ...decision.recommended
          ? { recommended: String(decision.recommended) }
          : {},
      }
      : {},
  }
}

// What its Updates show: its tasks, its questions and what it tells. Their
// chats land in Replies, which is the chat app's, so they are never read here.
let WITHIN = ['task', 'decision', 'notification']

let threadsOf = async (store: Store, person: string, space: string) =>
  (await readInbox(store.g, store.vocab, person, { within: WITHIN }, space))
    .filter((t) => LANES.includes(t.lane))

/** A person's Updates in a space, newest first with what needs them ahead,
 * at most `most` of them, and how many wait on them: what needs them, and
 * what they have not read. */
export let updatesOf = async (
  store: Store,
  person: string,
  space: string,
  most = 50,
): Promise<{ updates: Update[]; waiting: number }> => {
  let threads = await threadsOf(store, person, space)
  threads.sort((a, b) =>
    +(b.lane == 'Needs you') - +(a.lane == 'Needs you') ||
    b.at.localeCompare(a.at)
  )
  let shown = threads.slice(0, most)
  let rows = await store.g.get(shown.map((t) => t.eid))
  return {
    updates: shown.map((t, i) => updateOf(t, rows[i])),
    waiting: threads.filter((t) => t.unread || t.lane == 'Needs you').length,
  }
}

// One of the person's Updates, or a refusal: nobody acts on another's.
let theirs = async (
  store: Store,
  person: string,
  space: string,
  eid: string,
) => {
  let found = (await threadsOf(store, person, space)).find((t) => t.eid == eid)
  if (!found) throw refuse('missing', 'That is not in your Updates.')
  return found
}

let opening = async (store: Store, person: string, eid: string) =>
  (await markAttention(store.g, person, eid, 'opened'))
    .map((b) => ({ ...b, $actor: { by: person } }))

/**
 * What a person does in their Updates: reads them (`{}`, or `{seen}` to
 * mark what they read now as read), reads one (`{open}`), answers a question with a choice (`{choose, choice}`), or
 * sends words about one (`{reply, say}`). A choice or words go into their
 * conversation with the Operator, as request `id`, which opens the chat.
 */
export let updating = async (
  store: Store,
  held: { person: string; space: string; administrative?: boolean },
  args: Record<string, unknown>,
) => {
  let { person, space } = held
  let str = (k: string) => typeof args[k] == 'string' ? args[k] as string : ''
  if (str('open')) {
    await theirs(store, person, space, str('open'))
    await store.g.apply(await opening(store, person, str('open')))
    return { opened: str('open') }
  }
  let about = str('choose') || str('reply')
  if (!about) {
    let read = await updatesOf(store, person, space)
    let unread = read.updates.filter((u) => u.unread)
    if (args.seen === true && unread.length) {
      await store.g.apply(
        (await Promise.all(unread.map((u) => opening(store, person, u.eid))))
          .flat(),
      )
    }
    return read
  }
  let found = await theirs(store, person, space, about)
  let say = (str('choose') ? str('choice') : str('say')).trim()
  if (str('choose')) {
    if (!found.row.comps.decision || found.lane != 'Needs you') {
      throw refuse('arguments', 'That asks nothing of you now.')
    }
    if (!say) throw refuse('arguments', 'Choose one.')
  }
  if (!say) throw refuse('arguments', 'Say something about it.')
  await store.g.apply([
    ...await opening(store, person, about),
    ...str('choose')
      ? [{
        entity: { eid: about },
        decided: { choice: say },
        $actor: { by: person },
      }]
      : [],
  ])
  // The channels load with the words a person sends, not with every read.
  let { receive } = await import('./operator-channels.ts')
  let request = await receive(
    store,
    {
      channel: 'update',
      person,
      space,
      about,
      ...held.administrative ? { administrative: true } : {},
    },
    say,
    { id: str('id') || undefined },
  )
  return { request }
}

/** Tell a space's people something, through its Operator's store: the
 * kernel's to bring (build.ts `/operator/tell`), for nobody in particular.
 * A failure is reported, and never fails what it tells of. */
export let tell = async (env: Env, space: Space, telling: Telling) => {
  try {
    let response = await builderOf(env, space.eid)(() =>
      new Request('https://builder/operator/tell', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-yak-kernel': '1',
          [SPACE]: space.eid,
        },
        body: JSON.stringify(telling),
      })
    )
    if (!response.ok) {
      throw new Error(`the Operator was not told (${response.status})`)
    }
    await response.body?.cancel()
  } catch (e) {
    caught(e, { request: 'operator tell', space: space.slug })
  }
}
