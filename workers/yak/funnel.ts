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
import { FUNNEL, stepOf, type Visited } from './view-point.ts'
import {
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

/**
 * Count one step. Fire-and-forget, as a view is (views.ts `viewed`): nothing
 * waits on it, and a throw is one report rather than a broken door.
 */
export let step = (env: Pick<Env, 'VIEWS'>, name: Step, req?: Request) => {
  if (!env.VIEWS) return
  try {
    env.VIEWS.writeDataPoint(stepOf(name, req as Visited | undefined))
  } catch (e) {
    caught(e, { request: 'funnel write' })
  }
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

/** One step's count over the window, and its share of the step it follows. */
export type Count = { name: Step; say: string; n: number; share?: number }

export type Funnel = {
  days: number
  steps: Count[]
  from: { site: string; n: number }[]
}

/** The funnel over the last `days`, from the counts as the SQL API answers
 * them: a step nobody took is a zero, not a gap. */
export let shaped = (
  days: number,
  rows: Record<string, unknown>[],
  from: Record<string, unknown>[] = [],
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
  }
}

/** The funnel over the last `days`, or null where analytics are not
 * switched on (views.ts `statsFor`). */
export let funnel = async (env: Env, days = 7): Promise<Funnel | null> => {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT) return null
  let window = whole(days, KEPT_DAYS)
  let dataset = env.VIEWS_DATASET ?? DATASET
  let [rows, from] = await Promise.all([
    ran(env, counts(window, dataset)),
    ran(env, sources(window, dataset)),
  ])
  return shaped(window, rows, from)
}
