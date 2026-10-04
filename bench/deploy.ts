/** Verified push-to-live measurements, imported without retiming the deploy. */
import {
  type CollectedSuite,
  host,
  type Options,
  run as benchmark,
} from '@yaks/benchmark'

export type Deploy = {
  sha: string
  pushed: string
  uploaded: string
  live: string | null
  seconds: number | null
  version?: string
  pushSource?: string
  estimated?: boolean
  backfill?: boolean
  probe?: string
}

export let RECORD = new URL('./deploys.jsonl', import.meta.url)
let stamp = (s: unknown): s is string =>
  typeof s == 'string' && Number.isFinite(Date.parse(s))

export let records = (text: string): Deploy[] =>
  text.split('\n').flatMap((line, i) => {
    if (!line.trim()) return []
    try {
      let r = JSON.parse(line)
      if (
        !r || typeof r.sha != 'string' || !/^[a-f\d]{40}$/i.test(r.sha) ||
        !stamp(r.pushed) ||
        !stamp(r.uploaded) || Date.parse(r.uploaded) < Date.parse(r.pushed) ||
        (r.estimated !== undefined && typeof r.estimated != 'boolean') ||
        (r.backfill !== undefined && typeof r.backfill != 'boolean') ||
        (r.live === null
          ? r.seconds !== null
          : !stamp(r.live) || Date.parse(r.live) < Date.parse(r.uploaded) ||
            typeof r.seconds != 'number' || !Number.isFinite(r.seconds) ||
            r.seconds < 0 ||
            Math.abs(
                r.seconds -
                  (Date.parse(r.live) - Date.parse(r.pushed)) / 1000,
              ) > 0.001)
      ) throw new Error('invalid deploy record')
      return [r as Deploy]
    } catch {
      throw new Error(`deploys.jsonl:${i + 1}: invalid deploy record`)
    }
  })

// A deploy is two halves with different owners. `upload` is Cloudflare's —
// build queue, clone, cache restore, bundle, version create — and `propagate`
// is that version to the first verified 200. Which half moved is the whole
// question when a number grows, so every line that prints a total prints the
// split beside it.
//
// Derived, never stored: the row keeps its three stamps and the arithmetic
// runs on them, so a row written before this existed reads the same way as one
// written after. Splitting Cloudflare's queue back out of `upload` would need
// the Workers Builds API, which refuses every credential on this box — it
// takes a user-scoped API token (bench/deploys.md).
export let stages = (r: Deploy) => ({
  upload: (Date.parse(r.uploaded) - Date.parse(r.pushed)) / 1000,
  propagate: r.live == null
    ? null
    : (Date.parse(r.live) - Date.parse(r.uploaded)) / 1000,
})

export let split = (r: Deploy) => {
  let { upload, propagate } = stages(r)
  return `upload ${upload.toFixed(3)}s` +
    (propagate == null ? '' : ` + propagate ${propagate.toFixed(3)}s`)
}

export let readRecords = async (path: string | URL = RECORD) => {
  try {
    return records(await Deno.readTextFile(path))
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return []
    throw e
  }
}

// A completed observation replaces the failed one for the same deploy. A
// historical backfill cannot reconstruct the first live response.
export let latest = (rows: Deploy[]) =>
  [
    ...new Map(
      rows.filter((r) => !r.backfill)
        .map((r) => [`${r.sha}/${r.uploaded}`, r]),
    ).values(),
  ].sort((a, b) => Date.parse(a.uploaded) - Date.parse(b.uploaded)).at(-1)

export let overBudget = (seconds: number) => seconds >= 60

export let suite = (rows: Deploy[]): CollectedSuite | null => {
  let row = latest(rows)
  if (!row) return null
  if (row.seconds == null) {
    throw new Error(
      `${row.sha.slice(0, 8)}: no verified live response (${split(row)})`,
    )
  }
  return {
    name: 'deploy',
    metric: 'latest-verified-live',
    workload: 1,
    benches: [
      { name: 'push → live', unit: 's' },
      { name: '60s budget exceeded', unit: 'violations' },
    ],
    collect: () => ({
      'push → live': {
        value: row.seconds!,
        source: 'verified-live',
        details: row,
      },
      // The old gate also enforces a strict 60s budget. Encoding its violation
      // as a sample keeps the shared ratchet as the only verdict mechanism.
      '60s budget exceeded': {
        value: overBudget(row.seconds!) ? 1 : 0,
        source: '60s-budget',
      },
    }),
  }
}

export let run = async (options: Options, rows?: Deploy[]) => {
  let measured = rows ?? await readRecords()
  let work = suite(measured)
  if (
    options.mode == 'accept' && work && overBudget(latest(measured)!.seconds!)
  ) {
    throw new Error('Cannot accept a deploy exceeding the strict 60s budget')
  }
  if (!work) {
    console.log('deploy: no live timing data — pass (bootstrap)')
    return null
  }
  let context = options.host ?? host
  return await benchmark(work, {
    ...options,
    rounds: 1,
    host: async () => ({
      ...await context(),
      runtime: 'Cloudflare Workers',
      cpu: 'Cloudflare',
    }),
  })
}
