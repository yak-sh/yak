// A notification as a view of a row. A host's renderer draws a row as a
// small tree, the way a page draws it as elements: one `Notification`, whose
// text is its body, holding an `Action` for each button. `noticeOf` is the
// push surface's host: it turns that tree into what the service worker
// (worker.js) hands `showNotification`, the way the DOM and terminal hosts
// turn theirs into nodes. Function components are called, elements become
// their text, and a link is its label alone. `said` and `closing` are the two
// messages a browser is pushed: a notification to show, and the tags of
// notifications to take away once what they were about is handled.
import { MOST } from './mod.ts'

/** A button on a notification: pressing it posts `form` to `post` from the
 * service worker, without opening anything, where the platform shows
 * buttons; Safari shows none. */
export type Button = {
  action: string
  title: string
  post?: string
  form?: Record<string, string>
}

/** What one notification shows, as a browser is pushed it. A new one with
 * the same `tag` replaces the old one instead of adding another. */
export type Notice = {
  title: string
  body: string
  tag: string
  url?: string
  icon?: string
  badge?: string
  actions?: Button[]
}

/** The notification a tree draws: its title, the tag naming what it is
 * about, where pressing it opens, its icons; its children are its body and
 * its `Action`s. */
export type NotificationProps = Omit<Notice, 'body' | 'actions'> & {
  children?: unknown
}

/** One notification, as a renderer writes it. The host reads its props. */
export let Notification = (_: NotificationProps): null => null

/** A button of a `Notification`. */
export let Action = (_: Button): null => null

// A node as Preact's JSX and `h` make it.
type Node = { type: unknown; props: Record<string, unknown> }

let isNode = (n: unknown): n is Node =>
  !!n && typeof n == 'object' && 'type' in n && 'props' in n

// The elements that start a line of their own.
let BLOCK = new Set([
  'p',
  'div',
  'li',
  'br',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'tr',
])

// What a tree says as plain text, and the buttons and notification in it.
type Read = { text: string; notice?: NotificationProps; actions: Button[] }

let read = (n: unknown, into: Read): void => {
  if (n == null || typeof n == 'boolean') return
  if (Array.isArray(n)) return n.forEach((c) => read(c, into))
  if (!isNode(n)) return void (into.text += String(n))
  let { type, props } = n
  if (type == Notification) into.notice = props as NotificationProps
  else if (type == Action) return void into.actions.push(props as Button)
  else if (typeof type == 'function') return read(type(props), into)
  let block = typeof type == 'string' && BLOCK.has(type)
  if (block) into.text += '\n'
  read(props.children, into)
  if (block) into.text += '\n'
}

// Text as a notification shows it: lines trimmed, no blank ones.
let tidy = (text: string) =>
  text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .join('\n')

/**
 * The notification a renderer's tree draws, or null where it draws none.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { h } from 'preact'
 * import { Action, Notification, noticeOf } from '@yaks/push/notice'
 * let tree = h(
 *   Notification,
 *   { title: 'Elihu replied', tag: 't1', url: '/ana' },
 *   h('p', null, 'Your ', h('a', { href: '/recipes' }, 'recipes'), ' print again.'),
 *   h(Action, { action: 'ok', title: 'OK' }),
 * )
 * equal(noticeOf(tree), {
 *   title: 'Elihu replied',
 *   tag: 't1',
 *   url: '/ana',
 *   body: 'Your recipes print again.',
 *   actions: [{ action: 'ok', title: 'OK' }],
 * })
 * equal(noticeOf(null), null)
 * ```
 */
export let noticeOf = (tree: unknown): Notice | null => {
  let into: Read = { text: '', actions: [] }
  read(tree, into)
  if (!into.notice) return null
  let { children: _, ...shown } = into.notice
  return {
    ...shown,
    body: tidy(into.text),
    ...into.actions.length ? { actions: into.actions } : {},
  }
}

// The most of a title and of a body a notification shows; a phone shows
// less, and the rest is there when it is opened.
let TITLE = 80, BODY = 400

let cut = (text: string, most: number) =>
  text.length > most ? text.slice(0, most - 1).trimEnd() + '…' : text

let bytes = (text: string) => new TextEncoder().encode(text).length

/**
 * The push that shows `notice`, carrying how many things wait on its person
 * (`count`), which the installed app's icon shows. Its title and body are
 * cut to what a notification shows, and the body further until the push
 * fits (`MOST`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { said } from '@yaks/push/notice'
 * let notice = { title: 'Menno asked', body: 'Pick a day?', tag: 'd1' }
 * equal(JSON.parse(said(notice, 2)), { ...notice, count: 2 })
 * equal(JSON.parse(said({ ...notice, body: 'x'.repeat(900) })).body.length, 400)
 * ```
 */
export let said = (notice: Notice, count?: number | null): string => {
  let message = (body: string) =>
    JSON.stringify({
      ...notice,
      title: cut(notice.title, TITLE),
      body,
      ...count == null ? {} : { count },
    })
  let body = cut(notice.body, BODY)
  let out = message(body)
  while (bytes(out) > MOST && body) {
    body = cut(body, Math.floor(body.length / 2))
    out = message(body)
  }
  return out
}

/**
 * The push that takes away the notifications tagged `tags`, where what they
 * were about was read or answered, and sets the icon's count.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { closing } from '@yaks/push/notice'
 * equal(JSON.parse(closing(['d1'], 0)), { close: ['d1'], count: 0 })
 * ```
 */
export let closing = (tags: string[], count?: number | null): string =>
  JSON.stringify({ close: tags, ...count == null ? {} : { count } })

/**
 * Whether a browser may be pushed a message that shows nothing (`closing`).
 * Safari takes back the subscription of a site whose push showed no
 * notification, so Apple's push service is never sent one; Chrome and
 * Firefox take an occasional one.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { quietly } from '@yaks/push/notice'
 * equal(quietly('https://web.push.apple.com/QK3'), false)
 * equal(quietly('https://fcm.googleapis.com/fcm/send/x'), true)
 * ```
 */
export let quietly = (endpoint: string): boolean =>
  !/(^|\.)push\.apple\.com$/.test(new URL(endpoint).hostname)
