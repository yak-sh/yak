// What the platform admin's Operator reads of the platform (T-146331): its
// errors and bugs in the platform tracker, a space's budget and spend, and
// the fee. They are offered only in the sessions of a person who owns the
// meta space (tool.ts `admin`), read through the whole directory, since an
// Operator's own is narrowed to its space. Each only reads: nothing that
// writes, erases, refunds, rolls back or stops is an Operator's. They carry
// the names the box's admin and tracker tools publish.
import type { Tool } from '@yaks/session'
import { errors } from '@yaks/tracker/errors'
import { type Options, read } from '@yaks/tracker/routes'
import { type Directory, META } from './directory.ts'
import type { Env } from './env.ts'
import { standing } from './budget.ts'
import { budgetLines } from './lib/budget-lines.ts'
import { rate } from './sell.ts'
import { refuse } from './tool.ts'

let text = (v: unknown) => typeof v == 'string' ? v.trim() : ''

// The platform tracker, through the Worker's binding onto it: the same
// signed reads the box makes, scoped to the platform.
let trackerOf = (env: Env): { options: Options; go: typeof fetch } => {
  let tracker = env.TRACKER
  if (!tracker || !env.TRACKER_SECRET) {
    throw Error('the platform tracker is not bound here')
  }
  return {
    options: {
      remote: { url: 'https://tracker.internal', secret: env.TRACKER_SECRET },
    },
    go: (input, init) => tracker.fetch(new Request(input, init)),
  }
}

let bugs = async (env: Env, params: Record<string, string>) => {
  let { options, go } = trackerOf(env)
  let got = await read(
    options,
    'bugs',
    new URLSearchParams(params),
    undefined,
    go,
  )
  if (!got.ok) throw Error(got.error)
  return JSON.stringify(got.value)
}

/** The platform admin's read-only tools, over the whole directory. */
export let adminTools = (env: Env, dir: Directory): Tool[] => [
  {
    name: 'admin_errors',
    title: "Read yaks.app's errors",
    step: {
      doing: "Reading yaks.app's errors…",
      done: "Read yaks.app's errors",
    },
    description:
      "Every unresolved bug in yaks.app's tracker, newest first: lifetime count, first and last seen, global bug id, who it reached, place and message. Then the time to fix of the bugs resolved in the window (a week without since), and how long the oldest has been open. bug_show reads one in full.",
    parameters: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description:
            'Only bugs last seen in this window, such as 10m, 6h or 7d; every unresolved bug by default.',
        },
        resolved: {
          type: 'boolean',
          description:
            "Also list each bug resolved in the window with its resolver's explanation.",
        },
      },
    },
    readOnly: true,
    run: async (args) => {
      let { options, go } = trackerOf(env)
      return (await errors(text(args.since) || undefined, options, {
        fetch: go,
        resolved: args.resolved === true,
      })).join('\n')
    },
  },
  {
    name: 'bug_list',
    title: "List yaks.app's bugs",
    step: { doing: "Listing yaks.app's bugs…", done: "Listed yaks.app's bugs" },
    description:
      "List bugs in yaks.app's tracker, open by default, as rows. A query narrows them, such as .bug.status=open .order=-bug.hits.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A tracker query.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    readOnly: true,
    run: (args) =>
      bugs(env, {
        query: text(args.query) || '.bug.status=open',
        limit: String(args.limit ?? 50),
      }),
  },
  {
    name: 'bug_show',
    title: 'Show a yaks.app bug',
    step: { doing: 'Reading a bug…', done: 'Read a bug' },
    description:
      "Read a bug in yaks.app's tracker, its marks and its newest retained occurrences in full, with the requests they ran during. Answers rows, occurrences (how many it retains) and, where older ones remain, next: pass it as after to read the next page.",
    parameters: {
      type: 'object',
      properties: {
        bug: {
          type: 'string',
          description:
            'The bug’s global eid, or the hex it starts with (4fde03f7).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'How many occurrences, newest first; 5 by default.',
        },
        after: {
          type: 'string',
          description: 'The next a previous answer named.',
        },
      },
      required: ['bug'],
    },
    readOnly: true,
    run: (args) =>
      bugs(env, {
        bug: text(args.bug),
        limit: String(args.limit ?? 5),
        ...text(args.after) ? { after: text(args.after) } : {},
      }),
  },
  {
    name: 'admin_budget',
    title: "Read a space's budget",
    step: { doing: "Reading a space's budget…", done: "Read a space's budget" },
    description:
      "Any space's monthly dollar budget for models and voice: the limit it answers to and whether its plan or the platform set it, what it spent this month, and what was left of its starter as the month began.",
    parameters: {
      type: 'object',
      properties: {
        space: { type: 'string', description: 'The space, by its subdomain.' },
      },
      required: ['space'],
    },
    readOnly: true,
    run: async (args) => {
      let slug = text(args.space)
      let space = slug ? await dir.space(slug) : null
      if (!space) throw refuse('missing', `no space is called "${slug}"`)
      return budgetLines(standing(space)).join('\n')
    },
  },
  {
    name: 'admin_fee',
    title: "Read yaks.app's fee",
    step: { doing: "Reading yaks.app's fee…", done: "Read yaks.app's fee" },
    description:
      'What yaks.app takes from each sale, in basis points and as a rate.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
    run: async () => {
      let meta = await dir.space(META.space)
      if (!meta) throw refuse('missing', 'the directory has not seeded yet')
      return `${meta.fee} bps — ${rate(meta.fee)} of each sale`
    },
  },
]
