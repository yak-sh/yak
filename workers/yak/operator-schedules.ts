// A person's schedules and subscriptions with their space's Operator: wakes
// (@yaks/wake) kept in its store beside their conversation, each set for them
// (`wake.for`), so it runs as them, with their permissions as they stand when
// it fires, and only they list and cancel it. The store's alarm fires them
// (operator-store.ts `drain`). What a firing asks is @yaks/wake's `wake_run`,
// run here: the wake's note becomes their words in the conversation that set
// it (`wake.target`, operator-channels.ts `operator_receive`), a call
// runs with no model turn (@yaks/wake/run), and a brief starts a fresh helper
// given the call's outcome. A subscription is a wake that watches a query
// (`watch`): it fires only when the query's rows changed, and its note comes
// with what changed. It keeps no cadence: each commit to what it reads stirs
// it (@yaks/wake `stir`), the space's apps telling the Operator of theirs
// (graph.ts `#herald`, build.ts `HEARD`) and this store hearing its own
// (`ownCommits`), so it looks a beat later and rests until the next. The
// tools are the Operator's published ones; their names and schemas are kept
// (M-37853).
import { line } from '@yaks/query'
import { type Bundle, derivedEid, type Plugin } from '@yaks/graph'
import { short } from '@yaks/id'
import { type Tool, type ToolContext, topOf } from '@yaks/session'
import {
  cancel,
  held,
  look,
  next,
  stir,
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
import type { OperatorStore } from './operator-store.ts'
import { whoseOf } from './operator-root.ts'
import { refuse } from './tool.ts'

type Store = Pick<OperatorStore, 'g'>

let wakeOf = (b: Bundle) => b.wake as Wake

/** A subscription's query, read as the person its wake is set for: over the
 * space through their reach, or, when `local`, over the Operator's own
 * store. */
export type Watching = (wake: Bundle, watch: Watch) => Promise<Bundle[]>

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
    ...watch.tool ? { tool: watch.tool, args: watch.args ?? {} } : {},
    query: watch.query,
    ...watch.local ? { mine: true } : {},
    say: wakeOf(b).note ?? '',
    rows: Object.keys(watch.seen ?? {}).length,
    ...b.fired ? { looked: (b.fired as { at: string }).at } : {},
  }
}

// The conversation a wake set in `context` wakes when it fires: the one
// that set it, though a helper of it set it (`wake.target`).
let settingOf = async (store: Store, context?: ToolContext) =>
  context ? { target: await topOf(store.g, context.session) } : {}

/** The tools that set, list and cancel a person's wake-ups. */
export let wakeTools = (store: Store): Tool[] => [
  {
    name: 'wake_set',
    title: 'Come back at a time, once or on a cadence',
    step: {
      doing: 'Setting a reminder to come back…',
      done: 'Set a reminder to come back',
    },
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
          ...await settingOf(store, context),
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
    step: {
      doing: 'Checking the reminders it set…',
      done: 'Checked the reminders it set',
    },
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
            line`.occurrence.wake=${row.entity.eid} ?completed ?failed ?session .order=-occurrence.at .limit=10`,
          ),
        }))),
      )
    },
  },
  {
    name: 'wake_cancel',
    title: 'Cancel a wake-up',
    step: { doing: 'Cancelling a reminder…', done: 'Cancelled a reminder' },
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
      if (!gone) {
        throw refuse('missing', `There is no wake-up ${id} to cancel.`)
      }
      return JSON.stringify({ cancelled: short(gone.entity.eid) })
    },
  },
]

// Why a subscription to a tool is refused: its answer is no store query's
// rows (an outside API, a listing it builds), so nothing commits to tell it
// of a change, and it is never polled instead.
export let UNSUBSCRIBABLE = (name: string) =>
  `${name} is not subscribable: its answer is not a store query's rows, so no commit tells you it changed, and it is never re-asked on a clock. Subscribe to a tool whose description says Subscribable, or to graph_query over what it reads`

