// yaks.app's own funnel (D-123514, T-135225): each step a stranger takes from
// the home page to buying a plan and coming back, counted where it happens
// and read back as a count a step. It rides on the Visits dataset (views.ts):
// a step is a data point under the index FUNNEL, which no app's eid can be,
// with the step where a view keeps its app's slug. So it keeps what a view
// keeps (where the request came from, its country, browser or bot) and no
// more: no person, no cookie, no IP, and nothing that joins a step to whoever
// took it. Three months, as for a view.
import type { Funnel, FunnelSplit } from '@yaks/platform/funnel'
import type { Env } from './env.ts'
import { caught } from './defects.ts'
import type { Host } from './host.ts'
import { fromOurs } from './page-report.ts'
import { isPerson } from './crawlers.ts'
import { CHECK, isTestAddress } from '@yaks/platform/bots'
import { FUNNEL, stepOf, type Visited } from './view-point.ts'
import {
  BUTTON,
  CAMPAIGN,
  CLIENT,
  COUNT,
  DATASET,
  FROM,
  KEPT_DAYS,
  ran,
  SLUG,
  table,
  TOP,
  VARIANT,
  whole,
} from './views.ts'

/** When the funnel began to count (T-135225 went live). A window never starts
 * before it (`start`), so a count is never of days nothing was counted on: a
 * plan bought in October read as none bought in thirty days (T-153604). Once
 * it is further back than a step is kept, it bounds nothing and goes. */
export let BEGAN = '2026-11-03T04:47:14Z'

/** Each step, in the order a person meets them, what the admin calls it, the
 * step it is a share of, and for one added after the funnel began, when its
 * own count began (`since`). */
export let STEPS = [
  { name: 'home', say: 'Home page visits' },
  {
    name: 'click',
    say: 'Calls to action clicked',
    of: 'home',
    since: '2026-11-07T04:48:35Z',
  },
  {
    name: 'started',
    say: 'Builds started from the home page',
    of: 'home',
    since: '2026-11-07T05:08:33Z',
  },
  { name: 'code_sent', say: 'Sign-in codes sent', of: 'home' },
  { name: 'signed_in', say: 'Sign-ins finished', of: 'code_sent' },
  { name: 'signup', say: 'First sign-ins', of: 'signed_in' },
  { name: 'connector_start', say: 'Connector sign-ins started' },
  {
    name: 'connector_granted',
    say: 'Connectors granted',
    of: 'connector_start',
  },
  { name: 'install', say: 'Install pages opened' },
  { name: 'install_done', say: 'Installs finished', of: 'install' },
  { name: 'first_app', say: "Spaces' first apps", of: 'signup' },
  { name: 'first_deploy', say: "Apps' first deploys", of: 'first_app' },
  {
    name: 'checkout',
    say: 'Checkouts started',
    of: 'signup',
    since: '2026-11-07T05:00:31Z',
  },
  {
    name: 'paid',
    say: 'Plans bought',
    of: 'checkout',
    since: '2026-11-07T05:00:31Z',
  },
  { name: 'returned', say: 'People back a day or more later' },
] as const

export type Step = typeof STEPS[number]['name']
export type { Funnel }

/** A stranger's way, stage by stage, each the steps it adds up: a visit to the
 * home page, a connector's sign-in or a build begun in the home page's box, a
 * first sign-in, a space's first app, and coming back a day or more later.
 * The steps join nobody to anybody, so a stage counts the times it was
 * reached, not who reached it. */
export let STAGES = [
  { name: 'visit', say: 'Home page visits', steps: ['home'] },
  {
    name: 'began',
    say: 'Connectors or home page builds begun',
    steps: ['connector_start', 'started'],
  },
  { name: 'signup', say: 'First sign-ins', steps: ['signup'] },
  { name: 'first_app', say: 'First apps', steps: ['first_app'] },
  { name: 'back', say: 'Back a day or more later', steps: ['returned'] },
] as const satisfies readonly {
  name: string
  say: string
  steps: readonly Step[]
}[]

/** Each call to action on the home page, by the name its `data-cta` gives it
 * (site/home.tsx), and what the admin calls it. The Operator's page
 * (site/operator.tsx) names its hero's and closing card's alike. */
export let CTAS = [
  { name: 'start', say: 'Start free, the code or Build it, in the hero' },
  { name: 'examples', say: 'See examples' },
  { name: 'plus', say: "The Plus plan's Get Started" },
  { name: 'pro', say: "The Pro plan's Get Started" },
  { name: 'join', say: 'Start, in the closing card' },
  { name: 'stay', say: 'Build yours, the button that stays on screen' },
] as const

/** Whom a step is for: a person's address, or the addresses of the owners
 * of the space it is for. An address nobody knows (null) is a person's. */
