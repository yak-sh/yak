// What the Operator subscribes to for the person it works for: a query whose
// rows it looks at again on a cadence, over the space as that person reads it
// (new rows, a row changing, a build that finished, what a webhook wrote) or
// over its own store (a helper's session, a reply to its text or letter). A
// subscription is a wake-up (operator-wakes.ts) that also
// carries `operator_subscription{query, mine, seen}`: each time it fires, the
// query is read again, and only when its rows differ from `seen` is the
// change given to the Operator as the person's words (operator-channels.ts
// `fire`), one turn per change, paid from the space's budget like any other.
// A look that finds nothing new costs no turn.
import { addressed, type Bundle } from '@yaks/graph'
import { short } from '@yaks/id'
import type { Tool } from '@yaks/session'
import { next, span } from '@yaks/wake'
import type { Space } from './directory.ts'
import { type Ask, fire } from './operator-channels.ts'
import type { operatorStore } from './operator-store.ts'
import { whoseOf } from './operator-wakes.ts'
import { refuse } from './tool.ts'

type Store = Pick<ReturnType<typeof operatorStore>, 'g'>

/** A subscription's query read as the person who set it: over the space
 * through their reach, or, when `mine`, over the Operator's own store. */
export type Watching = (
  ask: Ask,
  query: string,
  mine?: boolean,
) => Promise<Bundle[]>

type Subscription = { query: string; mine?: boolean; seen?: Seen }
// Each row the query answered, by eid, and a digest of what it held.
type Seen = Record<string, string>

/** The most rows a subscription keeps track of. */
export let ROWS = 200
/** The least time between two looks. */
let SOONEST = 60_000
let EVERY = '1m'

// A row's content in a fixed order, its read-time marks ($was, $actor) left
// out, so the same row digests the same however it was read.
let canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v == 'object'
    ? Object.fromEntries(
      Object.keys(v).filter((k) => !k.startsWith('$')).sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    )
    : v

