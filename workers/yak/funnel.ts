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
import type { Host } from '@yaks/platform/host'
import { fromOurs } from './page-report.ts'
import { isPerson } from './crawlers.ts'
import { CHECK, isFleetAddress } from '@yaks/platform/bots'
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
  TOP,
  VARIANT,
  whole,
} from './views.ts'
import {
  among,
  and,
  as,
  col,
  desc,
  eq,
  type Expr,
  fn,
  ge,
  lit,
  ne,
  not,
  op,
  or,
  select,
  table,
} from '@yaks/sql/core'

/** When the funnel's steps became people's: the release after 965f3dbbc, by
 * which a step written by the CLI's own fetch (e70d31490), a test account or an
 * agent's check (965f3dbbc) counted apart. From 2026-11-03 to then the fleet's
 * own sign-ups read as 11 of 13 connector sign-ins and 11 of 12 first sign-ins
 * (T-154788). A window never starts before it (`start`), so a count is never
 * of days nothing was counted on, or counted wrong. Once it is further back
 * than a step is kept, it bounds nothing and goes. */
export let BEGAN = '2026-11-07T13:23:04Z'

/** Each step, in the order a person meets them, what the admin calls it, and
 * the step it is a share of. */
export let STEPS = [
  { name: 'home', say: 'Home page visits' },
  { name: 'click', say: 'Calls to action clicked', of: 'home' },
  {
    name: 'started',
    say: "Newcomers' builds begun in the home page's box",
    of: 'home',
  },
  {
    name: 'started_signed_in',
    say: "Builds begun in the home page's box by somebody signed in",
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
  { name: 'checkout', say: 'Checkouts started', of: 'signup' },
  { name: 'paid', say: 'Plans bought', of: 'checkout' },
  { name: 'returned', say: 'People back a day or more later' },
] as const

export type Step = typeof STEPS[number]['name']
export type { Funnel }

/** A stranger's way, stage by stage, each one step, and the stage it is a
 * share of: a visit to the home page, then by either of two doors, a build
 * begun in the home page's box by a newcomer, never by somebody signed in
 * (`started_signed_in`), or a connector's sign-in begun from an
 * assistant, which no visit leads to; a first sign-in, by either door or the
 * sign-in page, so a share of neither; a space's first app, and coming back a
 * day or more later. The steps join nobody to anybody, so a stage counts the
 * times it was reached, not who reached it. */
export let STAGES = [
  { name: 'visit', say: 'Home page visits', step: 'home' },
  {
    name: 'built',
    say: "Builds begun in the home page's box",
    step: 'started',
    of: 'visit',
  },
  {
    name: 'connected',
    say: 'Connector sign-ins begun',
    step: 'connector_start',
  },
  { name: 'signup', say: 'First sign-ins', step: 'signup' },
  { name: 'first_app', say: 'First apps', step: 'first_app', of: 'signup' },
  {
    name: 'back',
    say: 'Back a day or more later',
    step: 'returned',
    of: 'first_app',
  },
] as const satisfies readonly {
  name: string
  say: string
  step: Step
  of?: string
}[]

/** Each call to action on the home page, by the name its `data-cta` gives it
 * (site/home.tsx), and what the admin calls it. The Operator's page
 * (site/operator.tsx) names its hero's and closing card's alike. */
export let CTAS = [
  { name: 'start', say: 'Start free, the code or Build it, in the hero' },
  { name: 'examples', say: 'See examples' },
  { name: 'walk', say: "Start free, beside a demo's walkthrough" },
  { name: 'walk-ask', say: "Ask for your own change to a demo's step" },
  { name: 'plus', say: "The Plus plan's Get Started" },
  { name: 'pro', say: "The Pro plan's Get Started" },
  { name: 'join', say: 'Start, in the closing card' },
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
 * through a browser, or for the admin or the demo's holder, is counted apart
 * from a person's. One taken away from a
 * request counts under the `campaign` its taker came by, and apart when its
 * taker is nobody's (`test`, directory.ts `stepper`), so an agent's check's
 * newcomer building is counted apart too.
 */
export let step = (
  env: Pick<Env, 'VIEWS'>,
  name: Step,
  req?: Request,
  { button, who, campaign, test }: {
    button?: string
    who?: Who
    campaign?: string
    test?: boolean
  } = {},
) => {
  if (!env.VIEWS || (req && !isPerson(req))) return
  try {
    env.VIEWS.writeDataPoint(
      stepOf(name, req as Visited | undefined, {
        button,
        test: test || tested(who),
        came: campaign,
      }),
    )
  } catch (e) {
    caught(e, { request: 'funnel write' })
  }
}

// Whether a step is the fleet's: it is for somebody, and every address it is
// for is one the fleet holds (@yaks/platform/bots `isFleetAddress`).
let tested = (who: Who = []) => {
  let all = [who].flat()
  return all.length > 0 && all.every((a) => a != null && isFleetAddress(a))
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
 * assertEquals(at(30), '2026-11-07T13:23:04.000Z')
 * assertEquals(at(new Date('2026-10-11T00:00:00Z')), '2026-11-07T13:23:04.000Z')
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

let second = (at: Date) =>
  fn('toDateTime', lit(Math.floor(at.getTime() / 1000)))

// Whether a point is the `step` written at the second `at`.
let written = (step: string, at: string) =>
  and(eq(col(SLUG), lit(step)), eq(col('timestamp'), second(new Date(at))))

/** Steps written as a browser's that were an agent's check, each its step
 * and the second it was written at: T-154822's check of the box on /churches,
 * on 2026-11-10, whose visits did not name it (T-1824). A point is never
 * rewritten, so these are read as a test's (`WHO`). Once they are further
 * back than a step is kept, they go. */
export let MISCOUNTED = [
  ['started', '2026-11-10T20:47:37Z'],
  ['started', '2026-11-10T20:55:10Z'],
  ['started', '2026-11-10T20:58:23Z'],
  ['started', '2026-11-10T20:59:36Z'],
] as const

/** Builds begun in the box by somebody signed in, written as `started`
 * before the step said who began it (T-1826), each the second it was written
 * at: U-334's two of 2026-11-20. A point is never rewritten, so these are read
 * as `started_signed_in` (`STEP`). Once they are further back than a step is
 * kept, they go. */
export let SIGNED_IN = ['2026-11-20T04:54:52Z', '2026-11-20T05:18:00Z'] as const

// Which step a point is: the step it was written as, or `started_signed_in`
// for one in SIGNED_IN.
let STEP = fn(
  'if',
  or(...SIGNED_IN.map((at) => written('started', at))),
  lit('started_signed_in'),
  col(SLUG),
)

// Who took a step: the client it was written with, or `test` for one whose
// arrival names an agent's check as its source (@yaks/platform/bots `CHECK`),
// though a browser, or a script saying it is one, took it, and for one in
// MISCOUNTED. A person's step is one a browser took, or one taken away from
// any request; a crawler's, an agent's or a test account's is counted apart
// (`apart`).
let WHO = fn(
  'if',
  or(
    op('like', col(CAMPAIGN), lit(`${CHECK}/%`)),
    ...MISCOUNTED.map(([step, at]) => written(step, at)),
  ),
  lit('test'),
  col(CLIENT),
)
let PEOPLE = among(WHO, [lit('browser'), lit('')])

let N = as(COUNT, 'n')
let busiest = [desc(col('n'))]
let said = (blob: string) => ne(col(blob), lit(''))

let over = (
  since: Date,
  dataset: string,
  who = PEOPLE,
  ...more: Expr[]
) => ({
  from: table(dataset),
  where: and(
    eq(col('index1'), lit(FUNNEL)),
    who,
    ge(col('timestamp'), second(since)),
    ...more,
  ),
})

// People's steps from `since` that are `step` and say something in `blob`.
let stepped = (since: Date, dataset: string, step: string, blob: string) =>
  over(since, dataset, PEOPLE, eq(STEP, lit(step)), said(blob))

/** How many times people took each step from `since`. */
export let counts = (since: Date, dataset = DATASET) =>
  select({
    cols: [as(STEP, 'step'), N],
    ...over(since, dataset),
    group: [col('step')],
  })

/** How many times each step was taken by somebody other than a person: a
 * crawler, an agent's script or a test account, by which. */
export let apart = (since: Date, dataset = DATASET) =>
  select({
    cols: [as(WHO, 'client'), as(STEP, 'step'), N],
    ...over(since, dataset, not(PEOPLE)),
    group: [col('client'), col('step')],
    order: busiest,
  })

/** The sites that sent people to the home page, busiest first. */
export let sources = (since: Date, dataset = DATASET) =>
  select({
    cols: [as(col(FROM), 'site'), N],
    ...stepped(since, dataset, 'home', FROM),
    group: [col('site')],
    order: busiest,
    limit: lit(TOP),
  })

// The home page's visits, clicks, builds begun, sign-ups and checkouts by what
// a step says in `blob`, busiest first.
let by = (blob: string) => (since: Date, dataset = DATASET) =>
  select({
    cols: [as(col(blob), 'key'), as(STEP, 'step'), N],
    ...over(since, dataset, PEOPLE, among(STEP, PER.map(lit)), said(blob)),
    group: [col('key'), col('step')],
    order: busiest,
    limit: lit(TOP * PER.length),
  })

/** The campaigns that brought people to the home page, and how many of them
 * clicked a call to action, began a build, signed up and started a checkout
 * (arrival.ts `campaign`). */
export let campaigns = by(CAMPAIGN)

/** The home pages visitors were shown, and the steps taken on them
 * (variant.ts). */
export let variants = by(VARIANT)

/** How many times each call to action was clicked, busiest first. */
export let buttons = (since: Date, dataset = DATASET) =>
  select({
    cols: [as(col(BUTTON), 'button'), N],
    ...stepped(since, dataset, 'click', BUTTON),
    group: [col('button')],
    order: busiest,
  })

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
 * step nobody took is a zero, not a gap, and a share of one is no share. */
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
  let count = <T extends { name: string; say: string; of?: string }>(
    all: readonly T[],
    step: (s: T) => string,
  ) =>
    all.map((s) => {
      let of = s.of && all.find((o) => o.name == s.of)
      return {
        name: s.name,
        say: s.say,
        n: n(step(s)),
        ...of && n(step(of))
          ? { share: n(step(s)) / n(step(of)), of: s.of }
          : {},
      }
    })
  return {
    since: since.toISOString(),
    stages: count<typeof STAGES[number]>(STAGES, (s) => s.step),
    steps: count<typeof STEPS[number]>(STEPS, (s) => s.name),
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