export type Who = string | null | readonly (string | null)[]

/**
 * Count one step. Fire-and-forget, as a view is (views.ts `viewed`): nothing
 * waits on it, and a throw is one report rather than a broken door. A step
 * taken through a request is a person's only when a browser asked
 * (crawlers.ts `isPerson`): a crawler's, an assistant's or a script's, such
 * as an agent going through the sign-up live, counts as nothing. One for a
 * test account (`who`, @yaks/platform/bots), such as an agent signing up
 * through a browser, is counted apart from a person's.
 */
export let step = (
  env: Pick<Env, 'VIEWS'>,
  name: Step,
  req?: Request,
  { button, who }: { button?: string; who?: Who } = {},
) => {
  if (!env.VIEWS || (req && !isPerson(req))) return
  try {
    env.VIEWS.writeDataPoint(
      stepOf(name, req as Visited | undefined, { button, test: tested(who) }),
    )
  } catch (e) {
    caught(e, { request: 'funnel write' })
  }
}

// Whether a step is a test account's: it is for somebody, and every address
// it is for is a test account's.
let tested = (who: Who = []) => {
  let all = [who].flat()
  return all.length > 0 && all.every((a) => a != null && isTestAddress(a))
}

/** Where a page's script (public/cta.js) posts the call to action clicked. */
export let CLICKED = '/api/click'

/**
 * Count a click on a call to action: a browser's post, from a page of ours, of
 * a name in CTAS. Any other post is answered alike and counts nothing.
 */
export let clicked = async (
  req: Request,
  env: Pick<Env, 'VIEWS'> & Host,
): Promise<Response> => {
  if (req.method != 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }
  let name = (await req.text()).slice(0, 64)
  if (CTAS.some((c) => c.name == name) && fromOurs(req, env)) {
    step(env, 'click', req, { button: name })
  }
  return new Response(null, { status: 204 })
}

// The steps counted for each campaign and variant: those a request takes, so
// its arrival and its variant name them. A plan bought is heard from the
// payment provider and names neither, and a first app is made by an Operator
// or an assistant, away from the browser that holds them.
let PER = ['home', 'click', 'started', 'signup', 'checkout'] as const
let per = PER.map((s) => `'${s}'`).join(', ')

let DAY = 86_400_000

/**
 * Where a window starts: `days` before now, or at a moment, and never further
 * back than a step is kept or than the funnel has counted (`BEGAN`).
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let now = Date.parse('2026-11-10T00:00:00Z')
 * let at = (window: number | Date) => start(window, now).toISOString()
 * assertEquals(at(2), '2026-11-08T00:00:00.000Z')
 * assertEquals(at(30), '2026-11-03T04:47:14.000Z')
 * assertEquals(at(new Date('2026-10-11T00:00:00Z')), '2026-11-03T04:47:14.000Z')
 * assertEquals(at(new Date('2026-11-09T00:00:00Z')), '2026-11-09T00:00:00.000Z')
 * ```
 */
export let start = (window: number | Date, now = Date.now()) =>
  new Date(Math.min(
    now,
    Math.max(
      Date.parse(BEGAN),
      now - KEPT_DAYS * DAY,
      typeof window == 'number'
        ? now - whole(window, KEPT_DAYS) * DAY
        : window.getTime(),
    ),
  ))

// Who took a step: the client it was written with, or `test` for one whose
// arrival names an agent's check as its source (@yaks/platform/bots `CHECK`),
// though a browser, or a script saying it is one, took it. A person's step is
// one a browser took, or one taken away from any request; a crawler's, an
// agent's or a test account's is counted apart (`apart`).
let WHO = `if(${CAMPAIGN} LIKE '${CHECK}/%', 'test', ${CLIENT})`
let PEOPLE = `${WHO} IN ('browser', '')`

let over = (since: Date, dataset: string, who = PEOPLE) =>
  `FROM ${table(dataset)} WHERE index1 = '${FUNNEL}' AND ${who} AND ` +
  `timestamp >= toDateTime(${Math.floor(since.getTime() / 1000)})`

/** How many times people took each step from `since`. */
export let counts = (since: Date, dataset = DATASET) =>
  `SELECT ${SLUG} AS step, ${COUNT} AS n ${over(since, dataset)} GROUP BY step`

/** How many times each step was taken by somebody other than a person: a
 * crawler, an agent's script or a test account, by which. */
export let apart = (since: Date, dataset = DATASET) =>
  `SELECT ${WHO} AS client, ${SLUG} AS step, ${COUNT} AS n ` +
  `${over(since, dataset, `NOT ${PEOPLE}`)} GROUP BY client, step ` +
  `ORDER BY n DESC`

