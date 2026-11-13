// A person's schedules and subscriptions with their space's Operator: wakes
// (@yaks/wake) kept in its store beside their conversation, each set for them
// (`wake.for`), so it runs as them, with their permissions as they stand when
// it fires, and only they list and cancel it. The store's alarm fires them
// (operator-store.ts `drain`). What a firing asks is @yaks/wake's `wake_run`,
// run here: the wake's note becomes their words in their conversation, a call
// runs with no model turn (@yaks/wake/run), and a brief starts a fresh helper
// given the call's outcome. A subscription is a wake that watches a query
// (`watch`): it fires only when the query's rows changed, and its note comes
// with what changed. The tools are the Operator's published ones; their names
// and schemas are kept (M-37853).
import { type Bundle, derivedEid } from '@yaks/graph'
import { short } from '@yaks/id'
import type { Tool } from '@yaks/session'
import {
  cancel,
  held,
  look,
  next,
  span,
  theirs,
  type Wake,
  type Watch,
  watchOf,
  when,
} from '@yaks/wake'
import { run } from '@yaks/wake/run'
import { type Runner, toolEid } from '@yaks/tools'
import { defect } from './defects.ts'
import { type Ask, fire, receive } from './operator-channels.ts'
import { notification } from './operator-updates.ts'
import type { OperatorStore } from './operator-store.ts'
import { whoseOf } from './operator-root.ts'
import { refuse } from './tool.ts'

type Store = Pick<OperatorStore, 'g'>

let wakeOf = (b: Bundle) => b.wake as Wake

/** A subscription's query, read as the person its wake is set for: over the
 * space through their reach, or, when `local`, over the Operator's own
 * store. */
export type Watching = (wake: Bundle, watch: Watch) => Promise<Bundle[]>

/** The least time between two looks. */
let SOONEST = 60_000
let EVERY = '1m'
/** The most rows a subscription watches (@yaks/wake `ROWS`). */
let ROWS = 200

// When a wake first fires: an instant, a delay from now, or the first time
// its cadence names.
let firstOf = (at: string, every: string, now: number) => {
  if (at) {
    let t = when(at, now)
    if (t == null) {
      throw refuse(
        'arguments',
        `${at} is not a time: give an ISO 8601 instant with its offset, or a delay such as 10m.`,
      )
    }
    if (t <= now) throw refuse('arguments', `${at} has already passed.`)
    return new Date(t).toISOString()
  }
  let first = next(every, now)
  if (!first) {
    throw refuse('arguments', `${every} is not a cadence that ever comes.`)
  }
  return first
}

let shownWake = (b: Bundle) => {
  let wake = wakeOf(b)
  return {
    wake: short(b.entity.eid),
    at: wake.at,
    ...wake.every ? { every: wake.every } : {},
    say: wake.note ?? '',
    ...wake.brief ? { helper: wake.brief } : {},
    ...b.call ? { call: b.call } : {},
    ...b.fired ? { fired: (b.fired as { at: string }).at } : {},
  }
}

let shownWatch = (b: Bundle) => {
  let watch = watchOf(b)!
  return {
    subscription: short(b.entity.eid),
    query: watch.query,
    ...watch.local ? { mine: true } : {},
    every: wakeOf(b).every,
    say: wakeOf(b).note ?? '',
    rows: Object.keys(watch.seen ?? {}).length,
    ...b.fired ? { looked: (b.fired as { at: string }).at } : {},
  }
}

