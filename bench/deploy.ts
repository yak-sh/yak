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
  /** when Cloudflare's build of the commit began running (Workers Builds
   * `running_on`): what came before it was the build waiting its turn */
  started?: string
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
        (r.started !== undefined &&
          (!stamp(r.started) ||
            Date.parse(r.started) < Date.parse(r.pushed) ||
            Date.parse(r.uploaded) < Date.parse(r.started))) ||
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

// A deploy is three spans. `queue` is the build waiting for Cloudflare to
// start it, which a burst of pushes lengthens and nothing in the repo does;
// `upload` is the build itself (clone, cache restore, bundle, version create);
// `propagate` is that version to the first verified 200. Which one moved is
// the whole question when a number grows, so every line that prints a total
// prints the split beside it.
//
// Derived, never stored: the row keeps its stamps and the arithmetic runs on
// them. `started` comes from the Workers Builds API (bin/deploy-time.ts); a
// row without it counts the wait as the build's own.
let secs = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 1000

export let stages = (r: Deploy) => ({
  queue: r.started == null ? null : secs(r.pushed, r.started),
  upload: secs(r.started ?? r.pushed, r.uploaded),
  propagate: r.live == null ? null : secs(r.uploaded, r.live),
})

/** The deploy's own time: its build starting to live, the queue before it
 * left out. */
export let own = (r: Deploy) =>
  r.live == null ? null : secs(r.started ?? r.pushed, r.live)

export let split = (r: Deploy) => {
  let { queue, upload, propagate } = stages(r)
  return (queue == null ? '' : `queue ${queue.toFixed(3)}s + `) +
    `upload ${upload.toFixed(3)}s` +
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

/** The slowest a deploy may take, push to live, whatever the baseline allows:
 * 1.5 times the slowest of the 17 measured since 2026-10-10 (96.5 s), since
 * Cloudflare's build alone varies 27 to 97 s from one push to the next. */
export let CEILING = 150

export let overCeiling = (seconds: number) => seconds >= CEILING

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
      { name: 'build → live', unit: 's' },
      { name: 'deploy ceiling exceeded', unit: 'violations' },
    ],
    collect: () => ({
      'build → live': {
        value: own(row)!,
        source: 'verified-live',
        details: row,
      },
      // The ceiling's violation is a sample, so the shared ratchet stays the
      // only verdict mechanism.
      'deploy ceiling exceeded': {
        value: overCeiling(own(row)!) ? 1 : 0,
        source: 'ceiling',
      },
    }),
  }
}

export let run = async (options: Options, rows?: Deploy[]) => {
  let measured = rows ?? await readRecords()
  let work = suite(measured)
  if (
    options.mode == 'accept' && work && overCeiling(own(latest(measured)!)!)
  ) {
    throw new Error('Cannot accept a deploy exceeding the ceiling')
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
