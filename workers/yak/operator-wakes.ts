// The Operator's own schedule: wake-ups it sets for the person it works for,
// kept as @yaks/wake rows in its store beside their conversation. A row is
// `wake{at, every}` with `operator_ask{space, person, say, helper}` and an
// optional ordinary `call{to, args}`. The store's alarm fires it; words wake
// the conversation, while calls and checking helpers run through operator-work.
// The rows are the object's durable storage, so they outlast restarts and
// deploys.
import { addressed, type Bundle } from '@yaks/graph'
import { short } from '@yaks/id'
import type { Tool, ToolContext } from '@yaks/session'
import { next, span, type Wake } from '@yaks/wake'
import { toolEid } from '@yaks/tools'
import type { Space } from './directory.ts'
import type { Ask } from './operator-channels.ts'
import type { operatorStore } from './operator-store.ts'
import { refuse } from './tool.ts'

type Store = Pick<ReturnType<typeof operatorStore>, 'g'>

/** Whose a call's wake-ups are: the person the session works for. */
export let whoseOf = async (store: Store, context?: ToolContext) => {
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
    ...(b.operator_ask as Ask).helper
      ? { helper: (b.operator_ask as Ask).helper }
      : {},
    ...b.call ? { call: b.call } : {},
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
      'Come back later, once or on a cadence, with the current permissions of the person you work for. Give say to wake your conversation; give tool and args to schedule the same tool call you would make now, without a model turn (for a script: tool code_mode, args {script: code}). Give helper for a fresh helper each run, after the call if supplied, with its outcome included for checking; its report stays with the run, and it tells them with notification_send only when they should hear. You may also give say after a tool call. Each run and its outcome is kept; failures reach your conversation and the tracker. Give at, every, or both. Model work spends from the space’s budget.',
    parameters: {
      type: 'object',
      properties: {
        say: {
          type: 'string',
          description:
            'What to do when it fires, as words to yourself: what to remind them of, check or do.',
        },
        tool: {
          type: 'string',
          description: 'The existing tool name to call at each occurrence.',
        },
        args: {
          type: 'object',
          description: 'The same arguments as an immediate call to that tool.',
        },
        helper: {
          type: 'string',
          description:
            'A brief for a fresh helper each run. After a call, it also receives the call outcome, including errors.',
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
    },
    run: async (args, context) => {
      let say = String(args.say ?? '').trim()
      let tool = String(args.tool ?? '').trim()
      let helper = String(args.helper ?? '').trim()
      let at = String(args.at ?? '').trim()
      let every = String(args.every ?? '').trim()
      if (!say && !tool && !helper) {
        throw refuse(
          'arguments',
          'Give say, tool, or helper for what to do when it fires.',
        )
      }
      if (args.args !== undefined && !tool) {
        throw refuse('arguments', 'Give the tool these arguments belong to.')
      }
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
          ...helper ? { helper } : {},
          ...administrative ? { administrative } : {},
        },
        ...tool ? { call: { to: toolEid(tool), args: args.args ?? {} } } : {},
      }
      await store.g.apply([
        ...tool
          ? [{ entity: { eid: toolEid(tool) }, tool: { name: tool } }]
          : [],
        row,
      ], { trusted: true })
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
        `.operator_ask.person=${person} .wake.at !operator_subscription ?fired ?call .order=wake.at`,
      )
      return JSON.stringify(
        await Promise.all(rows.map(async (row) => ({
          ...shown(row),
          runs: await store.g.read(
            `.operator_work.schedule=${row.entity.eid} ?completed ?failed ?session .order=-operator_work.at .limit=10`,
          ),
        }))),
      )
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