let digest = async (row: Bundle) => {
  let bytes = new TextEncoder().encode(JSON.stringify(canon(row)))
  let hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** What a query answers now, by eid, with a digest of each row. */
export let seenOf = async (rows: Bundle[]) => {
  let now = new Map<string, { hash: string; row: Bundle }>()
  for (let row of rows.slice(0, ROWS)) {
    now.set(row.entity.eid, { hash: await digest(row), row })
  }
  return now
}

let SHOWN = 10
let WIDE = 600
let clipped = (row: Bundle) => {
  let json = JSON.stringify(canon(row))
  return json.length > WIDE ? json.slice(0, WIDE) + '…' : json
}

/** What changed between two looks, in words, or '' when nothing did. */
export let changed = (
  was: Seen,
  now: Map<string, { hash: string; row: Bundle }>,
) => {
  let added = [...now].filter(([eid]) => !(eid in was))
  let edited = [...now].filter(([eid, n]) => eid in was && was[eid] != n.hash)
  let left = Object.keys(was).filter((eid) => !now.has(eid))
  if (!added.length && !edited.length && !left.length) return ''
  let lines = [
    ...added.map(([, n]) => `new: ${clipped(n.row)}`),
    ...edited.map(([, n]) => `changed: ${clipped(n.row)}`),
    ...left.map((eid) => `gone: ${eid}`),
  ]
  let counts = [
    added.length && `${added.length} new`,
    edited.length && `${edited.length} changed`,
    left.length && `${left.length} gone`,
  ].filter(Boolean).join(', ')
  let more = lines.length - SHOWN
  return [
    `What changed (${counts}):`,
    ...lines.slice(0, SHOWN),
    ...more > 0 ? [`and ${more} more`] : [],
  ].join('\n')
}

let seenFrom = (now: Map<string, { hash: string }>): Seen =>
  Object.fromEntries([...now].map(([eid, n]) => [eid, n.hash]))

/**
 * A subscription that fired looks at its query again: when its rows differ
 * from what it saw last, the change is given to the Operator once for this
 * firing (`at`), then kept as what it saw. A replay of the same firing finds
 * the same change and gives it again to no effect.
 */
export let looked = async (
  store: Parameters<typeof fire>[0],
  row: Bundle,
  at: string,
  watching: Watching,
) => {
  let sub = row.operator_subscription as Subscription
  let ask = row.operator_ask as Ask
  let now = await seenOf(await watching(ask, sub.query, sub.mine))
  let what = changed(sub.seen ?? {}, now)
  if (!what) return
  await fire(store, row, 'subscription', at, what)
  await store.g.apply([{
    entity: row.entity,
    operator_subscription: { seen: seenFrom(now) },
  }], { trusted: true })
}

let shown = (b: Bundle) => {
  let sub = b.operator_subscription as Subscription
  return {
    subscription: short(b.entity.eid),
    query: sub.query,
    ...sub.mine ? { mine: true } : {},
    every: (b.wake as { every: string }).every,
    say: (b.operator_ask as Ask).say,
    rows: Object.keys(sub.seen ?? {}).length,
    ...b.fired ? { looked: (b.fired as { at: string }).at } : {},
  }
}

/** The tools that subscribe the Operator to a query, list what it is
 * subscribed to, and cancel one. */
export let subscriptionTools = (
  store: Store,
  space: Space,
  watching: Watching,
): Tool[] => [
  {
    name: 'subscription_set',
    title: 'Subscribe to a query',
    step: { doing: 'Subscribing…', done: 'Subscribed' },
    description:
      `Be woken when something changes for the person you work for: a query you watch, read again every so often, and each time its rows change (a row arrives, changes, or leaves the answer) the words you give in say arrive in your conversation with them, with what changed, and what you answer reaches them in their Updates. Over the space, as they read it with graph_query: new rows of a kind, one row changing, a build finishing (its built row), what a webhook wrote. An app's errors need none: each break already comes to you to fix. With mine, over your own store instead: a helper's session ending, a reply to a text or letter you sent (a helper's answer and a reply already come back to you on their own; subscribe only to act on them differently). It looks again on every and costs nothing while nothing changes; each change is a turn run as them and paid from the space's budget. It watches at most ${ROWS} rows, so ask for what you need.`,
    parameters: {
      type: 'object',
      properties: {
        say: {
          type: 'string',
          description:
            'What to do when it changes, as words to yourself: what to tell them, check or do.',
        },
        query: {
          type: 'string',
          description:
            'The query whose rows you watch, written as for graph_query (.in=<app> narrows it to one app).',
        },
        mine: {
          type: 'boolean',
          description:
            'Read the query over your own store (your sessions, helpers and requests) rather than the space.',
        },
        every: {
          type: 'string',
          description:
            `How often to look again: a duration of a minute or more (5m, 1h), five cron fields with the person's IANA time zone after them, or @hourly, @daily. Left out, ${EVERY}.`,
        },
      },
      required: ['say', 'query'],
    },
    run: async (args, context) => {
      let say = String(args.say ?? '').trim()
      let query = String(args.query ?? '').trim()
      let every = String(args.every ?? '').trim() || EVERY
      let mine = args.mine === true
      if (!say) throw refuse('arguments', 'Say what to do when it changes.')
      if (!query) throw refuse('arguments', 'Give the query to watch.')
      let now = Date.now()
      let gap = span(every)
      let at = gap == null
        ? next(every, now)
        : new Date(now + gap).toISOString()
      if (!at) {
        throw refuse('arguments', `${every} is not a cadence that ever comes.`)
      }
      if (gap != null && gap < SOONEST) {
        throw refuse('arguments', 'Look again a minute apart or more.')
      }
      let { person, administrative } = await whoseOf(store, context)
      let ask: Ask = {
        space: space.eid,
        person,
        say,
        ...administrative ? { administrative } : {},
      }
      // What it answers now is what a change is measured from, and a query
      // it cannot read is refused here rather than at every look.
      let seen = seenFrom(await seenOf(await watching(ask, query, mine)))
      let row = {
        entity: { eid: crypto.randomUUID() },
        wake: { at, every },
        operator_ask: ask,
        operator_subscription: { query, ...mine ? { mine } : {}, seen },
      }
      await store.g.apply([row], { trusted: true })
      return JSON.stringify(shown(row))
    },
  },
  {
    name: 'subscription_list',
    title: 'List subscriptions',
    step: { doing: 'Reading subscriptions…', done: 'Read subscriptions' },
    description:
      'What you are subscribed to for the person you work for: each subscription’s id, its query, how often it looks, its words, how many rows it watches and when it last looked.',
    readOnly: true,
    parameters: { type: 'object', properties: {} },
    run: async (_, context) => {
      let { person } = await whoseOf(store, context)
      let rows = await store.g.read(
        `.operator_ask.person=${person} .operator_subscription ?wake ?fired`,
      )
      return JSON.stringify(rows.map(shown))
    },
  },
  {
    name: 'subscription_cancel',
    title: 'Cancel a subscription',
    step: { doing: 'Cancelling a subscription…', done: 'Cancelled' },
    description:
      'Cancel a subscription of the person you work for, by the id subscription_set or subscription_list gave, so it never wakes you again.',
    parameters: {
      type: 'object',
      properties: {
        subscription: {
          type: 'string',
          description: 'The subscription’s id.',
        },
      },
      required: ['subscription'],
    },
    run: async (args, context) => {
      let id = String(args.subscription ?? '').trim()
      let { person } = await whoseOf(store, context)
      let [row] = id ? await store.g.get(await addressed(store.g, [id])) : []
      let ask = row?.operator_ask as Ask | undefined
      if (!row?.operator_subscription || ask?.person != person) {
        throw refuse('missing', `There is no subscription ${id} to cancel.`)
      }
      await store.g.apply([{ entity: row.entity, $delete: true }], {
        trusted: true,
      })
      return JSON.stringify({ cancelled: short(row.entity.eid) })
    },
  },
]
