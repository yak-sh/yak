#!/usr/bin/env -S deno run -A
// Run on the credentialed box as soon as a push starts its build:
//   deno task deploy:time [sha]
// Historical uploads: deno task deploy:time --backfill 3
// No credentials or live API calls belong in deploy-gate / Actions.
import { type Deploy, readRecords, RECORD, records } from './deploy-gate.ts'
import { WRANGLER } from '../workers/yak/wrangler.ts'
import type { Version } from '../src/yak_deploys.ts'

type Event = {
  type: string
  created_at: string
  payload: { ref?: string; head?: string; pushed_at?: string }
}
type Suite = { head_sha: string; head_branch: string; created_at: string }
type Run = {
  head_sha: string
  created_at: string
  event: string
  head_branch: string
}
type Push = { pushed: string; pushSource: string }

export let pushTime = (
  sha: string,
  events: Event[],
  suites: Suite[],
  runs: Run[],
): Push | null => {
  let event =
    events.filter((e) =>
      e.type == 'PushEvent' && e.payload.ref == 'refs/heads/main' &&
      e.payload.head == sha
    ).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]
  if (event) {
    return {
      pushed: event.payload.pushed_at ?? event.created_at,
      pushSource: 'github:PushEvent',
    }
  }
  let suite = suites.filter((s) => s.head_sha == sha && s.head_branch == 'main')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]
  if (suite) {
    return { pushed: suite.created_at, pushSource: 'github:check-suite' }
  }
  let run =
    runs.filter((r) =>
      r.head_sha == sha && r.event == 'push' && r.head_branch == 'main'
    ).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]
  return run
    ? { pushed: run.created_at, pushSource: 'github:gate.created_at' }
    : null
}

export let versionFor = (sha: string, pushed: string, versions: Version[]) => {
  let later = versions.filter((v) =>
    Date.parse(v.metadata.created_on) >= Date.parse(pushed)
  )
    .sort((a, b) =>
      Date.parse(a.metadata.created_on) - Date.parse(b.metadata.created_on)
    )
  let named = later.find((v) => {
    let name = v.annotations?.['workers/message']?.match(
      /^([a-f\d]{7,40})(?:\s|$)/i,
    )?.[1]
    return name && sha.startsWith(name)
  })
  if (named) return { version: named, estimated: false }
  // A version naming another commit is evidence against a time-based match.
  let nearest = later.find((v) => !v.annotations?.['workers/message'])
  return nearest ? { version: nearest, estimated: true } : null
}