// What a subscription watches: a query as given, or the one a reading tool
// declares for its arguments (session Tool `watch`).
let watchFor = (
  args: Record<string, unknown>,
  holding: (name: string) => Tool | undefined,
): Watch => {
  let name = String(args.tool ?? '').trim()
  let query = String(args.query ?? '').trim()
  if (!name) {
    if (!query) throw refuse('arguments', 'Give the tool or query to watch.')
    if (args.args !== undefined) {
      throw refuse('arguments', 'Give the tool these arguments belong to.')
    }
    return { query, ...args.mine === true ? { local: true } : {} }
  }
  if (query || args.mine !== undefined) {
    throw refuse(
      'arguments',
      'Give a tool or a query, not both: a tool says where its query reads.',
    )
  }
  let tool = holding(name)
  if (!tool) throw refuse('missing', `You hold no tool ${name}.`)
  if (!tool.readOnly || !tool.watch) {
    throw refuse('arguments', UNSUBSCRIBABLE(name))
  }
  let given = (args.args ?? {}) as Record<string, unknown>
  if (typeof given != 'object' || Array.isArray(given)) {
    throw refuse('arguments', `Give ${name}'s args as an object.`)
  }
  return { ...tool.watch(given), tool: name, args: given }
}

/** The tools that subscribe the Operator to a query or a reading tool's
 * answer, list what it is subscribed to, and cancel one. `holding` finds a
 * tool the turn holds by name. */
