#!/usr/bin/env -S deno run --allow-read --allow-env
// The ratchet on what an app deploy costs a person: the box records
// (bin/app-deploy-time.ts → bench/app-deploys.jsonl), Actions reads the
// committed rows. Three numbers may only fall — a small app's files answering
// live, the deploy mark, and a one-file update answering live — each against
// its own floor with the 25% band bench-gate and deploy-gate use. Rows from
// different hosts (production, staging) are never compared with each other.
export type Stat = { median: number; p95: number; n: number }
export type Row = {
  at: string
  host: string
  version: string | null
  runs: number
  files3: { call: Stat; live: Stat }
  deploy: { call: Stat }
  single: { call: Stat; live: Stat }
  // Where the call's time went, from `Server-Timing` on the answers (median
  // ms per stage) — what to read when a number above moved.
  timing?: Record<string, Record<string, number>>
}

export let RECORD = new URL('../bench/app-deploys.jsonl', import.meta.url)

// The three gated numbers, by name: what a person WAITS for.
export let GATED = {
  'files → live': (r: Row) => r.files3.live.median,
  'deploy': (r: Row) => r.deploy.call.median,
  'one file → live': (r: Row) => r.single.live.median,
}

let stat = (s: unknown): s is Stat =>
  !!s && typeof s == 'object' &&
  ['median', 'p95', 'n'].every((k) => {
    let v = (s as Record<string, unknown>)[k]
    return typeof v == 'number' && Number.isFinite(v) && v >= 0
  })

export let records = (text: string): Row[] =>
  text.split('\n').flatMap((line, i) => {
    if (!line.trim()) return []
    try {
      let r = JSON.parse(line)
      if (
        !r || typeof r.at != 'string' || !Number.isFinite(Date.parse(r.at)) ||
        typeof r.host != 'string' || !r.host ||
        (r.version !== null && typeof r.version != 'string') ||
        !Number.isInteger(r.runs) || r.runs < 1 ||
        !stat(r.files3?.call) || !stat(r.files3?.live) ||
        !stat(r.deploy?.call) ||
        !stat(r.single?.call) || !stat(r.single?.live)
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

export let gate = (rows: Row[], margin = 0.25) => {
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error('BENCH_TOL must be a finite nonnegative number')
  }
  let sorted = [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  let latest = sorted.at(-1)
  if (!latest) {
    return { code: 0, message: 'no app deploy data — pass (bootstrap)' }
  }
  let mine = sorted.filter((r) => r.host == latest.host)
  let prior = mine.slice(0, -1)
  let lines: string[] = []
  let failed = false
  for (let [name, of] of Object.entries(GATED)) {
    let now = of(latest)
    let floor = prior.length ? Math.min(...prior.map(of)) : null
    if (floor == null) {
      lines.push(`${name}: ${now} ms — first measurement, pass (bootstrap)`)
      continue
    }
    let limit = Math.round(floor * (1 + margin))
    let worse = now > limit
    failed ||= worse
    lines.push(
      `${name}: ${now} ms; floor ${floor} ms, limit ${limit} ms — ${
        worse ? 'REGRESSION' : 'pass'
      }`,
    )
  }
  return {
    code: failed ? 1 : 0,
    message: `${latest.host} @ ${latest.at}\n  ${lines.join('\n  ')}`,
  }
}

export let main = async (args = Deno.args) => {
  if (args.length > 1) {
    throw new Error('usage: app-deploy-gate.ts [record.jsonl]')
  }
  let result = gate(
    await readRecords(args[0] ?? RECORD),
    +(Deno.env.get('BENCH_TOL') ?? '0.25'),
  )
  console.log(`app-deploy-gate: ${result.message}`)
  return result.code
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (e) {
    console.error(`app-deploy-gate: ${e instanceof Error ? e.message : e}`)
    Deno.exit(1)
  }
}
