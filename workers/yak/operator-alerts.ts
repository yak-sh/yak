// How a space's Operator tells its person something away from the page. What
// it tells them is a notification in their Updates (operator-updates.ts
// `notification`), and each one the Operator writes a person is also told to
// them the way they chose (`operator_alerts{channel}`, on their directory
// row): a notification on each browser they allowed (@yaks/push); a text to
// the number they agreed to, paid from the space's budget like every text; an
// email from the Operator's address, counted against the space's mail; or
// nothing more than Updates. A reply to a text or an email reaches the
// Operator as any text or email from them does. What a person writes, and
// what is told to everyone in a space, stays in Updates.
import { type Reach, reachBy } from '@yaks/notify/whereabouts'
import type { Bundle, Comp } from '@yaks/graph'
import { Blocked } from '@yaks/phone'
import { Unsent } from '@yaks/mail'
import {
  isSubscription,
  push,
  type Subscription,
  subscriptionEid,
  Unpushed,
  type Vapid,
} from '@yaks/push'
import type { Tool } from '@yaks/session'
import { CallError } from '@yaks/tools/errors'
import { type Directory, directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { url } from '@yaks/platform/host'
import { alerted } from '@yaks/platform/letters'
import { chatPath, managePath } from '@yaks/platform/routes'
import {
  askAnchor,
  listsOf,
  needCount,
  updateAnchor,
} from './operator-lists.ts'
import { caught } from './defects.ts'
import { type Ctx, refuse } from './tool.ts'
import type { Texting } from './operator-texts.ts'
import type { OperatorStore } from './operator-store.ts'

type Store = OperatorStore

/** The ways a person may choose to be alerted. */
export let ALERTING = ['push', 'text', 'email', 'updates'] as const
export type Alerting = typeof ALERTING[number]
/** Where one alert goes: the browsers allowed, a number agreed to, or an
 * address. */
export type Route =
  | { by: 'push'; to: Subscription[] }
  | { by: 'text' | 'email'; to: string }

// What each choice falls back to when it is gone, in order.
let ORDER = {
  push: ['push', 'text', 'email'],
  text: ['text', 'email', 'push'],
  email: ['email', 'text', 'push'],
} as const

/**
 * Where an alert reaches a person: the way they chose, else by text when they
 * agreed to texts and by email when not. When the way chosen is gone (every
 * browser took back its subscription, texts stopped, no address) it goes the
 * next way; only in Updates, nowhere.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { routeOf } from './operator-alerts.ts'
 * let ana = { number: '+12695550142' }
 * let tab = { endpoint: 'https://push.example/1', keys: { p256dh: '', auth: '' } }
 * equal(routeOf(null, ana, 'ana@bot.yak.sh'), { by: 'text', to: ana.number })
 * equal(routeOf(null, null, 'ana@bot.yak.sh'), { by: 'email', to: 'ana@bot.yak.sh' })
 * equal(routeOf('email', ana, 'ana@bot.yak.sh')?.by, 'email')
 * equal(routeOf('text', null, 'ana@bot.yak.sh')?.by, 'email')
 * equal(routeOf('push', ana, 'ana@bot.yak.sh', [tab]), { by: 'push', to: [tab] })
 * equal(routeOf('push', ana, 'ana@bot.yak.sh')?.by, 'text')
 * equal(routeOf('updates', ana, 'ana@bot.yak.sh'), null)
 * equal(routeOf(null, null, null), null)
 * ```
 */
export let routeOf = (
  chosen: Alerting | null,
  texting: Pick<Texting, 'number'> | null,
  email: string | null,
  pushes: Subscription[] = [],
  except?: Alerting,
): Route | null => {
  let wanted = chosen ?? (texting ? 'text' : 'email')
  if (wanted == 'updates') return null
  let ways: Record<string, Route | null> = {
    push: pushes.length ? { by: 'push', to: pushes } : null,
    text: texting ? { by: 'text', to: texting.number } : null,
    email: email ? { by: 'email', to: email } : null,
  }
  return ORDER[wanted].filter((way) => way != except).map((way) => ways[way])
    .find(Boolean) ?? null
}

/** Where an alert written at `at` reaches `person` now, as the directory
 * has them. A browser allowed after it was written is not told it: turning
 * alerts on brings what happens next, never what was already owed. `except`
 * skips a channel that refused this alert. */
export let routeFor = async (
  dir: Directory,
  person: string,
  at?: string,
  except?: Alerting,
  reach?: Reach,
) => {
  let [chosen, texting, email, pushes] = await Promise.all([
    dir.alerts(person),
    dir.texting(person),
    dir.emailAt(person),
    dir.pushes(person),
  ])
  let before = at ? pushes.filter((b) => !b.since || b.since <= at) : pushes
  return routeOf(
    present(chosen, reach),
    texting,
    email,
    before.map(subscription),
    except,
  )
}

/**
 * The way chosen, as where the person is now changes it (whereabouts.ts
 * `reachBy`): looking at this Operator's tab, nothing is sent, as the tab
 * shows it; with the tab in the background or elsewhere on yaks.app, a
 * browser notification first. Someone who chose Updates alone is never sent
 * anything.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { present } from './operator-alerts.ts'
 * equal(present('text', 'tab'), 'updates')
 * equal(present('text', 'notification'), 'push')
 * equal(present('updates', 'notification'), 'updates')
 * equal(present('email', 'usual'), 'email')
 * ```
 */
export let present = (
  chosen: Alerting | null,
  reach?: Reach,
): Alerting | null =>
  chosen == 'updates' || reach == 'tab'
    ? 'updates'
    : reach == 'notification'
    ? 'push'
    : chosen

// A browser as a push goes to it, without when it was allowed.
let subscription = ({ endpoint, keys }: Subscription): Subscription => ({
  endpoint,
  keys,
})

/** The directory row keeping how `person` chose to be alerted. */
export let alertsRow = (person: string, channel: string): Bundle => {
  if (!(ALERTING as readonly string[]).includes(channel)) {
    throw refuse(
      'arguments',
      'Choose a browser notification, text, email or Updates only.',
    )
  }
  return { entity: { eid: person }, operator_alerts: { channel } }
}

/** The directory row keeping that `person` answered Not now, `at`, to
 * alerts offered on a device; it is not offered them again. */
export let declinedRow = (person: string, at: string): Bundle => ({
  entity: { eid: person },
  operator_alerts: { declined: at },
})

/** The directory row keeping a browser `person` allowed notifications on,
 * as the page's `pushManager.subscribe` gave it. */
export let pushRow = (person: string, sub: unknown): Bundle => {
  if (!isSubscription(sub)) {
    throw refuse('arguments', 'That browser gave no subscription to push to.')
  }
  return {
    entity: { eid: subscriptionEid(sub.endpoint) },
    push_subscription: {
      person,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
  }
}

/** yaks.app's VAPID identity, kept as the JWK in `PUSH_VAPID_KEY`, or null
 * when push is not switched on. */
export let vapidOf = (env: Env): Vapid | null =>
  env.PUSH_VAPID_KEY
    ? { key: JSON.parse(env.PUSH_VAPID_KEY), subject: 'mailto:hello@yaks.app' }
    : null

// An alert's first line, cut to `most` characters.
let lineOf = (words: string, most: number) => {
  let line = words.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.length > most ? line.slice(0, most - 1).trimEnd() + '…' : line
}

// An email's subject: the alert's first line, cut to a glance.
let subjectOf = (words: string) => lineOf(words, 60)

/**
 * Where pressing an alert opens: the person's conversation, or their Updates
 * at what it is about where it names something (the row waiting there with
 * that id, operator-lists.ts `askAnchor`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { openAt } from './operator-alerts.ts'
 * let [chat, updates] = ['https://yaks.app/ana', 'https://yaks.app/manage/ana/updates']
 * equal(openAt(chat, updates, 'e1'), `${updates}#ask-e1`)
 * equal(openAt(chat, updates), chat)
 * ```
 */
export let openAt = (conversation: string, updates: string, about?: string) =>
  about ? `${updates}#${askAnchor(about)}` : conversation

let part = (row: Bundle, name: string) => row[name] as Comp | undefined

/** What an alert tells, read off the row it is of: a notification's words
 * to whom it names, or a decision's question to the person it is assigned
 * to (`asks`, opened at it in their Updates, where it is answered); nothing
 * for a decision already answered.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { toldOf } from './operator-alerts.ts'
 * equal(toldOf({
 *   entity: { eid: 'n' },
 *   notification: { to: 'ana', about: 'app' },
 *   doc: { title: 'Recipes: fixed', body: 'It prints again.' },
 * }), { to: 'ana', words: 'It prints again.', subject: 'Recipes: fixed', about: 'app' })
 * let ask = {
 *   entity: { eid: 'd' },
 *   task: {},
 *   doc: { title: 'Email bo@x.com?' },
 *   decision: { question: 'Email bo@x.com?', choices: [] },
 *   filed: { assignee: 'ana' },
 * }
 * equal(toldOf(ask), { to: 'ana', words: 'Email bo@x.com?', asks: true })
 * equal(toldOf({ ...ask, decided: { choice: 'Approve' } }), null)
 * ```
 */
export let toldOf = (row: Bundle): Told | null => {
  let note = part(row, 'notification'), doc = part(row, 'doc')
  let decision = part(row, 'decision')
  if (decision) {
    if (row.decided || row.cancelled || row.completed) return null
    return {
      to: String(part(row, 'filed')?.assignee ?? ''),
      words: String(decision.question ?? '').trim(),
      asks: true,
    }
  }
  let subject = String(doc?.title ?? '').trim()
  let about = String(note?.about ?? '')
  return {
    to: String(note?.to ?? ''),
    words: String(doc?.body ?? '').trim(),
    ...subject ? { subject } : {},
    ...about ? { about } : {},
  }
}

/** What one alert tells `to`: its words, the line naming what happened,
 * what it tells of, and whether it asks them something to answer. */
export type Told = {
  to: string
  words: string
  subject?: string
  about?: string
  asks?: boolean
}

/**
 * The `operator_alert` effect: notification or decision `eid` (`toldOf`),
 * told to the person it is for the way they chose, when the space's
 * Operator wrote it (its `by` is the space) to someone other than the whole
 * space. A decision, an approval among them, opens at itself in their
 * Updates, where it is answered in place. Told by a browser or a
 * text, it is stamped `delivered`, or `bounced` with why: a carrier's block
 * or a spent budget. Told by email, it is carried by a letter of its own
 * (operator-channels.ts `letterFor`), whose outcome is the letter's to keep.
 * A push refusal falls back to the next channel; an outage with no fallback
 * stays owed for the pool to retry. Anything unexpected is reported too.
 */
export let alert = async (
  env: Env,
  store: Store,
  eid: string,
  defer?: (ms: number) => Promise<void>,
) => {
  let { letterFor } = await import('./operator-channels.ts')
  let [row, letter] = await store.g.get([eid, letterFor(eid)])
  if (!row || row.delivered || row.bounced || letter?.mail) return
  let { waitingContact } = await import('./operator-contacts.ts')
  let waiting = await waitingContact(store, row)
  if (waiting) {
    if (waiting == 'tool') await defer?.(10)
    return
  }
  let told = toldOf(row)
  if (!told) return
  let { to, words, subject, asks } = told
  let by = String(part(row, 'created')?.by ?? '')
  let dir = directoryOf(env.STORE)
  let space = by ? await dir.at(by) : null
  if (!space || space.trashed || !to || to == space.eid || !words) return
  let written = String(part(row, 'created')?.at ?? '') || undefined
  // Where they are now: in the tab, it is there already; with the tab in the
  // background, a notification (whereabouts.ts).
  let { seen } = await import('./whereabouts.ts')
  let now = await seen(env, to, space.eid)
  let route = await routeFor(
    dir,
    to,
    written,
    undefined,
    now && reachBy(now),
  )
  if (!route) return
  let note = { words, subject, id: eid, about: told.about, asks, at: written }
  let outcome: Bundle[]
  try {
    let letter = await sent(env, store, dir, space, to, route, note)
    outcome = letter ?? [{
      entity: row.entity,
      delivered: { at: new Date().toISOString() },
    }]
  } catch (error) {
    if (error instanceof Unsent) throw error
    if (error instanceof Unpushed && error.retry) {
      throw Object.assign(refuse('push', error.message), { retry: error.retry })
    }
    if (
      !(error instanceof Blocked) && !(error instanceof CallError) &&
      !(error instanceof Unpushed)
    ) {
      caught(error, { request: 'operator alert', channel: route.by })
    }
    let reason = error instanceof Error ? error.message : String(error)
    outcome = [{ entity: row.entity, bounced: { reason } }]
  }
  await store.g.apply(outcome, { trusted: true })
}

// One alert: its words and subject, its notification's eid, what it is
// about and when it was written.
type Note = {
  words: string
  subject?: string
  id: string
  about?: string
  asks?: boolean
  at?: string
}

// An alert on its way: a notification on each browser allowed, a text, or a
// letter with a link to their Updates, given back as the rows that write it
// for @yaks/mail to send. When every browser allowed is gone, it goes the way
// they are reached next.
let sent = async (
  env: Env,
  store: Store,
  dir: Directory,
  space: Space,
  person: string,
  route: Route,
  note: Note,
): Promise<Bundle[] | undefined> => {
  let { words, subject, id } = note
  let updates = url(env, managePath('updates', space.slug))
  // What asks them opens at itself in their Updates, answered there.
  let answer = note.asks ? `${updates}#${updateAnchor(id)}` : undefined
  if (route.by == 'push') {
    let open = answer ??
      openAt(url(env, chatPath(space.slug)), updates, note.about)
    let count = await waitingOn(env, store, person, space.eid)
    let told = { words: subject ?? words, open, id, count }
    let refused: Unpushed | undefined
    try {
      if (await pushed(env, dir, route.to, space, told)) return undefined
    } catch (error) {
      if (!(error instanceof Unpushed)) throw error
      refused = error
    }
    let next = await routeFor(dir, person, note.at, 'push')
    if (next) return sent(env, store, dir, space, person, next, note)
    if (refused) throw refused
    throw refuse('gone', 'No browser they allowed takes notifications now.')
  }
  if (route.by == 'text') {
    let { textPerson } = await import('./operator-texts.ts')
    let said = subject ? `${subject}\n\n${words}` : words
    await textPerson(
      env,
      space,
      route.to,
      answer ? `${said}\n\nAnswer it here: ${answer}` : said,
    )
    return undefined
  }
  let { letterFor, letterRows } = await import('./operator-channels.ts')
  let [recipient, letter] = letterRows(env, space, {
    eid: letterFor(id),
    to: route.to,
    title: subjectOf(subject ?? words),
    body: alerted(space, words, answer ?? updates, note.asks),
    target: id,
  })
  // Written for the person it alerts, so a reply finds it from any address
  // (inbox.ts `replied`), not only the one a member writes from.
  return [recipient, { ...letter, operator_letter: { person } }]
}

// The most of an alert's line a notification shows.
let SHOWN = 200

// How many things wait on the person, as the bar beside their conversation
// counts them, which the installed page's icon shows; null when that could
// not be read. Never fails the alert it rides on.
let waitingOn = async (
  env: Env,
  store: Store,
  person: string,
  space: string,
) => {
  try {
    let { updatesOf } = await import('./operator-updates.ts')
    let [listed, read] = await Promise.all([
      listsOf(env, person, space),
      updatesOf(store, person, space),
    ])
    return needCount(listed.lists, read.updates)
  } catch (e) {
    caught(e, { request: 'alert count' })
    return null
  }
}

// Whether an alert reached any of `browsers`, each pushed the Operator's
// name, the alert in a line, where it opens and how many things wait on the
// person. A browser whose subscription is gone is dropped; one the push
// service refused is retained, and when none took it the first refusal is
// handed back to the alert for fallback or retry.
let pushed = async (
  env: Env,
  dir: Directory,
  browsers: Subscription[],
  space: Space,
  told: { words: string; open: string; id: string; count: number | null },
) => {
  let vapid = vapidOf(env)
  if (!vapid) throw refuse('push', 'Browser notifications are not switched on.')
  let payload = JSON.stringify({
    title: space.operator,
    body: lineOf(told.words, SHOWN),
    url: told.open,
    tag: told.id,
    ...told.count == null ? {} : { count: told.count },
  })
  let outcomes = await Promise.allSettled(
    browsers.map((b) => push(b, payload, vapid)),
  )
  let gone = browsers.filter((_, i) => {
    let o = outcomes[i]
    return o.status == 'fulfilled' && o.value == 'gone'
  })
  if (gone.length) {
    await dir.apply({
      entities: gone.map((b) => ({
        entity: { eid: subscriptionEid(b.endpoint) },
        $delete: true,
      })),
    })
  }
  if (outcomes.some((o) => o.status == 'fulfilled' && o.value == 'sent')) {
    return true
  }
  let failed = outcomes.find((o) => o.status == 'rejected')
  if (failed) throw failed.reason
  return false
}

/** The Operator's `notification_send`: words for the person it works for, in
 * their Updates and told to them the way they chose (`alert`). */
export let notificationSend = (ctx: Ctx, space: Space, store: Store): Tool => ({
  name: 'notification_send',
  title: 'Notify them',
  step: { doing: 'Notifying them…', done: 'Notified them' },
  description:
    'Tell the person you work for something when they are not in this conversation: when work they are waiting on finishes, when something needs them, or when they asked to be told. Nothing else you do outside a conversation with them reaches them; your last words in a run stay in its chat. A notice is shown alone on their Updates page, apart from any conversation, read later by someone who has not seen this one and may not be a programmer, so it must stand on its own: no file names, tool names, ids or error messages, which stay in this chat it links to. It reaches them the way they chose to be alerted on the Operator page: a notification on the browsers they allowed, a text, an email, or Updates alone. Write it as yourself, in the first person (“I finished your report”), and say what they can reply to have done (“Reply renew and I’ll renew it”): a reply to a text or an email reaches you here. Answers with how it reaches them. A text is paid from the space’s budget, an email counts against its mail.',
  parameters: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description:
          'One line naming the app and what happened, in plain words, as "Recipe box: the print button works again".',
      },
      text: {
        type: 'string',
        description:
          'Two or three plain sentences to them in your own voice, standing on their own: what happened, what you did, and what (if anything) they can reply to have done.',
      },
      about: {
        type: 'string',
        description: 'The eid of the app or task it is about, if one.',
      },
    },
    required: ['subject', 'text'],
  },
  run: async (args, context) => {
    let words = String(args.text ?? '').trim()
    let subject = String(args.subject ?? '').trim()
    if (!words) throw refuse('arguments', 'Say what to tell them.')
    let { notification } = await import('./operator-updates.ts')
    let row = notification({
      to: ctx.person,
      words,
      ...subject ? { subject } : {},
      by: space.eid,
      ...context?.session ? { via: context.session } : {},
      ...context?.call ? { from: context.call.entity.eid } : {},
      ...args.about ? { about: String(args.about) } : {},
    })
    await store.g.apply([row], { trusted: true })
    let [kept] = await store.g.get([row.entity.eid])
    let { waitingContact } = await import('./operator-contacts.ts')
    if (kept && await waitingContact(store, kept)) {
      return JSON.stringify({
        notification: row.entity.eid,
        reaches: 'pending contact confirmation',
      })
    }
    let route = await routeFor(ctx.dir, ctx.person)
    return JSON.stringify({
      notification: row.entity.eid,
      reaches: route?.by ?? 'updates',
    })
  },
})
