import { answerTransfer, transferUpdates } from './app-transfer.ts'
import {
  answerFriend,
  friendUpdates,
  messageUpdates,
  replyFriend,
} from './friends.ts'
// Updates from the Operator (T-140508): what happened in a space, as messages
// from its Operator a person can reply to, at `/<space>/updates`
// (@yaks/platform/routes `talkPath('updates', …)`), beside the chat app's side
// (operator-page.ts `updatesPage`). They are @yaks/inbox's, read in the
// Operator's store (operator-updates.ts): what needs the person first, with a
// button for each choice, then what happened, newest first. A choice, or
// words about one, go into their conversation, and the chat they went to
// opens. Every space's together are at `/updates` (`allUpdates`), the
// same read across the spaces a person talks with an Operator in
// (`updatesAcross`).
import { bound, type Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import { type ComponentChildren, Fragment, h } from 'preact'
import { Card } from '@yaks/ui/parts'
import { operatorDoor } from './build-door.ts'
import { backTo, chatPath, talkPath } from '@yaks/platform/routes'
import { apex } from '@yaks/platform/host'
import { browserImmutable } from '@yaks/platform/kept'
import type { Update } from './operator-updates.ts'
import {
  type Apps,
  bySha,
  card,
  cardsView,
  chatAt,
  draftAt,
  type Spot,
  spotOf,
  type UpdatesView,
} from '@yaks/platform/updates-view'
import { newsOrder, offerRows, updateRows } from '@yaks/platform/update-rows'
import { appRows } from '@yaks/platform/side-rows'
import type { MarkedApp } from '@yaks/platform/routes'
import { drawnRows } from '@yaks/platform/page-graph'

export { type Apps, bySha, chatAt, draftAt }
import { lastDay } from './views.ts'
import { PICTURES } from '@yaks/session/conversation'
import { caught } from './defects.ts'
import { attachmentKey } from './attachments.ts'
import { type Directory, directory, directoryOf, fetch } from './directory.ts'
import { EID, inApp } from './tool.ts'
import { linkOf } from './preview.ts'
import { draftsOf, theirs } from './written.ts'
import { CallError, refused as toolRefused } from '@yaks/tools/errors'
import { refusal } from '@yaks/api/refuse'
import { status } from '@yaks/graph/errors'
import { writes } from '@yaks/member'
import { waitingBundle } from '@yaks/platform/update-waiting'
import {
  actionKinds,
  answerField,
  type InboxAction,
  type InboxReceipt,
} from '@yaks/inbox/actions'
import type { Clock } from './timing.ts'

/** A space a person reads Updates in, and who they are there. */
export type Seat = { space: Space; who: Who }

/** One of a person's Updates, with the space whose Operator wrote it. */
export type Placed = Update & { space: Space }

/** A person's Updates, and how many wait on them: what needs them, and what
 * they have not read, which the side counts beside "Updates from
 * <Operator>" and the Operator switcher beside each space. */
export type Updates = { updates: Placed[]; waiting: number }

/** One space's Updates as read: the Operator's (`cards`) and what the
 * directory holds (`offers`), and all of them placed in the space. */
export type Read = Updates & {
  space: Space
  cards: Update[]
  offers: Update[]
}

/** A space whose Operator did not answer, and how it failed. */
export type Missed = { space: Space; error: unknown }

/** What reading Updates asks of each space: what they read now marked read
 * (`seen`), or the notices they dismissed (`dismissed`). */
type Asking = { seen?: boolean; dismissed?: boolean }

/** A person's Updates across the spaces they stand in: @yaks/inbox read in
 * each space's Operator store (operator-updates.ts), as one list, what needs
 * them first and then newest first, each with its space, and how many wait
 * on them in all and in each space (`by`, by slug). A space whose Operator
 * did not answer is left out, its failure in `missed` for the caller. One space's Updates
 * are this read of that space alone (`updatesOf`). */
export let updatesAcross = async (
  env: Env,
  seats: Seat[],
  { seen = false, dismissed = false }: Asking = {},
): Promise<
  Updates & { by: Map<string, number>; missed: Missed[]; read: Read[] }
> => {
  let args = dismissed ? { dismissed } : seen ? { seen } : {}
  let missed: Missed[] = []
  let read = await Promise.all(seats.map(async ({ space, who }) => {
    try {
      let [{ updates, waiting }, offers] = await Promise.all([
        operatorDoor(env, space, who, 'updates', args) as Promise<
          { updates: Update[]; waiting: number }
        >,
        dismissed ? [] : offersOf(env, space, who, seen),
      ])
      return {
        space,
        waiting: waiting + offers.filter((u) => u.needs).length,
        updates: [...updates, ...offers].map((u) => ({ ...u, space })),
        cards: updates,
        offers,
      }
    } catch (error) {
      missed.push({ space, error })
      return { space, waiting: 0, updates: [], cards: [], offers: [] }
    }
  }))
  let updates = read.flatMap((r) => r.updates).sort(newsOrder)
  return {
    updates,
    waiting: read.reduce((n, r) => n + r.waiting, 0),
    by: new Map(read.map((r) => [r.space.slug, r.waiting])),
    missed,
    read,
  }
}

/** A person's Updates in one space, and what it read (`read`): the
 * Operator's and the directory's. `seen` marks what they read now as read. */
export let updatesOf = async (
  env: Env,
  space: Space,
  who: Who,
  seen = false,
): Promise<Updates & { read: Read[] }> => {
  let { updates, waiting, missed, read } = await updatesAcross(env, [{
    space,
    who,
  }], { seen })
  if (missed.length) throw missed[0].error
  return { updates, waiting, read }
}

/** The notices a person dismissed in a space, newest first. */
export let dismissedOf = async (
  env: Env,
  space: Space,
  who: Who,
): Promise<Updates> => {
  let { updates, waiting, missed } = await updatesAcross(env, [{
    space,
    who,
  }], { dismissed: true })
  if (missed.length) throw missed[0].error
  return { updates, waiting }
}

// What the directory holds for a person beside their Operator's
// Updates: apps offered to the space, friend requests and suggestions, and
// messages from friends, which reading (`seen`) marks read.
let requestsOf = async (dir: Directory, space: Space, who: Who) =>
  (await Promise.all([
    transferUpdates(dir, space, who),
    friendUpdates(dir, space, who),
  ])).flat()

/** The seats and the directory's share of their Updates counts. */
export let waitingSeats = async (dir: Directory, person: string) =>
  Promise.all(
    (await dir.seated(person))
      .filter(({ space, role }) => !space.trashed && writes(role))
      .map(async ({ space, role }) => {
        let requests = await requestsOf(dir, space, { person, role })
        return {
          space,
          role,
          bundle: waitingBundle(person, {
            space: space.eid,
            slug: space.slug,
            count: requests.filter((u) => u.needs).length,
          }),
        }
      }),
  )

let offersOf = (env: Env, space: Space, who: Who, seen = false) =>
  offersIn(directory(bound(env.DIRECTORY, fetch, env)), space, who, seen)

/** What the directory holds for a person beside their Operator's Updates
 * in a space (`requestsOf`), and their friends' messages, which reading
 * (`seen`) marks read. */
export let offersIn = async (
  dir: Directory,
  space: Space,
  who: Who,
  seen = false,
) =>
  (await Promise.all([
    requestsOf(dir, space, who),
    messageUpdates(dir, space, who, seen),
  ])).flat()

/** The notices a person dismissed, newest first, and the way back to the
 * rest. */
export let dismissedUpdates = (
  env: Env,
  space: Space,
  { updates }: { updates: Update[]; waiting: number },
  apps: Apps = [],
) =>
  h(
    Fragment,
    null,
    h(
      'p',
      { class: 'Note Update_About' },
      'What you dismissed. Each comes back to your Updates when something new happens on it. ',
      h('a', { href: talkPath('updates', space.slug) }, 'Back to Updates'),
    ),
    updates.length
      ? updates.map((u) => card({ space, apex: apex(env) }, u, apps))
      : h('p', { class: 'Update_Meta' }, 'Nothing dismissed.'),
  )

/** How long the Updates page waits on the last day's visits before it is
 * drawn without them: they are a curiosity, never worth a slow page. */
export let VISITS_WAIT = 1500

/** Each app's visits in the last day, or none where they are not switched on
 * or not answered within `wait`. */
export let visitsOf = async (
  env: Env,
  apps: Apps,
  wait = VISITS_WAIT,
): Promise<Map<string, number> | undefined> => {
  let asked = apps.length ? lastDay(env, apps.map((a) => a.eid)) : null
  if (!asked) return undefined
  let timer: number | undefined
  try {
    return await Promise.race([
      asked,
      new Promise<undefined>((done) => timer = setTimeout(done, wait)),
    ])
  } catch (e) {
    caught(e, { request: 'updates visits' })
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

let COUNT = new Intl.NumberFormat('en')

/** The Operator's word on the last day, said when the page is drawn: the
 * visits across the apps and the busiest of them, when there are any to
 * count. How many things need the person is the side's bell to say. The
 * server knows no one's clock, so it is the last day and not today. */
export let lastDayLine = (
  apps: Apps,
  views: Map<string, number> | undefined,
) => {
  let said: string[] = []
  if (views && apps.length) {
    let counted = apps.map((a) => ({ a, n: views.get(a.eid) ?? 0 }))
      .filter((c) => c.n > 0).sort((x, y) => y.n - x.n)
    let total = counted.reduce((sum, c) => sum + c.n, 0)
    said.push(
      total
        ? `In the last day, your apps had ${COUNT.format(total)} visit${
          total == 1 ? '' : 's'
        }.`
        : 'Nobody visited your apps in the last day.',
    )
    if (counted.length > 1) {
      said.push(`${counted[0].a.title || counted[0].a.slug} was the busiest.`)
    }
  }
  return said.join(' ')
}

/** What the Updates page shows under its bar: the day, then what waits on
 * the person, the rows of their servers' `lists` that wait before the
 * Updates that need them, then what happened. */
export let updates = (
  env: Env,
  space: Space,
  news: Updates & { read?: Read[] },
  lists: ComponentChildren = null,
  apps: MarkedApp[] = [],
  views?: Map<string, number>,
  friends?: string,
  person = '',
) => {
  let day = lastDayLine(apps, views)
  return h(
    Fragment,
    null,
    about(space),
    day
      ? h(
        Card,
        { class: 'Update Update-day' },
        h('p', {
          class: 'Update_Words',
        }, day),
      )
      : null,
    friends
      ? h(
        Card,
        { class: 'Update Update-day' },
        h('p', { class: 'Update_Words' }, friends),
      )
      : null,
    lists,
    listed(env, person, [space], news, () => apps),
    dismissedLink(space),
  )
}

let about = (space: Space) =>
  h(
    'p',
    { class: 'Note Update_About' },
    `${space.operator} writes here when something happens in your apps, and asks here when something needs you. Ask about any of it, and the chat opens.`,
  )

let dismissedLink = (space: Space) =>
  h(
    'p',
    { class: 'Update_Meta' },
    h(
      'a',
      { href: talkPath('updates', space.slug) + '?dismissed' },
      'See what you dismissed',
    ),
  )

/** The Updates page's view on a page opened at another of its views
 * (@yaks/platform/talk-views): its cards are drawn in the browser from the
 * tab's page graph as its watches answer, and the last day's word is left
 * to the page itself. */
export let updatesLater = (
  env: Env,
  space: Space,
  lists: ComponentChildren,
  person: string,
) =>
  h(
    Fragment,
    null,
    about(space),
    lists,
    listed(env, person, [space], { updates: [], waiting: 0 }, () => [], {
      drawn: false,
    }),
    dismissedLink(space),
  )

/** The person's Updates from every space's Operator, at `/updates`. */
export let ALL = talkPath('updates')

// The cards of `news` in `spaces`, as a view the browser draws again from
// the page graph (@yaks/platform/updates-list-browser), carrying the rows
// they were drawn from, which the page graph starts with until its watches
// answer. `back` is the page of every space's Updates. Where `drawn` is
// false the browser draws them all, and the server none.
let listed = (
  env: Env,
  person: string,
  spaces: Space[],
  { updates, read = [] }: Updates & { read?: Read[] },
  apps: (space: Spot) => Apps,
  { back, drawn = true }: { back?: string; drawn?: boolean } = {},
) => {
  let view: UpdatesView = {
    person,
    spaces: spaces.map(spotOf),
    apex: apex(env),
    ...back ? { back } : {},
  }
  let rows = read.flatMap(({ space, cards, offers }) => [
    ...updateRows(person, space.eid, cards),
    ...offerRows(person, space.eid, offers),
    ...appRows(person, space.eid, apps(space)),
  ])
  return h(
    'div',
    {
      class: 'Update_List',
      'data-view': 'updates',
      'data-updates-view': JSON.stringify(view),
    },
    drawn ? cardsView(view, updates, apps) : null,
    person && read.length
      ? h('script', {
        type: 'application/json',
        'data-page-graph': '',
        dangerouslySetInnerHTML: { __html: drawnRows(person, rows) },
      })
      : null,
  )
}

/** The person's Updates from every space's Operator together, newest first
 * with what needs them ahead: each card names the space and Operator it came
 * from, acts as it does on that space's page, and comes back here. A space
 * whose Operator did not answer says so. `apps` are each space's, by slug. */
export let allUpdates = (
  env: Env,
  news: Updates & { read: Read[] },
  apps: Map<string, Apps>,
  missed: Space[] = [],
  person = '',
) =>
  h(
    Fragment,
    null,
    h(
      'p',
      { class: 'Note Update_About' },
      'What the Operator of each of your spaces wrote or asked you, together. Ask about any of it, and its chat opens.',
    ),
    missed.map((space) =>
      h(
        'p',
        { class: 'Note' },
        `${space.operator} in ${
          space.title || space.slug
        } could not be reached just now. Open this page again to try.`,
      )
    ),
    listed(
      env,
      person,
      news.read.map((r) => r.space),
      news,
      (space) => apps.get(space.slug) ?? [],
      { back: ALL },
    ),
  )

/** Commit the action where the card came from and return its receipt. */
let commitAction = async (
  env: Env,
  space: Space,
  who: Who,
  { kind, target, answer }: InboxAction,
  receipt: boolean,
): Promise<InboxReceipt> => {
  switch (kind) {
    case 'transfer': {
      let kind = await answerTransfer(env, space, who, target, answer)
      return {
        label: answer == 'decline'
          ? 'Declined'
          : kind == 'domain'
          ? 'Domain accepted'
          : 'App accepted',
      }
    }
    case 'friend': {
      let standing = await answerFriend(env, who, target, answer, receipt)
      return {
        label: answer == 'declined'
          ? 'Dismissed'
          : standing == 'friend'
          ? 'Friends'
          : 'Request sent',
      }
    }
    case 'dismiss':
      await operatorDoor(env, space, who, 'updates', { dismiss: target })
      return { label: 'Dismissed' }
    case 'choose':
      await operatorDoor(env, space, who, 'updates', {
        choose: target,
        choice: answer,
      })
      return { label: 'Answer sent' }
    case 'seen':
      await updatesOf(env, space, who, true)
      return { label: 'Read' }
  }
}

// The one action an Updates card sends, as its bundle.
let readAction = (items: unknown) => {
  if (!Array.isArray(items) || items.length != 1) {
    throw new CallError('arguments', 'Send one action from an Updates card.')
  }
  let { entity, inboxAction: action } = items[0] ?? {}
  if (
    typeof entity?.eid != 'string' || !EID.test(entity.eid) ||
    typeof action?.space != 'string' || !EID.test(action.space) ||
    !actionKinds.includes(action.kind) ||
    typeof action.target != 'string' || !EID.test(action.target) ||
    typeof action.answer != 'string'
  ) {
    throw new CallError('arguments', 'Send one action from an Updates card.')
  }
  return {
    entity: { eid: entity.eid } as { eid: string },
    action: action as InboxAction,
  }
}

/** Whether a batch is an Updates card's action rather than rows to keep. */
export let acting = (bundles: unknown): boolean =>
  Array.isArray(bundles) &&
  bundles.some((b) => b && typeof b == 'object' && 'inboxAction' in b)

/** An Updates card's action, written to the page graph's door (reach-door.ts):
 * it is done, and answered with its receipt. It only needs the space and the
 * caller's seat. */
export let updatesApply = async (
  items: unknown,
  env: Env,
  dir: Directory,
  person: string,
  until: number | undefined,
  c: Clock,
): Promise<Response> => {
  try {
    let { entity, action } = readAction(items)
    let { space, role, administrative } = await c.time(
      'updates_seat',
      () => dir.seat(action.space, person, true),
    )
    let who = {
      person,
      role: administrative ? 'owner' as const : role ?? null,
      until,
      administrative,
    }
    if (!space || space.trashed || !writes(who.role)) {
      throw new CallError('access', 'That Updates card is no longer available.')
    }
    let inboxReceipt = await c.time(
      `updates_${action.kind}`,
      () => commitAction(env, space, who, action, true),
    )
    return Response.json([{ entity, inboxReceipt }])
  } catch (error) {
    if (error instanceof CallError) {
      return Response.json({ error: error.code, message: error.message }, {
        status: toolRefused(error).status,
      })
    }
    let code = (error as { status?: number } | null)?.status ?? status(error)
    if (code >= 400 && code < 500) {
      return Response.json(refusal(error), { status: code })
    }
    caught(error, { request: 'Updates action' })
    // A failed round trip may have committed the action. Let sync retry.
    return new Response(null, { status: 503 })
  }
}

/** A choice or dismissal stays in Updates. A message opens its chat. */
export let updatesAnswer = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
) => {
  let form = await req.formData()
  let field = (name: string) => String(form.get(name) ?? '')
  // Back to the page the card was on: the space's Updates, or every space's.
  let to = new URL(
    backTo(env, field('back'), talkPath('updates', space.slug)),
  )
  let back = to.pathname + to.search
  let kind = actionKinds.find((kind) => form.has(kind))
  if (kind) {
    await commitAction(env, space, who, {
      kind,
      space: space.eid,
      target: field(kind),
      answer: field(answerField(kind)),
    }, false)
    return new Response(null, { status: 303, headers: { location: back } })
  }
  if (form.has('message')) {
    await replyFriend(env, who, field('message'), field('say'))
    return new Response(null, { status: 303, headers: { location: back } })
  }
  let { request } = await operatorDoor(
    env,
    space,
    who,
    'updates',
    { reply: field('reply'), say: field('say'), id: field('id') },
  ) as { request?: string }
  return new Response(null, {
    status: 303,
    headers: {
      location: request ? chatPath(space.slug, request) : back,
    },
  })
}

/** A file kept in the space, as a page shows it: a picture in place, and
 * anything else saved. */
export let fileAnswer = async (
  env: Env,
  space: Space,
  file: { address: string; media_type: string },
  req?: Request,
) => {
  let kept = await env.BLOBS.get(attachmentKey(space, file.address))
  if (!kept) return new Response('That file is missing.', { status: 404 })
  let shows = PICTURES.includes(file.media_type)
  return new Response(kept.body, {
    headers: {
      'content-type': shows ? file.media_type : 'application/octet-stream',
      'content-disposition': shows ? 'inline' : 'attachment',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'cache-control': named(req, file)
        ? browserImmutable
        : 'private, no-store',
    },
  })
}

let named = (req: Request | undefined, file: { address: string }) =>
  !!req && new URL(req.url).searchParams.get('sha') == file.address

/** What a choice of a person's question shows, read from their Updates
 * (`?shown=<question>&eid=<file>`): a file kept in the space, a picture
 * opening in place and anything else saved; or an app's draft
 * (`?draft=<app>`), sent on to the reader's own preview link (preview.ts
 * `linkOf`), which the platform lets the page frame. Undefined for a read
 * that names neither. */
export let shownAnswer = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
): Promise<Response | undefined> => {
  let q = new URL(req.url).searchParams
  let missing = (what: string) =>
    new Response(`That ${what} is missing.`, { status: 404 })
  if (q.has('shown')) {
    let file = await operatorDoor(env, space, who, 'updates', {
      shown: q.get('shown'),
      eid: q.get('eid') ?? '',
    }).catch((e) => e?.status == 404 ? null : Promise.reject(e)) as
      | { address: string; media_type: string }
      | null
    return file ? fileAnswer(env, space, file, req) : missing('file')
  }
  if (!q.has('draft')) return undefined
  if (!env.SESSION_SECRET) return missing('draft')
  let dir = directoryOf(env.STORE)
  // A draft by its own id, or an app's, whose draft is the reader's own
  // (written.ts `theirs`).
  let shown = q.get('draft')!
  if (!/^[0-9a-f-]{36}$/i.test(shown)) return missing('draft')
  let named = await dir.draftAt(shown)
  let held = await dir.appAt(named?.app ?? shown)
  if (!held || held.app.space != space.eid) return missing('draft')
  let ctx = { env, dir, person: who.person ?? '' }
  let found = await inApp(ctx, { space: space.slug, app: held.app.slug })
    .catch((e) => e instanceof CallError ? null : Promise.reject(e))
  if (!found) return missing('draft')
  let of = named?.draft ??
    theirs(await draftsOf(dir, found.app), found.who)
  if (!of) return missing('draft')
  let { at } = await linkOf(ctx, space, found.app, found.who, of)
  return new Response(null, { status: 302, headers: { location: at } })
}