/** The tools that set, list and cancel a person's wake-ups. */
export let wakeTools = (store: Store): Tool[] => [
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
      let { person } = await whoseOf(store, context)
      let row = {
        entity: { eid: crypto.randomUUID() },
        wake: {
          at: firstOf(at, every, now),
          for: person,
          ...every ? { every } : {},
          ...say ? { note: say } : {},
          ...helper ? { brief: helper } : {},
        },
        ...tool ? { call: { to: toolEid(tool), args: args.args ?? {} } } : {},
      }
      await store.g.apply([
        ...tool
          ? [{ entity: { eid: toolEid(tool) }, tool: { name: tool } }]
          : [],
        row,
      ], { trusted: true })
      return JSON.stringify(shownWake(row))
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
      let rows = (await held(store.g, person)).filter((b) => !b.watch)
      return JSON.stringify(
        await Promise.all(rows.map(async (row) => ({
          ...shownWake(row),
          runs: await store.g.read(
            `.occurrence.wake=${row.entity.eid} ?completed ?failed ?session .order=-occurrence.at .limit=10`,
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
      let gone = await cancel(store.g, person, id, { trusted: true })
      if (!gone) throw refuse('missing', `There is no wake-up ${id} to cancel.`)
      return JSON.stringify({ cancelled: short(gone.entity.eid) })
    },
  },
]

/** The tools that subscribe the Operator to a query, list what it is
 * subscribed to, and cancel one. */
export let subscriptionTools = (
  store: Store,
  watching: Watching,
): Tool[] => [
  {
    name: 'subscription_set',
    title: 'Subscribe to a query',
    step: { doing: 'Subscribing…', done: 'Subscribed' },
    description:
      `Be woken when something changes for the person you work for: a query you watch, read again every so often, and each time its rows change (a row arrives, changes, or leaves the answer) the words you give in say arrive in your conversation with them, with what changed, and what you answer reaches them in their Updates and the way they chose to be alerted. Over the space, as they read it with graph_query: new rows of a kind, one row changing, a build finishing (its built row), what a webhook wrote. An app's errors need none: each break already comes to you to fix. With mine, over your own store instead: a helper's session ending, a reply to a text or letter you sent (a helper's answer and a reply already come back to you on their own; subscribe only to act on them differently). It looks again on every and costs nothing while nothing changes; each change is a turn run as them and paid from the space's budget. It watches at most ${ROWS} rows, so ask for what you need.`,
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
      let local = args.mine === true
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
      let { person } = await whoseOf(store, context)
      let wake = { at, every, for: person, note: say }
      let watch = { query, ...local ? { local } : {} }
      // What it answers now is what a change is measured from, and a query
      // it cannot read is refused here rather than at every look.
      let entity = { eid: crypto.randomUUID() }
      let { seen } = await look(
        {},
        await watching({ entity, wake }, watch),
      )
      let row = { entity, wake, watch: { ...watch, seen } }
      await store.g.apply([row], { trusted: true })
      return JSON.stringify(shownWatch(row))
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
      let rows = (await held(store.g, person)).filter((b) => b.watch)
      return JSON.stringify(rows.map(shownWatch))
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
      let row = await theirs(store.g, person, id)
      if (!row?.watch) {
        throw refuse('missing', `There is no subscription ${id} to cancel.`)
      }
      await cancel(store.g, person, id, { trusted: true })
      return JSON.stringify({ cancelled: short(row.entity.eid) })
    },
  },
]

/** The input a scheduled helper is given in an occurrence's session. */
export let helperInput = (occurrence: string) =>
  derivedEid(`operator-work-helper|${occurrence}`)

let failed = async (
  store: OperatorStore,
  row: Bundle,
  text: string,
  error: string,
) => {
  let ask = row.operator_session as Ask
  let wake = (row.occurrence as { wake: string }).wake
  let id = derivedEid(`operator-work-failed|${row.entity.eid}`)
  if ((await store.g.get([id]))[0]) return
  defect(new Error(`Scheduled Operator work failed: ${error}`), {
    request: 'operator scheduled work',
    schedule: wake,
    run: row.entity.eid,
    space: ask.space,
  })
  await receive(
    store,
    {
      space: ask.space,
      person: ask.person,
      channel: 'wake',
      about: wake,
    },
    `Scheduled work ${row.entity.eid} failed. Find the cause and recover it.\n\n${text}`,
    { id },
  )
}

/** Finish an occurrence once, keeping its outcome on it, and in the person's
 * Updates unless a helper ran in it: a helper tells them itself with
 * notification_send when they should hear, so a run with nothing to say
 * tells nobody. A failed one also asks their Operator to recover it. */
export let finished = async (
  store: OperatorStore,
  row: Bundle,
  text: string,
  error?: string,
) => {
  let { g } = store
  let [current] = await g.get([row.entity.eid])
  if (!current?.occurrence || current.completed || current.failed) return
  let ask = current.operator_session as Ask
  error ??= (current.occurrence as { error?: string }).error
  if (error) await failed(store, current, text, error)
  let [helped] = await g.get([helperInput(row.entity.eid)])
  await g.apply([
    {
      entity: row.entity,
      ...error ? { failed: { reason: error } } : { completed: {} },
    },
    {
      entity: { eid: derivedEid(`operator-work-outcome|${row.entity.eid}`) },
      entry: { session: row.entity.eid, from: 'the system' },
      content: { body: text },
      notice: {},
    },
    ...helped ? [] : [notification({
      to: ask.person,
      by: ask.space,
      words: text,
      about: row.entity.eid,
      id: row.entity.eid,
    })],
  ], { trusted: true })
}

/** What the Operator lends a scheduled run. */
export type Capabilities = {
  /** a runner over the tools the person may use now, for the occurrence */
  runner: (occurrence: string, ask: Ask) => Promise<Runner>
  /** start a fresh helper in the occurrence's session */
  helper: (occurrence: string, ask: Ask, brief: string) => Promise<void>
}

/**
 * What a wake set for a person asks when it fires at `at` (@yaks/wake
 * `wake_run`): its call, once, as them, with no model turn; then its note in
 * their conversation with the call's outcome; then a helper given its brief
 * and the outcome. A wake with words alone is a turn in their conversation,
 * with what changed for one that watches a query. Retries reuse what each
 * step already kept.
 */
export let fired = async (
  store: OperatorStore,
  space: string,
  row: Bundle,
  at: string,
  capabilities: Capabilities,
) => {
  let wake = wakeOf(row)
  if (!wake?.for) return
  let ask: Ask = { space, person: wake.for }
  if (!row.call && !wake.brief) {
    let channel = row.watch ? 'subscription' : 'wake'
    await fire(store, space, row, channel, at, watchOf(row)?.changes ?? '')
    return
  }
  let ran = await run(store.g, row, at, {
    runner: (occurrence) => capabilities.runner(occurrence, ask),
    with: {
      session: {},
      operator_session: ask,
      doc: { title: `Scheduled work: ${at}` },
    },
    by: space,
  })
  if (!ran) return
  let { occurrence, error } = ran
  let text = row.call ? ran.text : 'Scheduled work finished.'
  await fire(store, space, row, 'wake', at, `Call outcome:\n${text}`)
  let [current] = await store.g.get([occurrence])
  if (error) await failed(store, current, text, error)
  if (wake.brief) {
    try {
      await capabilities.helper(
        occurrence,
        ask,
        `${wake.brief}\n\nScheduled occurrence: ${at}\nCall outcome${
          error ? ' (failed)' : ''
        }:\n${text}`,
      )
      return
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      text = `The scheduled helper could not start: ${error}`
    }
  }
  await finished(store, current, text, error)
}
