// yaks.app's own funnel (D-123514, T-135225): each step a stranger takes from
// the home page to coming back, counted where it happens and read back as a
// count a step. It rides on the Visits dataset (views.ts): a step is a data
// point under the index FUNNEL, which no app's eid can be, with the step where
// a view keeps its app's slug. So it keeps what a view keeps (where the
// request came from, its country, browser or bot) and no more: no person, no
// cookie, no IP, and nothing that joins a step to whoever took it. Three
// months, as for a view.
import type { Env } from './env.ts'
import { caught } from './defects.ts'
import type { Host } from './host.ts'
import { fromOurs } from './page-report.ts'
import { classed, FUNNEL, stepOf, type Visited } from './view-point.ts'
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
  whole,
} from './views.ts'

/** Each step, in the order a person meets them, what the admin calls it, and
 * the step it is a share of. */
export let STEPS = [
  { name: 'home', say: 'Home page visits' },
  { name: 'click', say: 'Calls to action clicked', of: 'home' },
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
  { name: 'returned', say: 'People back a day or more later' },
] as const

export type Step = typeof STEPS[number]['name']

/** Each call to action on the home page, by the name its `data-cta` gives it
 * (site/home.tsx), and what the admin calls it. */
export let CTAS = [
  { name: 'start', say: 'Start free, in the hero' },
  { name: 'examples', say: 'See examples' },
  { name: 'plus', say: "The Plus plan's Get Started" },
  { name: 'organization', say: "The Organization plan's Get Started" },
  { name: 'join', say: 'Start free, in the closing card' },
] as const

/**
 * Count one step. Fire-and-forget, as a view is (views.ts `viewed`): nothing
 * waits on it, and a throw is one report rather than a broken door.
 */
export let step = (
  env: Pick<Env, 'VIEWS'>,
  name: Step,
  req?: Request,
  button?: string,
) => {
  if (!env.VIEWS) return
  try {
    env.VIEWS.writeDataPoint(stepOf(name, req as Visited | undefined, button))
  } catch (e) {
    caught(e, { request: 'funnel write' })
  }
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
  if (
    CTAS.some((c) => c.name == name) && fromOurs(req, env) &&
    classed(req.headers.get('user-agent')) == 'browser'
  ) step(env, 'click', req, name)
  return new Response(null, { status: 204 })
}

let over = (days: number, dataset: string) =>
  `FROM ${table(dataset)} WHERE index1 = '${FUNNEL}' AND timestamp >= ` +
  `NOW() - INTERVAL '${whole(days, KEPT_DAYS)}' DAY`

/** How many times each step was taken over the window. */
export let counts = (days: number, dataset = DATASET) =>
  `SELECT ${SLUG} AS step, ${COUNT} AS n ${over(days, dataset)} GROUP BY step`

/** The sites that sent people to the home page, busiest first. */
export let sources = (days: number, dataset = DATASET) =>
  `SELECT ${FROM} AS site, ${COUNT} AS n ${over(days, dataset)} AND ` +
  `${SLUG} = 'home' AND ${FROM} != '' AND ${CLIENT} = 'browser' ` +
  `GROUP BY site ORDER BY n DESC LIMIT ${TOP}`

/** The campaigns that brought people to the home page, and how many of them
 * clicked a call to action and signed up, busiest first (arrival.ts
 * `campaign`). */
export let campaigns = (days: number, dataset = DATASET) =>
  `SELECT ${CAMPAIGN} AS campaign, ${SLUG} AS step, ${COUNT} AS n ` +
  `${over(days, dataset)} AND ${SLUG} IN ('home', 'click', 'signup') AND ` +
  `${CAMPAIGN} != '' GROUP BY campaign, step ORDER BY n DESC LIMIT ${TOP * 3}`

/** How many times each call to action was clicked, busiest first. */
export let buttons = (days: number, dataset = DATASET) =>
  `SELECT ${BUTTON} AS button, ${COUNT} AS n ${over(days, dataset)} AND ` +
  `${SLUG} = 'click' AND ${BUTTON} != '' GROUP BY button ORDER BY n DESC`

/** One step's count over the window, and its share of the step it follows. */
export type Count = { name: Step; say: string; n: number; share?: number }

export type Funnel = {
  days: number
  steps: Count[]
  from: { site: string; n: number }[]
  buttons: { button: string; say: string; n: number }[]
  campaigns: {
    campaign: string
    home: number
    click: number
    signup: number
  }[]
}

/** The funnel over the last `days`, from the counts as the SQL API answers
 * them: a step nobody took is a zero, not a gap. */
export let shaped = (
  days: number,
  rows: Record<string, unknown>[],
  from: Record<string, unknown>[] = [],
  by: Record<string, unknown>[] = [],
  pressed: Record<string, unknown>[] = [],
): Funnel => {
  let had = new Map(rows.map((r) => [String(r.step), Number(r.n) || 0]))
  let n = (name: string) => had.get(name) ?? 0
  return {
    days,
    steps: STEPS.map((s) => ({
      name: s.name,
      say: s.say,
      n: n(s.name),
      ...'of' in s && n(s.of) ? { share: n(s.name) / n(s.of) } : {},
    })),
    from: from.map((r) => ({ site: String(r.site), n: Number(r.n) || 0 })),
    buttons: pressed.flatMap((r) => {
      let cta = CTAS.find((c) => c.name == r.button)
      return cta
        ? [{ button: cta.name, say: cta.say, n: Number(r.n) || 0 }]
        : []
    }),
    campaigns: [...Map.groupBy(by, (r) => String(r.campaign))].map((
      [campaign, rows],
    ) => {
      let n = (step: string) => Number(rows.find((r) => r.step == step)?.n) || 0
      return {
        campaign,
        home: n('home'),
        click: n('click'),
        signup: n('signup'),
      }
    }),
  }
}

/** The funnel over the last `days`, or null where analytics are not
 * switched on (views.ts `statsFor`). */
export let funnel = async (env: Env, days = 7): Promise<Funnel | null> => {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT) return null
  let window = whole(days, KEPT_DAYS)
  let dataset = env.VIEWS_DATASET ?? DATASET
  let [rows, from, by, pressed] = await Promise.all([
    ran(env, counts(window, dataset)),
    ran(env, sources(window, dataset)),
    ran(env, campaigns(window, dataset)),
    ran(env, buttons(window, dataset)),
  ])
  return shaped(window, rows, from, by, pressed)
}
