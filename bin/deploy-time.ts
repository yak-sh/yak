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
//
// It records what it could measure and says what it could not, and nothing
// it observes fails it (T-132885): a build Cloudflare has not finished, one
// that uploaded no version, a version it never saw answer. A push that never
// goes live is reported by the deploy catch-up (packages/admin/catchup.ts
// NotLive) and a failed build by workers/yak/builds.ts; the deploy gate,
// after the tests, judges the row (bench/deploy.ts `suite`).
import {
  answered,
  type Deploy,
  elsewhere,
  readRecords,
  RECORD,
  records,
  split,
} from '../bench/deploy.ts'
import { changed, WRANGLER } from '../workers/yak/wrangler.ts'
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
export type Check = {
  name: string
  status: string
  conclusion: string | null
}

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

// Cloudflare's check run for its finished build of the kernel Worker. It is
// posted `in_progress` as the build starts and `completed` with its
// conclusion once it ends; until then there is none.
export let finished = (runs: Check[]): Check | undefined =>
  runs.find((r) => r.name == 'Workers Builds: yak' && r.status == 'completed')

/** Where the wait for a commit's uploaded version stands: whether the version
 * is found, whether the commit changes the watched source (wrangler.ts
 * `WATCHED`; null when git could not tell), Cloudflare's finished build
 * with how many seconds ago it was first seen, the seconds waited, and
 * whether a newer push to main changes the watched source after it. */
export type Waiting = {
  found: boolean
  coming: boolean | null
  finished?: { conclusion: string | null; ago: number }
  waited: number
  overtaken?: boolean
}

// Seconds a finished build's version may take to show in `versions list`,
// and seconds a build may take at all, queue included (2026-10-22: 41–148s).
export let SETTLE = 60
export let LIMIT = 900

/// verdict({ found: true, coming: true, waited: 5 }) -> 'found'
/// verdict({ found: false, coming: false, waited: 0 }) -> 'skip'
/// verdict({ found: false, coming: true, waited: 148 }) -> 'wait'
/// verdict({ found: false, coming: null, waited: 148 }) -> 'wait'
/// verdict({ found: false, coming: true, waited: 90, finished: { conclusion: 'success', ago: 10 } }) -> 'wait'
/// verdict({ found: false, coming: true, waited: 90, finished: { conclusion: 'failure', ago: 0 } }) -> "Cloudflare's build failed: failure"
/// verdict({ found: false, coming: true, waited: 150, finished: { conclusion: 'success', ago: 60 } }) -> 'Cloudflare built it but uploaded no version within 60s'
/// verdict({ found: false, coming: true, waited: 900 }) -> "Cloudflare's build has not finished after 900s"
/// verdict({ found: false, coming: true, waited: 150, finished: { conclusion: 'success', ago: 60 }, overtaken: true }) -> 'skip'
/// verdict({ found: false, coming: true, waited: 20, overtaken: true }) -> 'skip'
/** What the wait does next. Cloudflare builds a push only when it changes the
 * watched source, so a docs-or-CI commit has nothing to wait for; one that
 * does is waited on until Cloudflare's own build finishes, however long its
 * queue, never a guess at how long a build takes. A push a newer one overtook
 * uploads nothing either: its build stops before deploying (wrangler.ts
 * `superseded`), or Cloudflare never runs it, and the newer push's own gate
 * times the deploy that carries it. Any other answer is why the push cannot
 * be timed, which the recorder says and goes on. */
export let verdict = (
  { found, coming, finished, waited, overtaken }: Waiting,
): 'found' | 'skip' | 'wait' | string => {
  if (found) return 'found'
  if (coming === false) return 'skip'
  if (finished && finished.conclusion != 'success') {
    return `Cloudflare's build failed: ${finished.conclusion}`
  }
  if (overtaken) return 'skip'
  if (finished && finished.ago >= SETTLE) {
    return `Cloudflare built it but uploaded no version within ${SETTLE}s`
  }
  if (!finished && waited >= LIMIT) {
    return `Cloudflare's build has not finished after ${LIMIT}s`
  }
  return 'wait'
}

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
    return served == version ? null : elsewhere(served, version)
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
let wrangler = (...args: string[]) =>
  command(
    WRANGLER[0],
    [...WRANGLER.slice(1), ...args, '--json'],
    new URL('../workers/yak/', import.meta.url),
  )
let versions = (): Promise<Version[]> => wrangler('versions', 'list')
let deployments = (): Promise<unknown> => wrangler('deployments', 'list')
let pause = () => new Promise<void>((ok) => setTimeout(ok, 1000))

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
    history = deployments,
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
  // Another version's answer, once any probe got one: yaks.app answered, and
  // a later probe that got nothing does not undo that (bench/deploy.ts `down`).
  let other: string | undefined
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
    if (answered(problem)) other = problem
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
      problem: result.problem && (other ?? result.problem),
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

/** What the recorder reads, waits on and writes: GitHub (`gh api`), the
 * Worker's versions and deployments (wrangler), whether a range of commits
 * changes the watched source (git), yaks.app (`probe`), when Cloudflare
 * started a build, the record, the job summary and the log. A test stands in
 * for any of them. */
