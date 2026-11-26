/** Slack's Events API and Web API as a chat platform. @module */
import type { Event, Platform, Posted, Reply } from '@yaks/chat'
import { Unsent } from '@yaks/host/senders'

let API = 'https://slack.com/api'

let record = (value: unknown): Record<string, unknown> =>
  value && typeof value == 'object' ? value as Record<string, unknown> : {}

let id = (value: unknown): string | undefined =>
  typeof value == 'string' && /^[A-Z][A-Z0-9]+$/.test(value) ? value : undefined

let stamp = (value: unknown): string | undefined =>
  typeof value == 'string' && /^\d{1,12}\.\d{6}$/.test(value)
    ? value
    : undefined

// A Slack timestamp identifies a message within its channel.
let messageId = (room: string, ts: string) => `${room}:${ts}`
let timestamp = (room: string, message?: string) =>
  message?.startsWith(room + ':')
    ? stamp(message.slice(room.length + 1))
    : undefined
let mention = (user: string) => `<@${user}>`
let unescaped: Record<string, string> = { lt: '<', gt: '>', amp: '&' }

let event = (body: unknown): Event | undefined => {
  let envelope = record(body)
  if (
    envelope.type == 'url_verification' && typeof envelope.challenge == 'string'
  ) {
    return { challenge: envelope.challenge }
  }
  if (envelope.type != 'event_callback') return
  let e = record(envelope.event)
  let auth = Array.isArray(envelope.authorizations)
    ? envelope.authorizations.map(record).find((a) => a.is_bot === true)
    : undefined
  let account = id(auth?.team_id ?? envelope.team_id)
  let bot = id(auth?.user_id)
  let room = id(e.channel)
  let author = id(e.user)
  let ts = stamp(e.ts)
  let direct = e.type == 'message' && e.channel_type == 'im'
  if (
    !account || !room || !author || !ts || typeof e.text != 'string' ||
    e.bot_id || e.app_id || e.subtype || author == bot ||
    (!direct && e.type != 'app_mention')
  ) return
  let root = stamp(e.thread_ts)
  let text = (bot ? e.text.replaceAll(mention(bot), '') : e.text).trim()
    .replace(/&(lt|gt|amp);/g, (_, s) => unescaped[s])
  if (!text) return
  return {
    account,
    said: {
      id: messageId(room, ts),
      room,
      ...direct ? {} : { server: account },
      author: { id: author, name: author },
      text,
      at: new Date(Number(ts) * 1000).toISOString(),
      addressed: direct ? 'direct' : 'mention',
      ...root && root != ts ? { reply_to: messageId(room, root) } : {},
      thread: messageId(room, root ?? ts),
    },
  }
}

let call = async (
  fetcher: typeof fetch,
  credential: string,
  method: string,
  data?: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  let res = await fetcher(`${API}/${method}`, {
    method: data ? 'POST' : 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${credential}`,
      ...data ? { 'content-type': 'application/json' } : {},
    },
    body: data && JSON.stringify(data),
  })
  if (res.status == 429) {
    let after = Number(res.headers.get('retry-after')) * 1000
    await res.body?.cancel()
    throw new Unsent(
      `Slack rate limited ${method.split('?')[0]}`,
      after || undefined,
    )
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`Slack ${method.split('?')[0]} returned HTTP ${res.status}`)
  }
  return record(await res.json())
}

let send = async (
  credential: string,
  reply: Reply,
  fetcher: typeof fetch = fetch,
): Promise<Posted> => {
  let parent = reply.thread ?? reply.reply_to
  let thread = timestamp(reply.room, parent)
  if (parent && !thread) {
    throw new Error('The Slack reply is outside its thread')
  }
  let ping = id(reply.ping)
  let text = (ping ? `${mention(ping)} ` : '') +
    reply.text.replaceAll('<!', '&lt;!')
  let answer = await call(fetcher, credential, 'chat.postMessage', {
    channel: reply.room,
    text,
    ...thread ? { thread_ts: thread } : {},
    ...reply.appearance
      ? { username: reply.appearance.name, icon_url: reply.appearance.icon }
      : {},
    unfurl_links: false,
    unfurl_media: false,
  })
  let ts = stamp(answer.ts)
  if (answer.ok !== true || !ts) {
    let why = typeof answer.error == 'string' ? answer.error : 'no message id'
    throw new Error(`Slack chat.postMessage refused: ${why}`)
  }
  return { id: messageId(reply.room, ts) }
}

let server = async (
  credential: string,
  room: string,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> => {
  let query = new URLSearchParams({ channel: room })
  let answer = await call(fetcher, credential, `conversations.info?${query}`)
  let channel = record(answer.channel)
  if (
    answer.ok !== true || channel.is_im || channel.is_mpim || !channel.is_member
  ) return
  return id(channel.context_team_id)
}

/** The domain of the workspace the bot with `credential` was installed in,
 * as Slack's `auth.test` says it: `acme.slack.com`. */
export let domain = async (
  credential: string,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> => {
  let answer = await call(fetcher, credential, 'auth.test')
  if (answer.ok === true) return URL.parse(String(answer.url))?.hostname
}

export let slack: Platform = {
  name: 'slack',
  title: 'Slack',
  place: 'workspace',
  limit: 4_000,
  messageAppearance: true,
  mentions: mention,
  links: (words, url) =>
    words ? `<${url}|${words.replace(/[<>|]/g, '')}>` : `<${url}>`,
  link: (workspace, room) =>
    `https://app.slack.com/client/${workspace}${room ? `/${room}` : ''}`,
  hook: {
    scheme: {
      header: 'X-Slack-Signature',
      prefix: 'v0=',
      timestamp: {
        header: 'X-Slack-Request-Timestamp',
        separator: ':',
        version: 'v0',
      },
    },
    event,
  },
  send,
  server,
}
