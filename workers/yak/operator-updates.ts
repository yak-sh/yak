/**
 * A person's Updates from a space's Operator: @yaks/inbox read in the
 * Operator's store for them standing in the space (`readInbox`'s scope), in
 * its lanes Needs you and Updates. Their chats are the chat app's.
 *
 * They hold only what was written for them: what the Operator or the
 * platform tells them, a @yaks/notify `notification{to, about}` with its
 * subject and words in `doc{title, body}`, for whoever `to` names: the
 * person, or the space for everyone in it (`notification`); and what the
 * Operator asks them, a @yaks/task decision assigned to them (operator.ts
 * gives every session `decision_new`). How a task stands and what a run
 * reported stay in the chat it was done in, which each Update links to: the
 * conversation it came from, its `created.via`. A choice, or words sent from
 * their Updates, go into their conversation on the `update` channel
 * (operator-channels.ts `BY`), which is the chat about it. A notice they
 * dismiss is archived (@yaks/inbox), and comes back when something happens
 * on it.
 */
import { line, sub } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { readInbox } from '@yaks/inbox/read'
import type { Thread } from '@yaks/inbox'
import { markAttention } from '@yaks/notify/attention'
import { type Choice, showing, shown as shownBy } from '@yaks/task'
import { refuse } from './tool.ts'
import type { OperatorStore } from './operator-store.ts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { caught } from './defects.ts'
import { builderOf, SPACE } from './build-door.ts'

type Store = OperatorStore
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
  /** A notice's line naming the app and what happened. */
  subject?: string
  /** What it tells of: an app, the space, or a task of the Operator's. */
  about?: string
  /** The conversation it came from, opened in the chat. */
  chat?: string
  /** They dismissed it, and nothing has happened on it since. */
  dismissed: boolean
  choices?: Choice[]
  recommended?: string
  /** What its choices show, in the order they show it. */
  shown?: Shown[]
}

/** An entity a choice shows, with the components it is drawn by: an image
 * or file kept in the space (`artifact`), prose (`doc`), or neither, an app,
 * whose draft is drawn. */
export type Shown = {
  choice: string
  eid: string
  artifact?: { address: string; media_type: string }
  doc?: { title?: string; body?: string }
}

/** Something to tell a space's people, shown alone in their Updates and
 * read later, out of any conversation. `to` is a person, or the space for
 * everyone in it; `subject` names the app and what happened; `words` say it
 * plainly to them; `via` is the conversation it came from; `by` is whoever
 * did what it tells, who is not told it; `id` names the event, so telling it
 * twice tells it once. */
export type Telling = {
  to: string
  words: string
  subject?: string
  about?: string
  by?: string
  via?: string
  id?: string
}

/** A notification's row. */
export let notification = (
  { to, words, subject, about, by, via, id }: Telling,
): Bundle => ({
  entity: {
    eid: id ? derivedEid('operator-told|' + id) : crypto.randomUUID(),
  },
  notification: about ? { to, about } : { to },
  doc: subject ? { title: subject, body: words } : { body: words },
  ...by || via
    ? { $actor: { ...by ? { by } : {}, ...via ? { via } : {} } }
    : {},
})

let updateOf = (
  t: Thread,
  row: Bundle | undefined,
  shown: Shown[] = [],
  chat?: string,
): Update => {
  let decision = comp(row, 'decision')
  let note = comp(row, 'notification')
  let doc = comp(row, 'doc')
  return {
    eid: t.eid,
    needs: t.lane == 'Needs you',
    at: t.at,
    unread: t.unread,
    dismissed: t.archived,
    words: String(decision ? decision.question : doc?.body ?? ''),
    ...!decision && doc?.title ? { subject: String(doc.title) } : {},
    ...note?.about ? { about: String(note.about) } : {},
    ...chat ? { chat } : {},
    ...decision
      ? {
        choices: decision.choices as Choice[],
        ...decision.recommended
          ? { recommended: String(decision.recommended) }
          : {},
        ...shown.length ? { shown } : {},
      }
      : {},
  }
}

