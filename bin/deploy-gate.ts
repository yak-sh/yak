#!/usr/bin/env -S deno run --allow-read --allow-env
// The box records deploys; Actions only reads the committed measurements.
// Like bench-gate, the minimum ratchets down and a 25% margin absorbs noise.
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

export let RECORD = new URL('../bench/deploys.jsonl', import.meta.url)
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

export let gate = (rows: Deploy[], margin = 0.25) => {
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error('BENCH_TOL must be a finite nonnegative number')
  }
  // Backfills cannot reconstruct the first live response. Never ratchet on
  // their much later observation, or quietly substitute upload for live.
  // A later successful probe may complete a timed-out observation. Appending
  // that completion preserves history; each deploy still counts only once.
  let measured = [
    ...new Map(
      rows.filter((r) => !r.backfill).map((r) => [`${r.sha}/${r.uploaded}`, r]),
    ).values(),
  ].sort((a, b) => Date.parse(a.uploaded) - Date.parse(b.uploaded))
  let latest = measured.at(-1)
  let times = measured.flatMap((r) => r.seconds == null ? [] : [r.seconds])
  let floor = times.length ? Math.min(...times) : null
  let limit = floor == null ? 60 : Math.min(60, floor * (1 + margin))
  if (!latest) {
    return {
      code: 0,
      floor,
      limit,
      message: 'no live timing data — pass (bootstrap)',
    }
  }
  if (latest.seconds == null) {
    return {
      code: 1,
      floor,
      limit,
      message: `${latest.sha.slice(0, 8)}: no verified live response (${
        split(latest)
      })`,
    }
  }
  let detail = `${latest.sha.slice(0, 8)}: ${latest.seconds.toFixed(3)}s (${
    split(latest)
  }); floor ${floor!.toFixed(3)}s, limit ${limit.toFixed(3)}s`
  if (times.length == 1) {
    return {
      code: 0,
      floor,
      limit,
      message: `${detail} — first measurement, pass (bootstrap)`,
    }
  }
  let failed = latest.seconds >= 60 || latest.seconds > limit
  return {
    code: failed ? 1 : 0,
    floor,
    limit,
    message: `${detail} — ${failed ? 'REGRESSION' : 'pass'}`,
  }
}

export let main = async (args = Deno.args) => {
  if (args.length > 1) throw new Error('usage: deploy-gate.ts [record.jsonl]')
  let result = gate(
    await readRecords(args[0] ?? RECORD),
    +(Deno.env.get('BENCH_TOL') ?? '0.25'),
  )
  console.log(`deploy-gate: ${result.message}`)
  return result.code
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (e) {
    console.error(`deploy-gate: ${e instanceof Error ? e.message : e}`)
    Deno.exit(1)
  }
}
