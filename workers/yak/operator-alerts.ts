// How a space's Operator tells its person something away from the page. What
// it tells them is a notification in their Updates (operator-updates.ts
// `notification`), and each one the Operator writes a person is also told to
// them the way they chose (`operator_alerts{channel}`, on their directory row): a text
// to the number they agreed to, paid from the space's budget like every text;
// an email from the Operator's address, counted against the space's mail; or
// nothing more than Updates. A reply to either reaches the Operator as any
// text or email from them does. What a person writes, and what is told to
// everyone in a space, stays in Updates.
import type { Bundle, Comp } from '@yaks/graph'
import { Blocked } from '@yaks/phone'
import { Unsent } from '@yaks/mail'
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
export let ALERTING = ['text', 'email', 'updates'] as const
export type Alerting = typeof ALERTING[number]
/** Where one alert goes: a number agreed to, or an address. */
export type Route = { by: 'text' | 'email'; to: string }

/**
 * Where an alert reaches a person: the way they chose, else by text when they
 * agreed to texts and by email when not. When the way chosen is gone (texts
 * stopped, no address) it goes the other way; only in Updates, nowhere.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { routeOf } from './operator-alerts.ts'
 * let ana = { number: '+12695550142' }
 * equal(routeOf(null, ana, 'ana@bot.yak.sh'), { by: 'text', to: ana.number })
 * equal(routeOf(null, null, 'ana@bot.yak.sh'), { by: 'email', to: 'ana@bot.yak.sh' })
 * equal(routeOf('email', ana, 'ana@bot.yak.sh')?.by, 'email')
 * equal(routeOf('text', null, 'ana@bot.yak.sh')?.by, 'email')
 * equal(routeOf('updates', ana, 'ana@bot.yak.sh'), null)
 * equal(routeOf(null, null, null), null)
 * ```
 */
export let routeOf = (
  chosen: Alerting | null,
  texting: Pick<Texting, 'number'> | null,
  email: string | null,
): Route | null => {
  let wanted = chosen ?? (texting ? 'text' : 'email')
  if (wanted == 'updates') return null
  let text: Route | null = texting ? { by: 'text', to: texting.number } : null
  let mail: Route | null = email ? { by: 'email', to: email } : null
  return (wanted == 'text' ? text ?? mail : mail ?? text)
}

/** Where an alert reaches `person` now, as the directory has them. */
export let routeFor = async (dir: Directory, person: string) => {
  let [chosen, texting, email] = await Promise.all([
    dir.alerts(person),
    dir.texting(person),
    dir.emailAt(person),
  ])
  return routeOf(chosen, texting, email)
}

/** The directory row keeping how `person` chose to be alerted. */
export let alertsRow = (person: string, channel: string): Bundle => {
  if (!(ALERTING as readonly string[]).includes(channel)) {
    throw refuse('arguments', 'Choose text, email or Updates only.')
  }
  return { entity: { eid: person }, operator_alerts: { channel } }
}

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
    await sent(env, space, route, words, eid)
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

// An alert on its way: a text, or a letter with a link to their Updates.
let sent = async (
  env: Env,
  space: Space,
  route: Route,
  words: string,
  id: string,
) => {
  if (route.by == 'text') {
    let { textPerson } = await import('./operator-texts.ts')
    return textPerson(env, space, route.to, words)
  }
  let { htmlOf, postOf, signed } = await import('./operator-channels.ts')
  let { from, sender } = postOf(env, space, 'alert')
  let updates = url(env, managePath('updates', space.slug))
  let text = `${words}\n\nYour Updates: ${updates}\n\n${signed(space)}`
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

/** The Operator's `notification_send`: words for the person it works for, in
 * their Updates and told to them the way they chose (`alert`). */
export let notificationSend = (ctx: Ctx, space: Space, store: Store): Tool => ({
  name: 'notification_send',
  title: 'Notify them',
  step: { doing: 'Notifying them…', done: 'Notified them' },
  description:
    'Tell the person you work for something when they are not in this conversation: when work they are waiting on finishes, when something needs them, or when they asked to be told. It lands in their Updates and reaches them the way they chose to be alerted on the Operator page: a text, an email, or Updates alone. Say it in a line or two that stand on their own. Answers with how it reaches them. A text is paid from the space’s budget, an email counts against its mail.',
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
  run: async (args) => {
    let words = String(args.text ?? '').trim()
    if (!words) throw refuse('arguments', 'Say what to tell them.')
    let { notification } = await import('./operator-updates.ts')
    let row = notification({
      to: ctx.person,
      words,
      by: space.eid,
      ...args.about ? { about: String(args.about) } : {},
    })
    await store.g.apply([row], { trusted: true })
    let route = await routeFor(ctx.dir, ctx.person)
    return JSON.stringify({
      notification: row.entity.eid,
      reaches: route?.by ?? 'updates',
    })
  },
})