// What each decision's choices show (@yaks/task `showing`): the `shows`
// edges from it, and the entities they reach, as the page draws them.
let shownOf = async (store: Store, rows: (Bundle | undefined)[]) => {
  let asks = rows.filter((b): b is Bundle => !!b?.decision)
  let edges = await Promise.all(
    asks.map((b) => store.g.read(line`${sub(showing(b.entity.eid))}&*`)),
  )
  let eids = [...new Set(edges.flat().map((b) => String(comp(b, 'edge')!.to)))]
  let held = new Map(
    (eids.length ? await store.g.get(eids) : []).map((
      b,
    ) => [b.entity.eid, b]),
  )
  return new Map(asks.map((b, i) => [
    b.entity.eid,
    [...shownBy(edges[i])].flatMap(([choice, to]) =>
      to.map((eid): Shown => {
        let e = held.get(eid)
        let artifact = comp(e, 'artifact')
        let doc = comp(e, 'doc')
        return {
          choice,
          eid,
          ...artifact
            ? {
              artifact: {
                address: String(artifact.address ?? eid),
                media_type: String(artifact.media_type ?? ''),
              },
            }
            : {},
          ...doc
            ? {
              doc: {
                title: String(doc.title ?? ''),
                body: String(doc.body ?? ''),
              },
            }
            : {},
        }
      })
    ),
  ]))
}

// What its Updates show: what it asks them and what it tells them, and
// nothing else; how a task stands is the chat's. Their chats land in
// Replies, which is the chat app's, so they are never read here.
let WITHIN = ['decision', 'notification']

// Their threads in Updates, the dismissed among them where `all`.
let threadsOf = async (
  store: Store,
  person: string,
  space: string,
  all = false,
) =>
  (await readInbox(
    store.g,
    store.vocab,
    person,
    { within: WITHIN, all },
    space,
  ))
    .filter((t) =>
      LANES.includes(t.lane) &&
      !!(t.row.comps.notification || t.row.comps.decision)
    )

/** The channels whose run's last words were once written into the person's
 * Updates as they stood, as notice `operator-told|<request>`: a run's report
 * for the chat, which their Updates leave out, as they leave out a scheduled
 * run's outcome, once written about its occurrence. A run now writes what it
 * means them to read itself (operator-alerts.ts `notificationSend`). */
let REPORTED = ['error', 'wake', 'subscription', 'escalated', 'fixed']

// How long before its report a run's request can have been made (ms).
let RAN = 24 * 60 * 60_000

// Of `rows`, the notices that were a run's report (`REPORTED`), or a
// scheduled run's outcome (`abouts`, what each tells of). Only a notice with
// no subject and no conversation can be one, and the requests are read only
// when there is such a notice, over the days those notices were written.
let reportsOf = async (
  store: Store,
  rows: (Bundle | undefined)[],
  abouts: Map<string, Bundle>,
) => {
  let unsure = rows.filter((b): b is Bundle =>
    !!b?.notification && !comp(b, 'doc')?.title && !comp(b, 'created')?.via
  )
  if (!unsure.length) return new Set<string>()
  let ats = unsure.map((b) => String(comp(b, 'created')?.at ?? '')).sort()
  let since = new Date(Date.parse(ats[0]) - RAN).toISOString()
  let until = ats.at(-1)!
  let requests = await Promise.all(
    REPORTED.map((channel) =>
      store.g.read(
        line`.operator_request.channel=${channel} .created.at>=${since} .created.at<=${until}&.fields=entity.eid`,
      )
    ),
  )
  let told = new Set(
    requests.flat().map((r) => derivedEid('operator-told|' + r.entity.eid)),
  )
  return new Set(
    unsure.filter((b) =>
      told.has(b.entity.eid) ||
      !!abouts.get(String(comp(b, 'notification')?.about))?.occurrence
    ).map((b) => b.entity.eid),
  )
}