export let subscriptionTools = (
  store: Store,
  watching: Watching,
  holding: (name: string) => Tool | undefined,
): Tool[] => [
  {
    name: 'subscription_set',
    title: 'Be told when something changes: watch a query',
    step: {
      doing: 'Setting up a watch for changes…',
      done: 'Set up a watch for changes',
    },
    description:
      `Be woken when something changes for the person you work for: a reading tool's answer or a query you watch live, and within seconds of each commit that changes its rows (a row arrives, changes, or leaves the answer) the words you give in say arrive in your conversation with them, with what changed, and what you answer stays in that chat: tell them with notification_send when they should hear of it. Over the space, as they read it with graph_query: new rows of a kind, one row changing, a build finishing (its built row), what a webhook wrote. An app's errors need none: each break already comes to you to fix. With mine, over your own store instead: a helper's session ending, a reply to a text or letter you sent (a helper's answer and a reply already come back to you on their own; subscribe only to act on them differently). Writes close together make one turn, and nothing is spent while nothing changes; each change is a turn run as them and paid from the space's budget. It watches at most ${ROWS} rows, so ask for what you need. Give tool and args to watch a reading tool's answer to those args, as you would call it now: only a tool whose description says Subscribable, whose answer is a store query's rows; any other (an outside API, a listing) is never re-asked on a clock and is refused. Or give query, as graph_query's q.`,
    parameters: {
      type: 'object',
      properties: {
        say: {
          type: 'string',
          description:
            'What to do when it changes, as words to yourself: what to tell them, check or do.',
        },
        tool: {
          type: 'string',
          description:
            'A reading tool whose answer you watch, one whose description says Subscribable.',
        },
        args: {
          type: 'object',
          description: "That tool's arguments, as you would call it now.",
        },
        query: {
          type: 'string',
          description:
            'Without tool: the query whose rows you watch, written as for graph_query (.in=<app> narrows it to one app).',
        },
        mine: {
          type: 'boolean',
          description:
            'With query: read it over your own store (your sessions, helpers and requests) rather than the space.',
        },
      },
      required: ['say'],
    },
    run: async (args, context) => {
      let say = String(args.say ?? '').trim()
      if (!say) throw refuse('arguments', 'Say what to do when it changes.')
      let watch = watchFor(args, holding)
      let { person } = await whoseOf(store, context)
      let wake = { for: person, note: say, ...await settingOf(store, context) }
      // What it answers now is what a change is measured from, and a query
      // it cannot read is refused here rather than at every look. Reading it
      // over the space asks each app it reads to tell this store of its
      // commits.
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
    step: {
      doing: 'Checking what it watches for…',
      done: 'Checked what it watches for',
    },
    description:
      'What you are subscribed to for the person you work for: each subscription’s id, the tool and args it watches the answer of or its query, its words, how many rows it watches and when it last looked.',
    readOnly: true,
    parameters: { type: 'object', properties: {} },
    run: async (_, context) => {
      let { person } = await whoseOf(store, context)
      let rows = await store.g.read(
        line`.wake.for=${person}&.watch&.order=entity.eid&*`,
      )
      return JSON.stringify(rows.map(shownWatch))
    },
  },
  {
    name: 'subscription_cancel',
    title: 'Cancel a subscription',
    step: {
      doing: 'Stopping a watch for changes…',
      done: 'Stopped a watch for changes',
    },
    description:
      'Cancel a subscription of the person you work for by its id from subscription_set or subscription_list. Available when acting on the subscription owner’s own request. Use subscription_list in turns triggered by a subscription, an app page, an error report, or another person’s thread.',
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

/** Something the subscriptions of this store read committed: over the space
 * (an app told the Operator, build.ts `HEARD`), or with `mine` over this store
 * itself (`ownCommits`). Each such subscription looks again a beat later
 * (@yaks/wake `stir`). Answers when the soonest looks, in epoch ms, or null
 * when none watches there. */
export let heard = (store: Store, mine: boolean, now = Date.now()) =>
  stir(
    {
      read: (q, o) => store.g.read(q, o),
      apply: (b, o) => store.g.apply(b, { ...o, trusted: true }),
    },
    now,
    { which: (b) => !!watchOf(b)?.local == mine },
  )

/** What tells the Operator's store of its own commits, for the
 * subscriptions over it: `stirred` after each commit beyond the scheduler's
 * own (one of wakes alone, as a look that rests writes), so a look never
 * stirs another. */
export let ownCommits = (stirred: () => void): Plugin => ({
  name: 'yak/subscriptions',
  hooks: {
    effect: (bundles) => {
      if (bundles.some((b) => !b.wake)) stirred()
      return bundles
    },
  },
})

/** How many subscriptions one batch of `uncadenced` moves. */
let BATCH = 50

/** One batch of the pass that takes each subscription kept on a cadence
 * (`wake.every`, before they were live) off it, due now: its next look asks
 * each app it reads to tell this store of its commits, and it rests after.
 * Answers whether another batch has work; one run twice finds none. */
export let uncadenced = async (store: Store): Promise<boolean> => {
  let rows = await store.g.read(
    line`.watch&.wake.every&.limit=${BATCH}&.fields=entity.eid`,
  )
  let at = new Date().toISOString()
  if (rows.length) {
    await store.g.apply(
      rows.map((b) => ({ entity: b.entity, wake: { every: null, at } })),
      { trusted: true },
    )
  }
  return rows.length == BATCH
}

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

/** Finish an occurrence once, keeping its outcome on it, in its own chat:
 * what it did reaches the person only as a helper or the tool it ran tells
 * them (notification_send), so a run with nothing to say tells nobody. A
 * failed one also asks their Operator to recover it. */
export let finished = async (
  store: OperatorStore,
  row: Bundle,
  text: string,
  error?: string,
) => {
  let { g } = store
  let [current] = await g.get([row.entity.eid])
  if (!current?.occurrence || current.completed || current.failed) return
  error ??= (current.occurrence as { error?: string }).error
  if (error) await failed(store, current, text, error)
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
    let watch = watchOf(row)
    let changes = watch?.tool
      ? `${watch.tool} ${
        JSON.stringify(watch.args ?? {})
      } answers differently now.\n${watch.changes ?? ''}`
      : watch?.changes ?? ''
    await fire(store, space, row, watch ? 'subscription' : 'wake', at, changes)
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
