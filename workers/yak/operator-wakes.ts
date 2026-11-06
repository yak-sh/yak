// The Operator's own schedule: wake-ups it sets for the person it works for,
// kept as @yaks/wake rows in its store beside their conversation. A row is
// `wake{at, every}` and the words it was set with (`operator_ask`); the
// store's alarm fires it (operator-store.ts `drain`), and a firing is those
// words given to the Operator as that person's (operator-channels.ts `fire`),
// a turn in their conversation paid from the space's budget like any other.
// The rows are the object's durable storage, so they outlast restarts and
// deploys.
import { addressed, type Bundle } from '@yaks/graph'
import { short } from '@yaks/id'
import type { Tool, ToolContext } from '@yaks/session'
import { next, span, type Wake } from '@yaks/wake'
import type { Space } from './directory.ts'
import type { Ask } from './operator-channels.ts'
import type { operatorStore } from './operator-store.ts'
import { refuse } from './tool.ts'

type Store = Pick<ReturnType<typeof operatorStore>, 'g'>

// Whose a call's wake-ups are: the person the session works for.
let whoseOf = async (store: Store, context?: ToolContext) => {
  let [row] = context ? await store.g.get([context.session]) : []
  let o = row?.operator_session as
    | { person: string; administrative?: boolean }
    | undefined
  if (!o) throw new Error('Operator session names no person')
  return o
}

// When a wake-up first fires: an instant, a delay from now, or the first
// time its cadence names.
let firstOf = (at: string, every: string, now: number) => {
  if (at) {
    let delay = span(at)
    let when = delay == null ? Date.parse(at) : now + delay
    if (!Number.isFinite(when)) {
      throw refuse(
        'arguments',
        `${at} is not a time: give an ISO 8601 instant with its offset, or a delay such as 10m.`,
      )
    }
    if (when <= now) throw refuse('arguments', `${at} has already passed.`)
    return new Date(when).toISOString()
  }
  let first = next(every, now)
  if (!first) {
    throw refuse('arguments', `${every} is not a cadence that ever comes.`)
  }
  return first
}

let shown = (b: Bundle) => {
  let wake = b.wake as Wake
  return {
    wake: short(b.entity.eid),
    at: wake.at,
    ...wake.every ? { every: wake.every } : {},
    say: (b.operator_ask as Ask).say,
    ...b.fired ? { fired: (b.fired as { at: string }).at } : {},
  }
}

/** The tools that set, list and cancel a person's wake-ups. */
export let wakeTools = (store: Store, space: Space): Tool[] => [
  {
    name: 'wake_set',
    title: 'Set a wake-up',
    step: { doing: 'Setting a wake-up…', done: 'Set a wake-up' },
    description:
      'Come back to something later for the person you work for: once at a time ("remind me at 5", "check this tomorrow"), or on a cadence (every morning at 9, every 2 hours). When it fires, the words you give in say arrive in your conversation with them as theirs, marked as your wake-up, and what you answer reaches them in their Updates. Write say as what to do then, with what you will need to know. Give at, every, or both. It runs as them and is paid from the space’s budget each time it fires.',
    parameters: {
      type: 'object',
      properties: {
        say: {
          type: 'string',
          description:
            'What to do when it fires, as words to yourself: what to remind them of, check or do.',
        },
        at: {
          type: 'string',
          description:
            'When it first fires: an ISO 8601 instant with the person’s offset (2026-11-07T17:00:00-05:00), or a delay from now (10m, 2h, 1d). Left out with every, it first fires when every next comes.',
        },
        every: {
          type: 'string',
          description:
            'How it recurs: a duration (30m, 2h, 1d), five cron fields with the person’s IANA time zone after them (0 9 * * 1-5 America/New_York), or @hourly, @daily, @weekly, @monthly. Left out, it fires once.',
        },
      },
      required: ['say'],
    },
    run: async (args, context) => {
      let say = String(args.say ?? '').trim()
      let at = String(args.at ?? '').trim()
      let every = String(args.every ?? '').trim()
      if (!say) throw refuse('arguments', 'Say what to do when it fires.')
      if (!at && !every) throw refuse('arguments', 'Give at, every, or both.')
      let now = Date.now()
      if (every && !next(every, now)) {
        throw refuse('arguments', `${every} is not a cadence that ever comes.`)
      }
      let { person, administrative } = await whoseOf(store, context)
      let row = {
        entity: { eid: crypto.randomUUID() },
        wake: { at: firstOf(at, every, now), ...every ? { every } : {} },
        operator_ask: {
          space: space.eid,
          person,
          say,
          ...administrative ? { administrative } : {},
        },
      }
      await store.g.apply([row], { trusted: true })
      return JSON.stringify(shown(row))
    },
  },
  {
    name: 'wake_list',
    title: 'List wake-ups',
    step: { doing: 'Reading wake-ups…', done: 'Read wake-ups' },
    description:
      'The wake-ups set for the person you work for that will fire again: each one’s id, when it next fires, how it recurs, its words, and when it last fired.',
    readOnly: true,
    parameters: { type: 'object', properties: {} },
    run: async (_, context) => {
      let { person } = await whoseOf(store, context)
      let rows = await store.g.read(
        `.operator_ask.person=${person} .wake.at ?fired .order=wake.at`,
      )
      return JSON.stringify(rows.map(shown))
    },
  },
  {
    name: 'wake_cancel',
    title: 'Cancel a wake-up',
    step: { doing: 'Cancelling a wake-up…', done: 'Cancelled a wake-up' },
    description:
      'Cancel a wake-up set for the person you work for, by the id wake_set or wake_list gave, so it never fires again.',
    parameters: {
      type: 'object',
      properties: {
        wake: { type: 'string', description: 'The wake-up’s id.' },
      },
      required: ['wake'],
    },
    run: async (args, context) => {
      let id = String(args.wake ?? '').trim()
      let { person } = await whoseOf(store, context)
      let [row] = id ? await store.g.get(await addressed(store.g, [id])) : []
      let ask = row?.operator_ask as Ask | undefined
      if (!row?.wake || ask?.person != person) {
        throw refuse('missing', `There is no wake-up ${id} to cancel.`)
      }
      await store.g.apply([{ entity: row.entity, $delete: true }], {
        trusted: true,
      })
      return JSON.stringify({ cancelled: short(row.entity.eid) })
    },
  },
]
