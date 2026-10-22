#!/usr/bin/env -S deno run -A
// Run on the credentialed box as soon as a push starts its build:
//   deno task deploy:time [sha]
// Historical uploads: deno task deploy:time --backfill 3
// The gate workflow runs this before the deploy suite checks, so every push times
// its own deploy (T-35336). `gh` reads GitHub as whoever runs it (the job's
// own GH_TOKEN in the gate) and wrangler reads versions with whatever
// Cloudflare credential it finds (the runner's read-only CLOUDFLARE_API_TOKEN
// in the gate); never an Actions secret. The suite check stays
// credential-free and makes no live call.
import {
  type Deploy,
  readRecords,
  RECORD,
  records,
  split,
} from '../bench/deploy.ts'
import { WRANGLER } from '../workers/yak/wrangler.ts'
import {
  type Deployment,
  deploymentsFor,
  rowsIn,
  type Version,
} from '../packages/admin/deploys.ts'

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

let commit = (v: Version) =>
  v.annotations?.['workers/message']?.match(
    /^([a-f\d]{7,40})(?:\s|$)/i,
  )?.[1].toLowerCase()
let names = (v: Version, sha: string) => {
  let named = commit(v)
  return named != null && sha.toLowerCase().startsWith(named)
}

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
  let named = later.find((v) => names(v, sha))
  if (named) return { version: named, estimated: false }
  // A version naming another commit is evidence against a time-based match.
  let nearest = later.find((v) => !v.annotations?.['workers/message'])
  return nearest ? { version: nearest, estimated: true } : null
}

// Cloudflare builds a push only when it touches the Worker's watch paths
// (`workers/yak/*`, `packages/*` — workers/yak/README.md), so a commit can be
// pushed and never deploy: waiting for its version would fail the gate on
// every docs-or-CI commit. Cloudflare's own check run is the signal, asked for
// only after the version wait expires, when a real build's check exists.
export let built = (runs: { name: string }[]) =>
  runs.some((r) => r.name == 'Workers Builds: yak')

// Cloudflare silently ignores an override for a version outside the active
// deployment. A 200 alone can therefore be the old code, even during rollout.
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

// The account and Worker the builds belong to, as wrangler.toml names them.
let worker = async () => {
  let toml = await Deno.readTextFile(
    new URL('../workers/yak/wrangler.toml', import.meta.url),
  )
  let key = (k: string) =>
    new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, 'm').exec(toml)?.[1]
  return { account: key('account_id'), name: key('name') }
}

// The Cloudflare API, read with the runner's CLOUDFLARE_API_TOKEN.
let cloudflare = async (path: string): Promise<unknown> => {
  let token = Deno.env.get('CLOUDFLARE_API_TOKEN')
  if (!token) throw new Error('no CLOUDFLARE_API_TOKEN')
  let { account } = await worker()
  let res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    },
  )
  let body = await res.json()
  if (!body.success) throw new Error(`${path}: HTTP ${res.status}`)
  return body.result
}

type Build = {
  running_on?: string | null
  build_trigger_metadata?: { commit_hash?: string; branch?: string }
}

/** When Cloudflare's build of `sha` began running (Workers Builds
 * `running_on`), so a row can tell the build waiting its turn from the build
 * itself. Reading it takes a token that reads Workers CI. */
export let buildStart = async (
  sha: string,
  get: (path: string) => Promise<unknown> = cloudflare,
  name = 'yak',
): Promise<string | undefined> => {
  let scripts = await get('workers/scripts') as { id: string; tag: string }[]
  let tag = scripts.find((s) => s.id == name)?.tag
  if (!tag) return
  let builds = await get(`builds/workers/${tag}/builds?per_page=25`) as Build[]
  return builds.find((b) =>
    b.build_trigger_metadata?.commit_hash == sha &&
    b.build_trigger_metadata.branch == 'main'
  )?.running_on ?? undefined
}

