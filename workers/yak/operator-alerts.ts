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
import type { Bundle, Comp } from '@yaks/graph'
import { Blocked } from '@yaks/phone'
import { Unsent } from '@yaks/mail'
import {
  isSubscription,
  push,
  type Subscription,
  subscriptionEid,
  type Vapid,
} from '@yaks/push'
import type { Tool } from '@yaks/session'
import { CallError } from '@yaks/tools/errors'
import { type Directory, directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { url } from './host.ts'
import { managePath } from './route.ts'
import { caught } from './defects.ts'
import { type Ctx, refuse } from './tool.ts'
import type { Texting } from './operator-texts.ts'
import type { operatorStore } from './operator-store.ts'

type Store = Pick<ReturnType<typeof operatorStore>, 'g'>

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
): Route | null => {
  let wanted = chosen ?? (texting ? 'text' : 'email')
  if (wanted == 'updates') return null
  let ways: Record<string, Route | null> = {
    push: pushes.length ? { by: 'push', to: pushes } : null,
    text: texting ? { by: 'text', to: texting.number } : null,
    email: email ? { by: 'email', to: email } : null,
  }
  return ORDER[wanted].map((way) => ways[way]).find(Boolean) ?? null
}

/** Where an alert reaches `person` now, as the directory has them. */
export let routeFor = async (dir: Directory, person: string) => {
  let [chosen, texting, email, pushes] = await Promise.all([
    dir.alerts(person),
    dir.texting(person),
    dir.emailAt(person),
    dir.pushes(person),
  ])
  return routeOf(chosen, texting, email, pushes)
}

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

// An email's subject: the alert's first line, cut to a glance.
let subjectOf = (words: string) => {
  let line = words.split('\n')[0].trim()
  return line.length > 60 ? line.slice(0, 59).trimEnd() + '…' : line
}

let part = (row: Bundle, name: string) => row[name] as Comp | undefined

/**
 * The `operator_alert` effect: notification `eid`, told to the person it is
 * for the way they chose, when the space's Operator wrote it (its `by` is
 * the space) to someone other than the whole space. It is stamped
 * `delivered`, or `bounced` with why: a carrier's block, a spent budget or
 * mail allowance. Anything unexpected is reported too.
 */
export let alert = async (env: Env, store: Store, eid: string) => {
  let [row] = await store.g.get([eid])
  if (!row || row.delivered || row.bounced) return
  let { waitingContact } = await import('./operator-contacts.ts')
  if (await waitingContact(store, row)) return
  let to = String(part(row, 'deliver')?.to ?? '')
  let by = String(part(row, 'created')?.by ?? '')
  let words = String(part(row, 'doc')?.body ?? '').trim()
  let dir = directoryOf(env.STORE)
  let space = by ? await dir.at(by) : null
  if (!space || space.trashed || !to || to == space.eid || !words) return
  let route = await routeFor(dir, to)
  if (!route) return
  let outcome: Bundle
  try {
    await sent(env, store, dir, space, to, route, words, eid)
    outcome = {
      entity: row.entity,
      delivered: { at: new Date().toISOString() },
    }
  } catch (error) {
    if (error instanceof Unsent) throw error
    if (!(error instanceof Blocked) && !(error instanceof CallError)) {
      caught(error, { request: 'operator alert', channel: route.by })
    }
    let reason = error instanceof Error ? error.message : String(error)
    outcome = { entity: row.entity, bounced: { reason } }
  }
  await store.g.apply([outcome], { trusted: true })
}

// An alert on its way: a notification on each browser allowed, a text, or a
// letter with a link to their Updates. When every browser allowed is gone,
// it goes the way they are reached next.
let sent = async (
  env: Env,
  store: Store,
  dir: Directory,
  space: Space,
  person: string,
  route: Route,
  words: string,
  id: string,
): Promise<unknown> => {
  let updates = url(env, managePath('updates', space.slug))
  if (route.by == 'push') {
    if (await pushed(env, dir, route.to, space, words, updates, id)) return
    let next = await routeFor(dir, person)
    if (next) return sent(env, store, dir, space, person, next, words, id)
    throw refuse('gone', 'No browser they allowed takes notifications now.')
  }
  if (route.by == 'text') {
    let { textPerson } = await import('./operator-texts.ts')
    return textPerson(env, space, route.to, words)
  }
  let { htmlOf, postOf, signed } = await import('./operator-channels.ts')
  let { from, sender } = postOf(env, space, 'alert')
  let text = `${words}\n\nYour Updates: ${updates}\n\n${signed(space)}`
  await store.g.apply([{
    entity: { eid: id },
    mail: { from, to: route.to, at: new Date().toISOString() },
  }], { trusted: true })
  return sender.send({
    id,
    from,
    name: space.operator,
    to: route.to,
    subject: subjectOf(words),
    text,
    html: htmlOf(text),
  })
}

// The most of an alert's words a notification shows.
let SHOWN = 1000

// Whether an alert reached any of `browsers`, each pushed the Operator's
// name, the words and where they open. A browser whose subscription is gone
// is dropped; one the push service refused is reported, and when none took
// it the first refusal is the alert's.
let pushed = async (
  env: Env,
  dir: Directory,
  browsers: Subscription[],
  space: Space,
  words: string,
  open: string,
  id: string,
) => {
  let vapid = vapidOf(env)
  if (!vapid) throw refuse('push', 'Browser notifications are not switched on.')
  let payload = JSON.stringify({
    title: space.operator,
    body: words.length > SHOWN ? words.slice(0, SHOWN - 1) + '…' : words,
    url: open,
    tag: id,
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
    'Tell the person you work for something when they are not in this conversation: when work they are waiting on finishes, when something needs them, or when they asked to be told. It lands in their Updates and reaches them the way they chose to be alerted on the Operator page: a notification on the browsers they allowed, a text, an email, or Updates alone. Say it in a line or two that stand on their own. Answers with how it reaches them. A text is paid from the space’s budget, an email counts against its mail.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What to tell them.' },
      about: {
        type: 'string',
        description: 'The eid of the app or task it is about, if one.',
      },
    },
    required: ['text'],
  },
  run: async (args, context) => {
    let words = String(args.text ?? '').trim()
    if (!words) throw refuse('arguments', 'Say what to tell them.')
    let { notification } = await import('./operator-updates.ts')
    let row = notification({
      to: ctx.person,
      words,
      by: space.eid,
      ...args.about ? { about: String(args.about) } : {},
    })
    if (context?.session) row.$actor = { by: space.eid, via: context.session }
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