// Cloudflare silently ignores an override for a version outside the active
// deployment. A 200 alone can therefore be the OLD code, even during rollout.
export let probe = async (version: string, get = fetch) => {
  try {
    let res = await get('https://yaks.app/', {
      headers: {
        'Cloudflare-Workers-Version-Overrides': `yak="${version}"`,
        'cache-control': 'no-cache',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    })
    await res.arrayBuffer()
    if (res.status != 200) return `HTTP ${res.status}, want 200`
    let served = res.headers.get('x-yak-version')
    return served == version
      ? null
      : `version ${served ?? '(missing)'}, want ${version}`
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

let root = new URL('../', import.meta.url)
let command = async (cmd: string, args: string[], cwd = root) => {
  let out = await new Deno.Command(cmd, {
    args,
    cwd,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!out.success) {
    throw new Error(
      `${cmd} exited ${out.code}: ${
        new TextDecoder().decode(out.stderr).trim()
      }`,
    )
  }
  return JSON.parse(new TextDecoder().decode(out.stdout))
}
let api = (path: string) => command('gh', ['api', `repos/yak-sh/yak/${path}`])
let versions = (): Promise<Version[]> =>
  command(
    WRANGLER[0],
    [...WRANGLER.slice(1), 'versions', 'list', '--json'],
    new URL('../workers/yak/', import.meta.url),
  )
let pause = () => new Promise((ok) => setTimeout(ok, 1000))

let writing = Promise.resolve()
export let append = (row: Deploy, path: string | URL = RECORD) => {
  // POSIX locks serialize processes; the queue also serializes callers in
  // this process, whose file locks may share an owner.
  let written = writing.then(() => writeRecord(row, path))
  writing = written.then(() => {}, () => {})
  return written
}

let writeRecord = async (row: Deploy, path: string | URL) => {
  // Serialize concurrent box invocations without losing an append. Lock the
  // record itself so no lock artifact or second baseline needs committing.
  using file = await Deno.open(path, {
    read: true,
    write: true,
    create: true,
    append: true,
  })
  await file.lock()
  // Read through the locked handle: on POSIX, closing another descriptor
  // for this same file can release this process's lock before the append.
  let bytes = new Uint8Array((await file.stat()).size)
  for (let offset = 0; offset < bytes.length;) {
    let n = await file.read(bytes.subarray(offset))
    if (n == null) throw new Error('deploy record ended during locked read')
    offset += n
  }
  let old = records(new TextDecoder().decode(bytes))
  let prior = old.filter((r) => r.sha == row.sha && r.uploaded == row.uploaded)
    .at(-1)
  // Keep the first verified observation, but permit a failed probe or a
  // historical backfill to be completed by the live recorder.
  if (
    prior &&
    (row.backfill ||
      (!prior.backfill && (prior.live != null || row.live == null)))
  ) {
    return false
  }
  let line = JSON.stringify(row) + '\n'
  records(line)
  bytes = new TextEncoder().encode(line)
  for (let offset = 0; offset < bytes.length;) {
    offset += await file.write(bytes.subarray(offset))
  }
  await file.sync()
  return true
}

export let main = async (args = Deno.args) => {
  let backfill = args[0] == '--backfill'
  let count = backfill ? +(args[1] ?? '3') : 1
  if (
    backfill
      ? args.length > 2 || !Number.isInteger(count) || count < 1 || count > 10
      : args.length > 1 || (args[0] && !/^[a-f\d]{40}$/i.test(args[0]))
  ) {
    throw new Error('usage: deploy:time [full-sha] | --backfill [1..10]')
  }
  let [events, workflow, available] = await Promise.all([
    api('events?per_page=100').catch(() => []),
    api('actions/workflows/gate.yml/runs?event=push&branch=main&per_page=100'),
    versions(),
  ])
  let runs = workflow.workflow_runs as Run[]
  let shas = args[0] && !backfill
    ? [args[0].toLowerCase()]
    : [...new Set(runs.map((r) => r.head_sha))]
  if (!shas.length) {
    throw new Error('no main push found in gate workflow history')
  }
  let pending: {
    sha: string
    push: Push
    match: NonNullable<ReturnType<typeof versionFor>>
  }[] = []
  let used = new Set<string>()
  for (let sha of shas) {
    let suites = await api(`commits/${sha}/check-suites`).catch(() => ({
      check_suites: [],
    }))
    let push = pushTime(sha, events, suites.check_suites, runs)
    if (!push) {
      throw new Error(
        `no GitHub push time for ${sha}; commit dates are not push times`,
      )
    }
    let match = versionFor(sha, push.pushed, available)
    if (!backfill) {
      let due = Date.now() + 120_000
      while (!match && Date.now() < due) {
        await pause()
        match = versionFor(sha, push.pushed, await versions())
      }
      if (!match) throw new Error(`no uploaded version for ${sha} after 120s`)
    }
    if (match && !used.has(match.version.id)) {
      pending.push({ sha, push, match })
      used.add(match.version.id)
    }
    if (pending.length == count) break
  }
  if (!pending.length) throw new Error('no uploads match recent pushes')
  let code = 0
  let old = await readRecords()
  for (let { sha, push, match } of pending.reverse()) {
    let uploaded = match.version.metadata.created_on
    let recorded = old.find((r) =>
      r.sha == sha && r.uploaded == uploaded && !r.backfill && r.live != null
    )
    if (recorded) {
      console.log(
        `${sha.slice(0, 8)}: live ${
          recorded.seconds!.toFixed(3)
        }s — already recorded`,
      )
      continue
    }
    let problem = await probe(match.version.id)
    let due = Date.now() + 120_000
    while (!backfill && problem && Date.now() < due) {
      await pause()
      problem = await probe(match.version.id)
    }
    let live = problem ? null : new Date().toISOString()
    let row: Deploy = {
      sha,
      ...push,
      uploaded,
      live,
      seconds: live
        ? (Date.parse(live) - Date.parse(push.pushed)) / 1000
        : null,
      version: match.version.id,
      estimated: match.estimated,
      ...(backfill ? { backfill: true } : {}),
      ...(problem ? { probe: problem } : {}),
    }
    let added = await append(row)
    console.log(
      `${sha.slice(0, 8)}: upload ${
        ((Date.parse(uploaded) - Date.parse(push.pushed)) / 1000).toFixed(3)
      }s${match.estimated ? ' (estimated SHA match)' : ''}; ${
        live
          ? `live ${row.seconds!.toFixed(3)}s${
            backfill ? ' (historical upper bound, excluded from ratchet)' : ''
          }`
          : `live unverified: ${problem}`
      } — ${added ? 'recorded' : 'already recorded'}`,
    )
    if (!backfill && problem) code = 1
  }
  return code
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (e) {
    console.error(`deploy-time: ${e instanceof Error ? e.message : e}`)
    Deno.exit(1)
  }
}
