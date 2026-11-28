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
 * conversation it came from, its `created.via`. An answer continues that
 * conversation. Words about an update go to the Operator on the `update`
 * channel (operator-channels.ts `BY`). A notice they
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
import {
  matchesUpdate,
  type Place,
  type Shown,
  type Update,
  type UpdateFilter,
} from '@yaks/platform/update-rows'

export type { Place, Shown, Update }
import { refuse } from './tool.ts'
import type { OperatorStore } from './operator-store.ts'
import type { Env } from './env.ts'
import type { Role, Space } from './directory.ts'
import { caught } from './defects.ts'
import { rootAt } from './operator-root.ts'
import { builderOf, SPACE } from './build-door.ts'

type Store = OperatorStore
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** The lanes a person's Updates show: what needs them, then what happened. */
export let LANES = ['Needs you', 'Updates']

/** Something to tell a space's people, shown alone in their Updates and
 * read later, out of any conversation. `to` is a person, or the space for
 * everyone in it; `subject` names the app and what happened; `words` say it
 * plainly to them; `via` is the conversation it came from and `from` the
 * entry there it was written from; `by` is whoever
 * did what it tells, who is not told it; `id` names the event, so telling it
 * twice tells it once. */
export type Telling = {
  to: string
  words: string
  subject?: string
  about?: string
  by?: string
  via?: string
  from?: string
  /** the words it answers, when it is a reply (@yaks/notify `reply`) */
  replies?: string
  id?: string
}

/** A notification's row. */
export let notification = (
  { to, words, subject, about, by, via, from, replies, id }: Telling,
): Bundle => ({
  entity: {
    eid: id ? derivedEid('operator-told|' + id) : crypto.randomUUID(),
  },
  notification: {
    to,
    ...about ? { about } : {},
    ...from ? { from } : {},
  },
  doc: subject ? { title: subject, body: words } : { body: words },
  ...replies ? { reply: { to: replies } } : {},
  ...by || via
    ? { $actor: { ...by ? { by } : {}, ...via ? { via } : {} } }
    : {},
})

let wordsOf = (row: Bundle | undefined) => {
  let decision = comp(row, 'decision')
  let doc = comp(row, 'doc')
  return {
    words: String(decision ? decision.question : doc?.body ?? ''),
    ...!decision && doc?.title ? { subject: String(doc.title) } : {},
  }
}