// What each of `rows` tells of, by eid.
let aboutsOf = async (store: Store, rows: (Bundle | undefined)[]) => {
  let abouts = [
    ...new Set(
      rows.map((b) => String(comp(b, 'notification')?.about ?? ''))
        .filter(Boolean),
    ),
  ]
  let held = abouts.length ? await store.g.get(abouts) : []
  return new Map(held.flatMap((b) => b ? [[b.entity.eid, b]] : []))
}

// The conversation each of `rows` came from: the run that wrote it, else
// the work it tells of where that is a session or a task. None opens the
// person's own conversation.
let chatsOf = (rows: (Bundle | undefined)[], abouts: Map<string, Bundle>) =>
  rows.map((b) => {
    let via = comp(b, 'created')?.via
    if (via) return String(via)
    let about = abouts.get(String(comp(b, 'notification')?.about))
    return about?.session || about?.task ? about.entity.eid : undefined
  })

/** A person's Updates in a space, newest first with what needs them ahead,
 * at most `most` of them, and how many wait on them: what needs them, and
 * what they have not read. `dismissed` reads the notices they dismissed
 * instead, which wait on nobody. */
export let updatesOf = async (
  store: Store,
  person: string,
  space: string,
  most = 50,
  dismissed = false,
): Promise<{ updates: Update[]; waiting: number }> => {
  let threads = await threadsOf(store, person, space, dismissed)
  let rows = await store.g.get(threads.map((t) => t.eid))
  let abouts = await aboutsOf(store, rows)
  let reports = await reportsOf(store, rows, abouts)
  let kept = threads.flatMap((t, i) =>
    reports.has(t.eid) || t.archived != dismissed ? [] : [{ t, row: rows[i] }]
  )
  kept.sort((a, b) =>
    +(b.t.lane == 'Needs you') - +(a.t.lane == 'Needs you') ||
    b.t.at.localeCompare(a.t.at)
  )
  let shown = kept.slice(0, most)
  let held = shown.map((s) => s.row)
  let shows = await shownOf(store, held)
  let chats = chatsOf(held, abouts)
  return {
    updates: shown.map(({ t, row }, i) =>
      updateOf(t, row, shows.get(t.eid), chats[i])
    ),
    waiting: dismissed
      ? 0
      : kept.filter(({ t }) => t.unread || t.lane == 'Needs you').length,
  }
}

// One of the person's Updates, dismissed or not, or a refusal: nobody acts
// on another's.
let theirs = async (
  store: Store,
  person: string,
  space: string,
  eid: string,
) => {
  let found = (await threadsOf(store, person, space, true))
    .find((t) => t.eid == eid)
  if (!found) throw refuse('missing', 'That is not in your Updates.')
  return found
}

let opening = async (store: Store, person: string, eid: string) =>
  (await markAttention(store.g, person, eid, 'opened'))
    .map((b) => ({ ...b, $actor: { by: person } }))

/**
 * What a person does in their Updates: reads them (`{}`, or `{seen}` to
 * mark what they read now as read, or `{dismissed}` for the notices they
 * dismissed), reads one (`{open}`), dismisses a notice (`{dismiss}`), reads
 * a file one of their questions shows (`{shown, eid}`: its address and
 * media type), answers a question with a choice (`{choose, choice}`), or
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
  // A file one of their questions shows, by its address in the space.
  if (str('shown')) {
    let found = await theirs(store, person, space, str('shown'))
    let [row] = await store.g.get([found.eid])
    let file = (await shownOf(store, [row])).get(found.eid)
      ?.find((s) => s.eid == str('eid'))?.artifact
    if (!file) throw refuse('missing', 'That question shows no such file.')
    return file
  }
  if (str('dismiss')) {
    let found = await theirs(store, person, space, str('dismiss'))
    if (found.lane == 'Needs you') {
      throw refuse('arguments', 'A question leaves once you answer it.')
    }
    await store.g.apply(
      (await markAttention(store.g, person, found.eid, 'archived'))
        .map((b) => ({ ...b, $actor: { by: person } })),
    )
    return { dismissed: found.eid }
  }
  if (args.dismissed === true) {
    return await updatesOf(store, person, space, 50, true)
  }
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