/** The sites that sent people to the home page, busiest first. */
export let sources = (since: Date, dataset = DATASET) =>
  `SELECT ${FROM} AS site, ${COUNT} AS n ${over(since, dataset)} AND ` +
  `${SLUG} = 'home' AND ${FROM} != '' ` +
  `GROUP BY site ORDER BY n DESC LIMIT ${TOP}`

// The home page's visits, clicks, builds begun, sign-ups and checkouts by what
// a step says in `column`, busiest first.
let by = (column: string) => (since: Date, dataset = DATASET) =>
  `SELECT ${column} AS key, ${SLUG} AS step, ${COUNT} AS n ` +
  `${over(since, dataset)} AND ${SLUG} IN (${per}) AND ${column} != '' ` +
  `GROUP BY key, step ORDER BY n DESC LIMIT ${TOP * PER.length}`

/** The campaigns that brought people to the home page, and how many of them
 * clicked a call to action, began a build, signed up and started a checkout
 * (arrival.ts `campaign`). */
export let campaigns = by(CAMPAIGN)

/** The home pages visitors were shown, and how many of them clicked a call to
 * action, began a build, signed up and started a checkout (variant.ts). */
export let variants = by(VARIANT)

/** How many times each call to action was clicked, busiest first. */
export let buttons = (since: Date, dataset = DATASET) =>
  `SELECT ${BUTTON} AS button, ${COUNT} AS n ${over(since, dataset)} AND ` +
  `${SLUG} = 'click' AND ${BUTTON} != '' GROUP BY button ORDER BY n DESC`

let split = (rows: Record<string, unknown>[]): FunnelSplit[] =>
  [...Map.groupBy(rows, (r) => String(r.key))].map(([name, rows]) => {
    let n = (step: string) => Number(rows.find((r) => r.step == step)?.n) || 0
    return {
      name,
      ...Object.fromEntries(PER.map((s) => [s, n(s)])) as Record<
        typeof PER[number],
        number
      >,
    }
  })

/** The funnel from `since`, from the counts as the SQL API answers them: a
 * step nobody took is a zero, not a gap. A step whose own count began inside
 * the window says when (`since`), and no share: the step it follows was
 * counted for longer. */
export let shaped = (
  since: Date,
  rows: Record<string, unknown>[],
  from: Record<string, unknown>[] = [],
  by: Record<string, unknown>[] = [],
  pressed: Record<string, unknown>[] = [],
  shown: Record<string, unknown>[] = [],
  others: Record<string, unknown>[] = [],
): Funnel => {
  let had = new Map(rows.map((r) => [String(r.step), Number(r.n) || 0]))
  let n = (name: string) => had.get(name) ?? 0
  let sums = STAGES.map((s) => s.steps.reduce((t, step) => t + n(step), 0))
  return {
    since: since.toISOString(),
    stages: STAGES.map((s, i) => ({
      name: s.name,
      say: s.say,
      n: sums[i],
      ...i && sums[i - 1]
        ? { share: sums[i] / sums[i - 1], of: STAGES[i - 1].name }
        : {},
    })),
    steps: STEPS.map((s) => {
      let late = 'since' in s && since < new Date(s.since) ? s.since : null
      return {
        name: s.name,
        say: s.say,
        n: n(s.name),
        ...late ? { since: late } : {},
        ...!late && 'of' in s && n(s.of)
          ? { share: n(s.name) / n(s.of), of: s.of }
          : {},
      }
    }),
    apart: others.map((r) => ({
      client: String(r.client),
      step: String(r.step),
      n: Number(r.n) || 0,
    })),
    from: from.map((r) => ({ site: String(r.site), n: Number(r.n) || 0 })),
    buttons: pressed.flatMap((r) => {
      let cta = CTAS.find((c) => c.name == r.button)
      return cta
        ? [{ button: cta.name, say: cta.say, n: Number(r.n) || 0 }]
        : []
    }),
    campaigns: split(by),
    variants: split(shown),
  }
}

/** The funnel over the last `days`, or from a moment to now (`start`), or
 * null where analytics are not switched on (views.ts `statsFor`). The admin's
 * page (admin.ts) and its tool (`/api/funnel`, `door`) both read this. */
export let funnel = async (
  env: Env,
  window: number | Date = 7,
): Promise<Funnel | null> => {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT) return null
  let since = start(window)
  let dataset = env.VIEWS_DATASET ?? DATASET
  let [rows, from, by, pressed, shown, others] = await Promise.all(
    [counts, sources, campaigns, buttons, variants, apart].map((q) =>
      ran(env, q(since, dataset))
    ),
  )
  return shaped(since, rows, from, by, pressed, shown, others)
}