let updateOf = (
  t: Thread,
  row: Bundle | undefined,
  shown: Shown[] = [],
  from?: Place,
): Update => {
  let decision = comp(row, 'decision')
  let note = comp(row, 'notification')
  return {
    eid: t.eid,
    needs: t.lane == 'Needs you',
    at: t.at,
    unread: t.unread,
    dismissed: t.archived,
    ...wordsOf(row),
    ...note?.about ? { about: String(note.about) } : {},
    ...from ? { from } : {},
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
let MOST = 50

// Their threads in Updates, the dismissed among them where `all`.
let threadsOf = async (
  store: Store,
  person: string,
  space: string,
  all = false,
  target?: string,
) =>
  (await readInbox(
    store.g,
    store.vocab,
    person,
    { within: WITHIN, all, target },
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

/** An entry's place: its session and seq, standing for the call it answers
 * where it is a result, which the chat draws as that call's line. */
export let placed = async (store: Store, b: Bundle | undefined) => {
  let call = comp(b, 'result')?.call
  if (call) [b] = await store.g.get([String(call)], ['entry'])
  let entry = comp(b, 'entry')
  return entry
    ? {
      chat: String(entry.session),
      entry: b!.entity.eid,
      seq: Number(entry.seq),
    }
    : undefined
}

let PLACE_FIELDS = ['entry.session', 'entry.seq', 'created.at', 'result.call']

// The newest entry of `session` at or before `seq`, by its (session, seq)
// index, one row read.
let before = async (store: Store, session: string, seq: number) =>
  (await store.g.read(
    line`.entry.session=${session}&.entry.seq<=${seq}&.order=-entry.seq&.limit=1&.fields=${PLACE_FIELDS}`,
  ))[0] as Bundle | undefined

// The entry of `session` written last at or before `at`: a search by seq,
// whose order is its entries' time, so a long conversation costs a few
// dozen one-row reads rather than reading it through.
let entryAt = async (store: Store, session: string, at: string) => {
  let last = await before(store, session, Number.MAX_SAFE_INTEGER)
  let when = (b?: Bundle) => String(comp(b, 'created')?.at ?? '')
  if (!last || when(last) <= at) return last
  let [lo, hi] = [0, Number(comp(last, 'entry')!.seq)]
  let found: Bundle | undefined
  while (lo <= hi) {
    let mid = Math.floor((lo + hi) / 2)
    let b = await before(store, session, mid)
    // None at or before `mid`: its first entry is past it.
    if (!b) lo = mid + 1
    else if (when(b) <= at) {
      found = b
      lo = Number(comp(b, 'entry')!.seq) + 1
    } else hi = Number(comp(b, 'entry')!.seq) - 1
  }
  return found
}

// Where each of `rows` came from: the entry a notice was written from, else
// the entry written last before it in the run that wrote it, else the work
// it tells of where that is a session or a task, else the entry written
// beside it in the person's own conversation (`root`) where one was, as an
// app's word is. None opens their own conversation.
let placesOf = async (
  store: Store,
  rows: (Bundle | undefined)[],
  abouts: Map<string, Bundle>,
  root: string,
): Promise<(Place | undefined)[]> => {
  let fromOf = (b: Bundle | undefined) =>
    String(comp(b, 'notification')?.from ?? '')
  let viaOf = (b: Bundle | undefined) => String(comp(b, 'created')?.via ?? '')
  let atOf = (b: Bundle | undefined) => String(comp(b, 'created')?.at ?? '')
  let sources = [...new Set(rows.map(fromOf).filter(Boolean))]
  let bySource = new Map(
    (await store.g.get(sources, ['entry', 'result']))
      .filter(Boolean).map((b) => [b.entity.eid, b]),
  )
  let beside = (b: Bundle | undefined) => {
    let about = abouts.get(String(comp(b, 'notification')?.about))
    return about?.session || about?.task ? about : undefined
  }
  // An old notice with no run only links to an entry written in the same
  // transaction. Seek all its exact timestamps through created.at at once.
  let times = [
    ...new Set(
      rows.flatMap((b) => viaOf(b) || beside(b) ? [] : [atOf(b)]).filter(
        Boolean,
      ),
    ),
  ]
  let byTime = new Map<string, Bundle>()
  if (times.length) {
    let entries = await store.g.read(
      line`.created.at=${times}&.entry&.fields=${PLACE_FIELDS}`,
    )
    for (let row of entries) {
      let entry = comp(row, 'entry')
      if (entry?.session != root) continue
      let at = atOf(row)
      if (
        Number(entry.seq) >
          Number(comp(byTime.get(at), 'entry')?.seq ?? -Infinity)
      ) {
        byTime.set(at, row)
      }
    }
  }
  return Promise.all(rows.map(async (b) => {
    let source = await placed(store, bySource.get(fromOf(b)))
    if (source) return source
    let via = viaOf(b), at = atOf(b)
    if (via) {
      return await placed(store, await entryAt(store, via, at)) ?? { chat: via }
    }
    let about = beside(b)
    if (about) return { chat: about.entity.eid }
    return await placed(store, byTime.get(at))
  }))
}

// An approval nobody answered before it expired: it asks nothing now.
let lapsed = (row: Bundle | undefined, now: number) => {
  let a = comp(row, 'operator_approval')
  return !!a && !row!.decided && Date.parse(String(a.expires)) < now
}

/** A person's Updates in a space, newest first with what needs them ahead,
 * at most `most` of them, and how many wait on them: what needs them, and
 * what they have not read. A history read applies its filter before
 * selecting any cards to draw. */
export let updatesOf = async (
  store: Store,
  person: string,
  space: string,
  most = MOST,
  filter: UpdateFilter = {},
  now = Date.now(),
): Promise<{ updates: Update[]; waiting: number; expires: number }> => {
  let { kept, abouts } = await keptOf(store, person, space, filter, now)
  let shown = kept.slice(0, most)
  let held = shown.map((s) => s.row)
  let [shows, places] = await Promise.all([
    shownOf(store, held),
    rootAt(store, space, person).then((root) =>
      placesOf(store, held, abouts, root)
    ),
  ])
  return {
    updates: shown.map(({ t, row }, i) =>
      updateOf(t, row, shows.get(t.eid), places[i])
    ),
    waiting: waitingIn(kept),
    expires: expiresIn(kept),
  }
}

// The person's Updates as their page lists them, newest first with what
// needs them ahead, and what each tells of. Reports and lapsed approvals
// stay out of Updates, including the archive and search.
let keptOf = async (
  store: Store,
  person: string,
  space: string,
  { archived = false, q }: UpdateFilter,
  now: number,
) => {
  let threads = (await threadsOf(store, person, space, archived || !!q))
    .filter((t) => q || t.archived == archived)
  let rows = await store.g.get(threads.map((t) => t.eid))
  let matching = threads.flatMap((t, i) =>
    lapsed(rows[i], now) || q && !matchesUpdate(q, wordsOf(rows[i]))
      ? []
      : [{ t, row: rows[i] }]
  )
  let held = matching.map(({ row }) => row)
  let abouts = await aboutsOf(store, held)
  let reports = await reportsOf(store, held, abouts)
  let kept = matching.filter(({ t }) => !reports.has(t.eid))
  kept.sort((a, b) =>
    +(b.t.lane == 'Needs you') - +(a.t.lane == 'Needs you') ||
    b.t.at.localeCompare(a.t.at)
  )
  return { kept, abouts }
}

// How many wait on the person: what needs them, and what they have not read.
// The one count every badge of their Updates says.
let waitingIn = (kept: { t: Thread }[]) =>
  kept.filter(({ t }) => !t.archived && (t.unread || t.lane == 'Needs you'))
    .length

/** The updates counted by the installed icon, and the newest unread alert
 * that a Safari dismissal can re-show. */
export let alertUpdatesOf = async (
  store: Store,
  person: string,
  space: string,
) => {
  let { kept } = await keptOf(store, person, space, {}, Date.now())
  let waiting = kept.filter(({ t, row }) =>
    t.unread && !!row?.delivered &&
    (comp(row, 'delivered')?.channel ?? 'push') == 'push' &&
    (row.decision
      ? t.lane == 'Needs you' && comp(row, 'filed')?.assignee == person
      : comp(row, 'notification')?.to == person)
  ).toSorted((a, b) => b.t.at.localeCompare(a.t.at))
  return {
    updates: kept.slice(0, 50).map(({ t }) => ({
      needs: t.lane == 'Needs you',
    })),
    next: waiting[0]?.row,
  }
}

/** How many of a person's Updates in a space wait on them, as `updatesOf`
 * counts them, without drawing any: the Operator switcher's badge. */
export let waitingOf = async (
  store: Store,
  person: string,
  space: string,
  now = Date.now(),
): Promise<number> => (await waitingUntil(store, person, space, now)).count

/** The count and the next approval expiry that can move it. */
export let waitingUntil = async (
  store: Store,
  person: string,
  space: string,
  now: number,
) => {
  let { kept } = await keptOf(store, person, space, {}, now)
  return { count: waitingIn(kept), expires: expiresIn(kept) }
}

// When the next approval waiting on the person lapses, which moves what
// waits on them without a write: Infinity for none.
let expiresIn = (kept: { t: Thread; row: Bundle | undefined }[]) =>
  kept.reduce((next, { row, t }) => {
    if (row?.decided || (!t.unread && t.lane != 'Needs you')) return next
    let at = Date.parse(String(comp(row, 'operator_approval')?.expires))
    return Number.isFinite(at) ? Math.min(next, at + 1) : next
  }, Infinity)

// One of the person's Updates, dismissed or not, or a refusal: nobody acts
// on another's.
let theirs = async (
  store: Store,
  person: string,
  space: string,
  eid: string,
) => {
  let [found] = await threadsOf(store, person, space, true, eid)
  if (!found) throw refuse('missing', 'That is not in your Updates.')
  return found
}

let opening = async (store: Store, person: string, eid: string) =>
  (await markAttention(store.g, person, eid, 'opened'))
    .map((b) => ({ ...b, $actor: { by: person } }))

let acknowledge = async (store: Store, person: string, seen: string[]) => {
  if (seen.length) {
    await store.g.apply(
      (await Promise.all(seen.map((eid) => opening(store, person, eid))))
        .flat(),
    )
  }
}

export type UpdateCounts = { waiting: number; needs: number }

/** The Operator page's badge counts. Only unread notices need their chat
 * resolved when a person opens one, so the chat can mark those notices read. */
export let updateCounts = async (
  store: Store,
  person: string,
  space: string,
  root: string,
  chat?: string,
): Promise<UpdateCounts> => {
  let { kept, abouts } = await keptOf(store, person, space, {}, Date.now())
  let shown = kept.slice(0, MOST)
  let waiting = waitingIn(kept)
  let needs = shown.filter(({ t }) => t.lane == 'Needs you').length
  if (!chat) return { waiting, needs }
  let unread = shown.filter(({ t }) => t.unread && t.lane != 'Needs you')
  let places = await placesOf(store, unread.map(({ row }) => row), abouts, root)
  let seen = unread.flatMap(({ t }, i) =>
    places[i]?.chat == chat ? [t.eid] : []
  )
  await acknowledge(store, person, seen)
  return { waiting: waiting - seen.length, needs }
}

/** A person's Updates once they opened the conversation `chat`: what came
 * from it is read now, since they are reading it there, and counts no more. */
export let openedIn = async (
  store: Store,
  person: string,
  read: { updates: Update[]; waiting: number },
  chat: string,
) => {
  let seen = read.updates.filter((u) =>
    u.unread && !u.needs && u.from?.chat == chat
  )
  if (!seen.length) return read
  let now = new Set(seen.map((u) => u.eid))
  await acknowledge(store, person, [...now])
  return {
    updates: read.updates.map((u) =>
      now.has(u.eid) ? { ...u, unread: false } : u
    ),
    waiting: read.waiting - seen.length,
  }
}

/** Of `eids`, the rows told or put to `person` that they have read,
 * dismissed or answered, or that were withdrawn: what a notification of
 * them no longer needs to say. Rows that are not theirs are left out. */
export let handledOf = async (store: Store, person: string, eids: string[]) => {
  let rows = eids.length ? await store.g.get(eids) : []
  let theirs = rows.filter((r): r is Bundle =>
    !!r && (comp(r, 'notification')?.to == person ||
      comp(r, 'filed')?.assignee == person)
  )
  let marks = await Promise.all(theirs.map(async (r) => {
    if (r.decided || r.cancelled || r.completed) return true
    let [attended] = await store.g.read(
      line`.subscription.actor=${person}&.subscription.target=${r.entity.eid}&*`,
    )
    return !!(attended?.opened || attended?.archived)
  }))
  return theirs.filter((_, i) => marks[i]).map((r) => r.entity.eid)
}

/**
 * What a person does in their Updates: reads them (`{}`, or `{seen}` to
 * mark what they read now as read, or `{dismissed}` for the notices they
 * dismissed, or `{count}` for how many wait on them alone), reads one (`{open}`), dismisses a notice (`{dismiss}`), reads
 * a file one of their questions shows (`{shown, eid}`: its address and
 * media type), answers a question with a choice (`{choose, choice}`), or
 * sends words about one (`{reply, say}`), which opens the chat; words on
 * what a stranger's conversation raised answer it. `{handled}` names rows a
 * device still shows notifications of, and answers which of them they have
 * read or answered since, which that device takes away (`handledOf`).
 */
export let updating = async (
  store: Store,
  held: {
    person: string
    space: string
    role?: Role | null
    administrative?: boolean
  },
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
    return await updatesOf(store, person, space, 50, { archived: true })
  }
  let q = str('q').trim()
  if (q || args.archived === true) {
    return await updatesOf(store, person, space, Infinity, {
      q: q || undefined,
      archived: args.archived === true,
    })
  }
  if (Array.isArray(args.handled)) {
    let asked = args.handled.filter((e): e is string => typeof e == 'string')
    return { handled: await handledOf(store, person, asked.slice(0, 50)) }
  }
  if (args.count === true) {
    return { waiting: await waitingOf(store, person, space) }
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
    let decided = found.row.comps.decided
    if (decided?.by == person && decided.choice == say) {
      return { answered: about }
    }
    if (!found.row.comps.decision || found.lane != 'Needs you') {
      throw refuse('arguments', 'That asks nothing of you now.')
    }
    if (!say) throw refuse('arguments', 'Choose one.')
  }
  if (!say) throw refuse('arguments', 'Say something about it.')
  let opened = await opening(store, person, about)
  // Words on what a stranger's conversation raised answer it, in their own
  // words: only an answer starts their conversation on it
  // (operator-escalate.ts `taken`).
  let [row] = found.lane == 'Needs you'
    ? await store.g.get([about], [
      'operator_escalation',
      'operator_approval',
      'approval_ask',
    ])
    : []
  if (str('choose') && (row?.operator_approval || row?.approval_ask)) {
    let { checkApproval } = await import('./operator-approvals.ts')
    await checkApproval(
      store,
      row,
      person,
      () => Promise.resolve(held.role ?? null),
    )
  }
  let raised = !!row?.operator_escalation
  if (str('choose') || raised) {
    // Their own press, signed in as themselves: the system writes it, as
    // only it answers what waits on a person (@yaks/platform/operator-graph
    // `answering`).
    await store.g.apply([
      ...opened,
      {
        entity: { eid: about },
        decided: { choice: say },
        $was: { decided: { '': null }, cancelled: { '': null } },
        $actor: { by: person },
      },
    ], { trusted: true })
    return { answered: about }
  }
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
    { id: str('id') || undefined, also: opened },
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