export let observe = async (
  version: Version,
  backfill = false,
  {
    check = probe,
    sha = commit(version),
    related = (): Promise<Version[]> => Promise.resolve([]),
    history = () =>
      command(
        WRANGLER[0],
        [...WRANGLER.slice(1), 'deployments', 'list', '--json'],
        new URL('../workers/yak/', import.meta.url),
      ),
    now = Date.now,
    wait = pause,
  } = {},
) => {
  let began = now()
  let siblings: Version[] = []
  let discovering = false
  let refreshAt = -Infinity
  let discovery = Promise.resolve()
  let failure: { error: unknown } | undefined
  let refresh = () => {
    if (!sha || !names(version, sha) || discovering || now() < refreshAt) return
    discovering = true
    discovery = (async () => {
      try {
        siblings = await related()
      } catch (error) {
        failure = { error }
      } finally {
        discovering = false
        refreshAt = now() + 10_000
      }
    })()
  }
  let serving = async () => {
    // Discovery has its own cadence and one owned flight. A slow wrangler
    // listing must never sit between consecutive target probes.
    refresh()
    let problem = await check(version.id)
    let observed = new Date(now()).toISOString()
    if (!problem) return { problem, sibling: false, observed }
    // Backfills have no polling loop, so finish their one discovery first.
    if (backfill) await discovery
    if (failure) throw failure.error
    for (let v of siblings) {
      if (v.id != version.id && sha && names(v, sha) && !await check(v.id)) {
        return { problem: null, sibling: true, observed }
      }
    }
    return { problem, sibling: false, observed }
  }
  let activation = async () => {
    // A late recorder or a serving sibling verifies the commit, but only
    // retained history proves when its earliest version first became active.
    let first = deploymentsFor(
      version.id,
      rowsIn<Deployment>(await history(), 'deployments'),
    )[0]?.created_on
    if (!first || !Number.isFinite(Date.parse(first))) {
      throw new Error(`no deployment time for serving version ${version.id}`)
    }
    return new Date(Math.max(
      Date.parse(version.metadata.created_on),
      Date.parse(first),
    )).toISOString()
  }
  // A recorder that starts after its version went live (the gate's one runner
  // was busy with the push before) saw only the probes catch up: the version
  // was live when Cloudflare deployed it, not when the first probe answered.
  // A version that deployed while the recorder watched is timed by its probe.
  let stamped = async (observed: string) => {
    try {
      let first = await activation()
      return Date.parse(first) <= began ? first : observed
    } catch {
      return observed
    }
  }
  try {
    let result = await serving()
    if (!result.problem) return { live: await activation(), problem: null }
    let due = now() + 120_000
    while (!backfill && result.problem && now() < due) {
      await wait()
      result = await serving()
    }
    return {
      live: result.problem
        ? null
        : result.sibling
        ? await activation()
        : await stamped(result.observed),
      problem: result.problem,
    }
  } finally {
    // Join even on success/error: no orphaned listing, and cleanup cannot
    // move a successful target probe's recorded completion time.
    await discovery
  }
}

// In the gate the recorder measures the commit under test, and the row lives
// only in that run's checkout: no workflow here pushes, and a bench-row commit
// on main would start another Workers Build and another gate. So the row rides
// the job summary — copy it into
// bench/deploys.jsonl with the next change; baseline acceptance is explicit.
export let summary = (rows: Deploy[]) =>
  `### deploy timing\n\nAppend to \`bench/deploys.jsonl\`:\n\n\`\`\`\n${
    rows.map((r) => JSON.stringify(r)).join('\n')
  }\n\`\`\`\n`

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
  let skipped = false
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
      if (!match) {
        let checks = await api(`commits/${sha}/check-runs`).catch(() => ({
          check_runs: [],
        }))
        if (!built(checks.check_runs)) {
          console.log(
            `${sha.slice(0, 8)}: no kernel Workers Build — nothing to time`,
          )
          skipped = true
          continue
        }
        throw new Error(`no uploaded version for ${sha} after 120s`)
      }
    }
    if (match && !used.has(match.version.id)) {
      pending.push({ sha, push, match })
      used.add(match.version.id)
    }
    if (pending.length == count) break
  }
  if (!pending.length) {
    if (skipped) return 0
    throw new Error('no uploads match recent pushes')
  }
  let code = 0
  let written: Deploy[] = []
  let old = await readRecords()
  for (let { sha, push, match } of pending.reverse()) {
    let uploaded = match.version.metadata.created_on
    let recorded = old.find((r) =>
      r.sha == sha && r.uploaded == uploaded && !r.backfill && r.live != null
    )
    if (recorded) {
      console.log(
        `${sha.slice(0, 8)}: ${split(recorded)}; live ${
          recorded.seconds!.toFixed(3)
        }s — already recorded`,
      )
      continue
    }
    let { live, problem } = await observe(match.version, backfill, {
      sha,
      related: versions,
    })
    // Asked once the probes are done, so it never delays the first one. A row
    // without it counts the build's wait as its own (bench/deploy.ts `own`).
    let running = await buildStart(sha, cloudflare, (await worker()).name)
      .catch((e: Error) => {
        console.log(`${sha.slice(0, 8)}: build start unknown — ${e.message}`)
        return undefined
      })
    // GitHub's push stamp is a proxy that can trail the build Cloudflare
    // started on it, and a build can wait no less than nothing.
    let started = running && Date.parse(running) <= Date.parse(uploaded)
      ? new Date(Math.max(Date.parse(running), Date.parse(push.pushed)))
        .toISOString()
      : undefined
    let row: Deploy = {
      sha,
      ...push,
      ...started ? { started } : {},
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
    if (added) written.push(row)
    console.log(
      `${sha.slice(0, 8)}: ${split(row)}${
        match.estimated ? ' (estimated SHA match)' : ''
      }; ${
        live
          ? `live ${row.seconds!.toFixed(3)}s${
            backfill ? ' (historical upper bound, excluded from ratchet)' : ''
          }`
          : `live unverified: ${problem}`
      } — ${added ? 'recorded' : 'already recorded'}`,
    )
    if (!backfill && problem) code = 1
  }
  let job = Deno.env.get('GITHUB_STEP_SUMMARY')
  if (job && written.length) {
    await Deno.writeTextFile(job, summary(written), { append: true })
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
