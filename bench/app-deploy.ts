/** App deploy observations keep their host and Server-Timing provenance. */
import {
  type CollectedSuite,
  host,
  type Options,
  run as benchmark,
} from '@yaks/benchmark'

export type Stat = { median: number; p95: number; n: number }
// One change a person makes: `write` and `deploy` are the two calls (app_files
// stages, app_deploy puts it live) and `live` is from the first call until the
// new bytes answer at the app's address.
export type Ship = { write: Stat; deploy: Stat; live: Stat }
export type Row = {
  at: string
  host: string
  version: string | null
  runs: number
  ship: Ship
  edit: Ship
  // Where the call's time went, from `Server-Timing` on the answers (median
  // ms per stage) — what to read when a number above moved.
  timing?: Record<string, Record<string, number>>
}

// By hand, rows go to the tracked file; the monitor points
// APP_DEPLOY_RECORD at its own state, outside the repo.
export let RECORD: string | URL = Deno.env.get('APP_DEPLOY_RECORD') ??
  new URL('./app-deploys.jsonl', import.meta.url)

// The three gated numbers, by name: what a person waits for. A name's meaning
// never changes: rows before writes were staged until app_deploy measured
// `files → live`, `deploy` and `one file → live`, and those rows stay in the
// record, unread (`records`).
export let GATED = {
  'ship → live': (r: Row) => r.ship.live.median,
  'ship deploy': (r: Row) => r.ship.deploy.median,
  'edit → live': (r: Row) => r.edit.live.median,
}

let stat = (s: unknown): s is Stat =>
  !!s && typeof s == 'object' &&
  ['median', 'p95', 'n'].every((k) => {
    let v = (s as Record<string, unknown>)[k]
    return typeof v == 'number' && Number.isFinite(v) && v >= 0
  })

// Rows from before writes were staged (`files3`) are history of another
// measurement: kept in the file, never compared with these.
export let records = (text: string): Row[] =>
  text.split('\n').flatMap((line, i) => {
    if (!line.trim()) return []
    try {
      let r = JSON.parse(line)
      if (r?.files3) return []
      if (
        !r || typeof r.at != 'string' || !Number.isFinite(Date.parse(r.at)) ||
        typeof r.host != 'string' || !r.host ||
        (r.version !== null && typeof r.version != 'string') ||
        !Number.isInteger(r.runs) || r.runs < 1 ||
        !['ship', 'edit'].every((k) =>
          ['write', 'deploy', 'live'].every((p) => stat(r[k]?.[p]))
        )
      ) throw new Error('invalid app deploy record')
      return [r as Row]
    } catch {
      throw new Error(`app-deploys.jsonl:${i + 1}: invalid app deploy record`)
    }
  })

export let readRecords = async (path: string | URL = RECORD) => {
  try {
    return records(await Deno.readTextFile(path))
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return []
    throw e
  }
}

export let latest = (rows: Row[]) =>
  [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1)

export let suite = (rows: Row[]): CollectedSuite | null => {
  if (!rows.length) return null
  let current = [latest(rows)!]
  return {
    name: 'app-deploy',
    metric: 'latest-host-medians',
    workload: 1,
    benches: current.flatMap((row) =>
      Object.keys(GATED).map((name) => ({
        name: `${row.host}/${name}`,
        unit: 'ms',
        resolution: 1,
      }))
    ),
    collect: () =>
      Object.fromEntries(
        current.flatMap((row) =>
          Object.entries(GATED).map(([name, of]) => [
            `${row.host}/${name}`,
            { value: of(row), source: 'app-deploy-median', details: row },
          ])
        ),
      ),
  }
}

export let run = async (options: Options, rows?: Row[]) => {
  let work = suite(rows ?? await readRecords())
  if (!work) {
    console.log('app-deploy: no app deploy data — pass (bootstrap)')
    return null
  }
  let context = options.host ?? host
  return await benchmark(work, {
    ...options,
    coverage: 'subset',
    rounds: 1,
    host: async () => ({
      ...await context(),
      runtime: 'Cloudflare Workers',
      cpu: 'Cloudflare',
    }),
  })
}
