// Subscription links are app-bound seals. Subscription rows, confirmations
// and fan-out letters use the app's graph and its existing metered mail effect.
import { type Bundle, mint } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import { Stale } from '@yaks/graph/errors'
import { parts } from '@yaks/mail'
import { mode, reads } from '@yaks/member'
import type { Handler } from '@yaks/effects'
import type { Stored } from './graph.ts'
import type { Answer } from './apps.ts'
import { appStore, url } from './directory.ts'
import { KERNEL } from './meta.ts'
import { opened, seal } from './lib/token.ts'
import { noticeEnabled } from './notices-vocab.ts'
import { source, tooMany, within } from '@yaks/workerd/rate'
import { failing } from './defects.ts'

type Subscription = Bundle & {
  notice_subscription: {
    owner: string
    root: string
    ticket: string
    requested_at: string
  }
  notice_confirmed?: { at: string }
}
type Ticket = {
  app: string
  subscription: string
  ticket: string
  action: string
}
let HOUR = 60 * 60 * 1000
let LIFE = 48 * HOUR
let reply = (message: string, status = 200) =>
  new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
let ticket = (at: Stored, row: Subscription, action: string) =>
  seal('notice', {
    app: at.app,
    subscription: row.entity.eid,
    ticket: row.notice_subscription.ticket,
    action,
  }, at.env.SESSION_SECRET!)
let link = async (at: Stored, row: Subscription, action: string) =>
  `${row.notice_subscription.root}api/notices/${action}?t=${
    encodeURIComponent(await ticket(at, row, action))
  }`
let privateLetter = (
  at: Stored,
  eid: string,
  to: string,
  title: string,
  body: string,
): Bundle => ({
  entity: { eid },
  doc: { title, body },
  mail: {},
  deliver: { to },
  notice_letter: { owner: at.app },
})

let save = async (
  at: Stored,
  before: Subscription | undefined,
  bundles: Bundle[],
) => {
  let [row, ...rest] = bundles
  try {
    await at.graph.apply([{
      ...row,
      $was: {
        notice_subscription: {
          ticket: token(before?.notice_subscription?.ticket),
        },
      },
    }, ...rest])
    return true
  } catch (e) {
    if (e instanceof Stale) return false
    throw e
  }
}

let subscribe = async (at: Stored, email: unknown, root: string) => {
  let address = typeof email == 'string' ? email.trim() : ''
  let split = parts(address)
  if (
    !split || address.length > 254 || /[\s<>\r\n]/.test(address) ||
    !split[1].includes('.')
  ) {
    return reply('Enter an email address.', 400)
  }
  address = `${split[0]}@${split[1].toLowerCase()}`
  let eid = derivedEid(JSON.stringify(['notice_subscription', at.app, address]))
  let [held] = await at.graph.get([eid]) as Subscription[]
  let now = Date.now()
  // A repeat cannot cancel consent, rotate a working link or flood an inbox.
  if (
    (held?.notice_subscription && held.notice_confirmed) ||
    (held?.notice_subscription &&
      now - Date.parse(held.notice_subscription.requested_at) < HOUR)
  ) {
    return reply(
      'Check your email for the confirmation link. If you already confirmed, you are subscribed.',
    )
  }
  let row: Subscription = {
    entity: { eid },
    email: { address },
    notice_subscription: {
      owner: at.app!,
      root,
      ticket: mint(),
      requested_at: new Date(now).toISOString(),
    },
  }
  let confirm = await link(at, row, 'confirm')
  let unsubscribe = await link(at, row, 'unsubscribe')
  await save(at, held, [
    { ...row, notice_confirmed: null },
    privateLetter(
      at,
      derivedEid(
        JSON.stringify([eid, row.notice_subscription.ticket, 'confirm']),
      ),
      eid,
      'Confirm your notice subscription',
      `Someone asked to receive notices from ${at.mail()}.\n\n` +
        `[Confirm subscription](${confirm})\n\n` +
        `This link expires in 48 hours. If you did not ask, ignore this letter.\n\n` +
        `[Unsubscribe](${unsubscribe})`,
    ),
  ])
  return reply(
    'Check your email for the confirmation link. If you already confirmed, you are subscribed.',
  )
}