export type World = {
  api: typeof api
  versions: () => Promise<Version[]>
  history: () => Promise<unknown>
  changed: (from: string, to: string) => Promise<boolean | null>
  check: (version: string) => Promise<string | null>
  started: (sha: string) => Promise<string | undefined>
  read: () => Promise<Deploy[]>
  append: (row: Deploy) => Promise<boolean>
  job: (text: string) => Promise<void>
  say: (line: string) => void
  now: () => number
  wait: () => Promise<void>
}

let world: World = {
  api,
  versions,
  history: deployments,
  changed: (from, to) => changed(root.pathname, from, to),
  check: probe,
  started: async (sha) => buildStart(sha, cloudflare, (await worker()).name),
  read: readRecords,
  append,
  job: async (text) => {
    let path = Deno.env.get('GITHUB_STEP_SUMMARY')
    if (path) await Deno.writeTextFile(path, text, { append: true })
  },
  say: console.log,
  now: Date.now,
  wait: pause,
}

// Whether `sha` changes the watched source since its parent, so Cloudflare
// builds it; null when that cannot be read.
let starts = async (io: World, sha: string) => {
  let parent = (await io.api(`commits/${sha}`).catch(() => null))?.parents
    ?.[0]?.sha
  return parent ? await io.changed(parent, sha) : null
}

// Main's tip, or null when it cannot be read.
let tipOf = async (io: World): Promise<string | null> =>
  (await io.api('commits/main').catch(() => null))?.sha ?? null

// Whether `tip` changes the watched source after `sha`, so its build
// overtakes `sha`'s.
let overtakes = async (io: World, sha: string, tip: string) =>
  tip != sha && await io.changed(sha, tip).catch(() => null) == true

// Waits for `sha`'s uploaded version as verdict() says: the version, or what
// to say instead of timing it.
let awaited = async (
  io: World,
  sha: string,
  pushed: string,
  match: ReturnType<typeof versionFor>,
) => {
  let coming = match ? true : await starts(io, sha)
  let begun = io.now()
  let asked = -Infinity
  let done: { conclusion: string | null; at: number } | undefined
  // Main's tip as last asked, and whether it overtook `sha`.
  let tip = sha
  let over = false
  for (;;) {
    let now = io.now()
    if (!match && coming !== false && !over && now - asked >= 10_000) {
      asked = now
      if (!done) {
        let checks = await io.api(`commits/${sha}/check-runs`).catch(() => ({
          check_runs: [],
        }))
        let run = finished(checks.check_runs)
        if (run) done = { conclusion: run.conclusion, at: now }
      }
      let head = await tipOf(io)
      if (head && head != tip) over = await overtakes(io, sha, tip = head)
    }
    let next = verdict({
      found: !!match,
      coming,
      waited: (now - begun) / 1000,
      finished: done && {
        conclusion: done.conclusion,
        ago: (now - done.at) / 1000,
      },
      overtaken: over,
    })
    if (next == 'found' && match) return match
    if (next == 'skip') {
      return `${
        over
          ? `overtaken by ${tip.slice(0, 8)}, whose build deploys it`
          : 'no kernel Workers Build'
      } — nothing to time`
    }
    if (next != 'wait') return `${next} — not timed`
    await io.wait()
    match = versionFor(sha, pushed, await io.versions())
  }
}

export let main = async (args = Deno.args, given: Partial<World> = {}) => {
  let io = { ...world, ...given }
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
    io.api('events?per_page=100').catch(() => []),
    io.api(
      'actions/workflows/gate.yml/runs?event=push&branch=main&per_page=100',
    ),
    io.versions(),
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
  let untimed = false
  for (let sha of shas) {
    let suites = await io.api(`commits/${sha}/check-suites`).catch(() => ({
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
      let found = await awaited(io, sha, push.pushed, match)
      if (typeof found == 'string') {
        io.say(`${sha.slice(0, 8)}: ${found}`)
        untimed = true
        continue
      }
      match = found
    }
    if (match && !used.has(match.version.id)) {
      pending.push({ sha, push, match })
      used.add(match.version.id)
    }
    if (pending.length == count) break
  }
  if (!pending.length) {
    if (untimed) return
    throw new Error('no uploads match recent pushes')
  }
  let written: Deploy[] = []
  let old = await io.read()
  for (let { sha, push, match } of pending.reverse()) {
    let uploaded = match.version.metadata.created_on
    let recorded = old.find((r) =>
      r.sha == sha && r.uploaded == uploaded && !r.backfill && r.live != null
    )
    if (recorded) {
      io.say(
        `${sha.slice(0, 8)}: ${split(recorded)}; live ${
          recorded.seconds!.toFixed(3)
        }s — already recorded`,
      )
      continue
    }
    let { live, problem } = await observe(match.version, backfill, {
      sha,
      related: io.versions,
      check: io.check,
      history: io.history,
      now: io.now,
      wait: io.wait,
    })
    // Asked once the probes are done, so it never delays the first one. A row
    // without it counts the build's wait as its own (bench/deploy.ts `own`).
    let running = await io.started(sha).catch((e: Error) => {
      io.say(`${sha.slice(0, 8)}: build start unknown — ${e.message}`)
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
    let added = await io.append(row)
    if (added) written.push(row)
    io.say(
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
  }
  if (written.length) await io.job(summary(written))
}

if (import.meta.main) {
  try {
    await main()
    Deno.exit(0)
  } catch (e) {
    console.error(`deploy-time: ${e instanceof Error ? e.message : e}`)
    Deno.exit(1)
  }
}