let accept = async (at: Stored, action: string, raw: string) => {
  let t = await opened<Ticket>('notice', raw, at.env.SESSION_SECRET!)
  if (
    !t || t.app != at.app || t.action != action ||
    typeof t.subscription != 'string'
  ) {
    return reply('This subscription link is invalid.', 400)
  }
  let [row] = await at.graph.get([t.subscription]) as Subscription[]
  if (
    !row?.notice_subscription ||
    (action != 'unsubscribe' && row.notice_subscription.ticket != t.ticket)
  ) {
    return reply('This subscription link is no longer active.', 400)
  }
  if (action == 'unsubscribe') {
    if (row.notice_confirmed || row.notice_subscription.ticket == t.ticket) {
      await save(at, row, [{
        entity: row.entity,
        notice_confirmed: null,
        notice_subscription: { ticket: mint() },
      }])
    }
    return reply('You are unsubscribed. You will receive no more notices.')
  }
  if (Date.now() - Date.parse(row.notice_subscription.requested_at) > LIFE) {
    return reply(
      'This confirmation link expired. Subscribe again to receive another.',
      400,
    )
  }
  if (!row.notice_confirmed) {
    let saved = await save(at, row, [{
      entity: row.entity,
      notice_confirmed: { at: new Date().toISOString() },
    }])
    if (!saved) return reply('This subscription link is no longer active.', 400)
  }
  return reply(
    'Your email address is confirmed. You will receive this app’s notices. Every letter has an unsubscribe link.',
  )
}

/** The store's kernel-only subscription door. */
export let subscription = async (
  req: Request,
  at: Stored,
): Promise<Response> => {
  if (!at.app || !at.env.SESSION_SECRET || !at.mail()) {
    return reply('Notices are unavailable.', 503)
  }
  let u = new URL(req.url), action = u.searchParams.get('action')
  if (action == 'confirm' || action == 'unsubscribe') {
    return accept(at, action, u.searchParams.get('t') ?? '')
  }
  if (req.method != 'POST') return reply('Use POST to subscribe.', 405)
  if (!noticeEnabled(at.graph.vocab)) {
    return reply('This app has no notices.', 404)
  }
  let body = await req.json() as { email?: unknown; root: string }
  return subscribe(at, body.email, body.root)
}

/** Public app API: a visitor can request consent, never send arbitrary mail. */
export let notices: Answer = async (
  { req, env, path, space, app, who, refuse },
) => {
  if (
    !['/notices/subscribe', '/notices/confirm', '/notices/unsubscribe']
      .includes(path)
  ) return null
  let action = path.split('/').at(-1)!
  if (action == 'subscribe' && !reads(mode(app.access), who.role)) {
    return refuse('not_a_reader')
  }
  if (
    !(req.method == 'POST' || (action != 'subscribe' && req.method == 'GET'))
  ) return reply('Method not allowed.', 405)
  if (
    action == 'subscribe' &&
    !await within(env.SIGNIN_RATE, source(req), failing('rate limit'))
  ) {
    return tooMany()
  }
  let init: RequestInit = { method: req.method }
  if (action == 'subscribe') {
    let email: unknown
    try {
      email = req.headers.get('content-type')?.includes('application/json')
        ? (await req.json() as { email?: unknown }).email
        : (await req.formData()).get('email')
    } catch {
      return reply('Enter an email address.', 400)
    }
    init.body = JSON.stringify({ email, root: url(space, app, env) })
  }
  let query = new URLSearchParams({
    action,
    t: new URL(req.url).searchParams.get('t') ?? '',
  })
  return appStore(env.STORE, space, app, env).consume(
    `/notices?${query}`,
    async (r) => new Response(await r.text(), r),
    init,
    KERNEL,
  )
}

/** A notice's durable fan-out uses stable letter ids, so retries cannot resend. */
export let noticePost = (at: Stored): Handler => async (event) => {
  let [notice] = await at.graph.get([event.entity.eid])
  if (!notice?.doc) return
  if (!notice.notice_posted) {
    await at.graph.apply([{
      entity: notice.entity,
      notice_posted: { at: event.at ?? new Date().toISOString() },
    }])
  }
  let doc = notice.doc as { title?: string; body?: string }
  let posted = (notice.notice_posted as { at?: string } | undefined)?.at ??
    event.at
  for (
    let row of await at.graph.read(
      `.notice_subscription.owner=${at.app} .notice_confirmed`,
    ) as Subscription[]
  ) {
    if (posted && row.notice_confirmed!.at > posted) continue
    let eid = derivedEid(
      JSON.stringify(['notice_letter', notice.entity.eid, row.entity.eid]),
    )
    let [held] = await at.graph.get([eid])
    if (held) continue
    await at.graph.apply([
      privateLetter(
        at,
        eid,
        row.entity.eid,
        doc.title ?? 'Notice',
        `${doc.body ?? ''}\n\n[Unsubscribe](${await link(
          at,
          row,
          'unsubscribe',
        )})`,
      ),
    ])
  }
}
