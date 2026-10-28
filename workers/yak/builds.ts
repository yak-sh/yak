// What Workers Builds says happened to a build of this Worker. Its event
// subscription writes to the `yak-builds` queue (wrangler.toml
// `[[queues.consumers]]`). bin/build-yak deploys production and then staging,
// so a build says what it deployed only through the step its log shows
// failing: one that fails before production deploys leaves the live version
// serving and the fix in it never arrives, while one that fails at staging
// has already deployed production. An unreadable log claims neither.
//
// The subscription asks for failures alone; anything else that arrives is
// acknowledged unread, and so is a failed build of any branch but the one
// Builds deploys (README "Workers Builds"): nothing it built was on its way
// to production.
//
// What reaches the tracker is a failure someone has to fix. Most failures are
// the network's (Builds' own clone of the repo, a download that 404s for a
// minute, a registry push that times out), so a commit's first failure is
// built once more through the deploy hook, and while that build runs the
// failure is a log line: nothing is lost yet. A failure our code causes fails
// the rebuild too, and the rebuild's failure is filed with its diagnosis
// minutes later. The deploy hook's builds carry an empty commit while their
// event still says `push_event`, so the trigger source cannot tell a retry
// from a push, and a build that names no commit is never built again: a retry
// that retried its own failure would never stop. A failure that earns no
// rebuild is filed at once: no `BUILD_HOOK`, a hook that refused or could not
// be reached, a build with no commit, a commit's second build. A rebuild that
// never reports back leaves its commit not live, which the box's deploy
// catch-up reports (NotLive, packages/admin/catchup.ts).
//
// Builds that fail for one cause are one tracker bug, filed under the failing
// step and error the log names (or one "unknown" cause while the log is
// unreadable), so one cause brings one letter and one fixer however many
// commits it breaks. Each failure is a hit under the commit it built, so a
// build that fails after its bug was resolved brings the bug back.
//
// The meta store holds the receipts that make each decision once (unseen.ts
// `metaBreaks`): a failed build is noted as its own entity, and a commit's
// failure as the commit's, each on the condition (`$was`) that it holds no
// receipt yet. A build delivered twice is decided by its first delivery, and
// only the commit's first note earns the rebuild.

import { Stale } from '@yaks/graph/errors'
import { normalize } from '@yaks/tracker'
import type { Env } from './env.ts'
import { caught, defect } from './defects.ts'
import { type Breaks, metaBreaks } from './unseen.ts'
import { accountUrl, resent } from './workers_api.ts'

/** The part of a Workers Builds event this reads. */
export type Built = {
  type?: string
  source?: { workerName?: string }
  payload?: {
    buildUuid?: string
    buildTriggerMetadata?: {
      branch?: string
      commitHash?: string
      commitMessage?: string
    }
  }
}

/** A build that did not deploy: the error the tracker is handed. */
export class BuildFailed extends Error {
  override name = 'BuildFailed'
}

/** The branch whose builds deploy. */
export let PRODUCTION = 'main'

/** What a failed build of {@link PRODUCTION} is filed as, and nothing for any
 * other event. */
export let broke = (b: Built) => {
  if (b.type != 'cf.workersBuilds.worker.build.failed') return null
  let worker = b.source?.workerName ?? 'yak'
  let { branch, commitHash, commitMessage } = b.payload?.buildTriggerMetadata ??
    {}
  if (branch && branch != PRODUCTION) return null
  let short = commitHash?.slice(0, 8) || 'unknown'
  return {
    build: b.payload?.buildUuid ?? short,
    uuid: b.payload?.buildUuid,
    commit: commitHash || undefined,
    request: `BUILD ${worker} ${short}`,
    error: new BuildFailed(
      `the Workers Build of ${worker} at ${short} (${branch ?? '?'}) ` +
        `failed: ${commitMessage ?? ''}`.trim(),
    ),
    tags: { worker, commit: commitHash, branch },
  }
}

type Broke = NonNullable<ReturnType<typeof broke>>

/** The dashboard's build details page; its last segment is the build UUID. */
export let buildUrl = (env: Env, b: Broke) =>
  env.CF_ACCOUNT && b.uuid
    ? `https://dash.cloudflare.com/${encodeURIComponent(env.CF_ACCOUNT)}` +
      `/workers/services/view/${encodeURIComponent(b.tags.worker)}` +
      `/production/builds/${encodeURIComponent(b.uuid)}`
    : undefined

type Logs = {
  success?: boolean
  result?: {
    lines?: (string | number)[][]
    cursor?: string
    truncated?: boolean
  }
}

// Build output can print credentials, so no line leaves here as printed. The
// failing step is a fixed label. The error is the one statement that names it
// (a compiler's, the runtime's or wrangler's) with its place in the repo and
// its code, everything shaped like a credential replaced, and the whole
// capped. A failure that prints no statement keeps a fixed label for what it
// looks like: a timeout, a full disk.

/** Replace what could be a credential in one printed line. */
export let scrub = (line: string) =>
  line
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [redacted]')
    .replace(/:\/\/[^\s/@]+@/g, '://[redacted]@')
    .replace(/(https?:\/\/[^\s?#)"']+)[?#][^\s)"']*/g, '$1')
    .replace(
      /\b(\w*(?:token|secret|password|passwd|credential|api_?key)\w*)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
      '$1$2[redacted]',
    )
    .replace(
      /\b(?:(?:sk|pk|rk)[-_][\w-]{6,}|(?:ghp|gho|ghs|whsec)_\w{6,}|xox[abp]-[\w-]+|AKIA[A-Z0-9]{12,}|eyJ[\w-]{10,}(?:\.[\w-]+)*)/g,
      '[redacted]',
    )
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{24,}/g, '[redacted]')

/// scrub('https://u:p@h.test/x?k=1') -> 'https://[redacted]@h.test/x'
/// scrub('error: TS2322 at sk-proj-private-value') -> 'error: TS2322 at [redacted]'
/// scrub('API_TOKEN=abc123 Bearer xyz') -> 'API_TOKEN=[redacted] Bearer [redacted]'

let STEPS: [RegExp, string][] = [
  [/--- installing deno/, 'install Deno'],
  [/--- deno task check/, 'deno task check'],
  [/--- deno task test/, 'deno task test'],
  [/Executing user deploy command/, 'deploy command'],
  [/Task deploy:yak-staging\b/, 'deploy staging'],
  [/Task deploy:yak\b/, 'deploy yak'],
]

let stepOf = (line: string) => STEPS.find(([p]) => p.test(line))?.[1]

let labelOf = (line: string) => {
  let type = line.match(/\bTS\d{4}\b/)?.[0]
  let http = line.match(
    /\b(?:HTTP|status|returned(?: error:)?|response)\s*(4\d\d|5\d\d)\b/i,
  )?.[1]
  return type
    ? `TypeScript ${type}`
    : http
    ? `HTTP ${http}`
    : /\binternal server error\b/i.test(line)
    ? 'Cloudflare internal error'
    : /\bcould not resolve file type\b/i.test(line)
    ? 'file type could not be resolved'
    : /\b(?:timed? out|timeout|ETIMEDOUT)\b/i.test(line)
    ? 'timeout'
    : /\b(?:ENOTFOUND|could not resolve host|DNS lookup failed)\b/i.test(line)
    ? 'DNS failure'
    : /\b(?:ECONNRESET|connection reset)\b/i.test(line)
    ? 'connection reset'
    : /\b(?:ENOSPC|no space left on device)\b/i.test(line)
    ? 'disk full'
    : /\b(?:out of memory|OOM)\b/i.test(line)
    ? 'out of memory'
    : /\b(?:test failed|failed test|FAILURES)\b/i.test(line)
    ? 'test failure'
    : /\bwhile fetching repository\b/i.test(line)
    ? 'repository fetch failed'
    : undefined
}

// A named error says more than a bare marker: wrangler's `✘ [ERROR] A
// request … failed.` is followed by the `Uncaught TypeError: …` that caused it.
let NAMED = /\b\w*(?:Error|Exception):\s+\S|\bTS\d{4}\b/
let MARKER = /^(?:✘\s*\[ERROR\]|error(?:\[[^\]]*\])?:)\s*/i
let rank = (line: string) =>
  NAMED.test(line) ? 2 : MARKER.test(line.trim()) ? 1 : 0

let REPO = /(?:file:\/\/)?\/opt\/buildhome\/repo\//g

/** The statement at `i`, with the repo place and code printed under it. */
let statement = (lines: string[], i: number) => {
  let near = lines.slice(i + 1, i + 16).join('\n')
  let place = near.match(/\/repo\/([^\s:)'"]+):(\d+)/)
  let code = near.match(/\[code:\s*(\d+)\]/)?.[1]
  let text = lines[i].trim().replace(MARKER, '').replace(REPO, '')
    .replace(/\.$/, '')
  let said = scrub(
    [text, place && `at ${place[1]}:${place[2]}`, code && `[code ${code}]`]
      .filter(Boolean).join(' '),
  )
  return said.length > 300 ? said.slice(0, 299) + '…' : said
}

/** The failing step and its error, from a build's whole log. The step is the
 * last one the log entered; the error is the first named statement in it, else
 * the first marked one, else a label for what the step's lines look like. */
export let failure = (lines: string[]) => {
  let step = 'Workers Builds setup'
  let label = 'see build log'
  let at = -1
  let best = 0
  lines.forEach((line, i) => {
    let s = stepOf(line)
    if (s) [step, at, best] = [s, -1, 0]
    label = labelOf(line) ?? label
    let r = rank(line)
    if (r > best) [at, best] = [i, r]
  })
  return { step, reason: at < 0 ? label : statement(lines, at) }
}

/** What a failing step left deployed: staging deploys after production, so
 * only its own failure leaves production's deploy standing. */
export let deployed = (step: string) =>
  step == 'deploy staging'
    ? 'production deployed; staging did not'
    : 'production did not deploy'

/// deployed('deploy staging') -> 'production deployed; staging did not'
/// deployed('deno task check') -> 'production did not deploy'

/** Read every log page so the failing step at the end is visible. A broken
 * logs API leaves the build report intact and says why details are absent. */
export let logsOf = async (env: Env, uuid?: string) => {
  if (!uuid || !env.CF_ACCOUNT) return 'build UUID or account unavailable'
  if (!env.BUILD_LOG_TOKEN) return 'BUILD_LOG_TOKEN unavailable'
  let lines: string[] = []
  let seen = new Set<string>()
  let cursor: string | undefined
  let signal = AbortSignal.timeout(20_000)
  try {
    do {
      let url = accountUrl(
        env,
        `/builds/builds/${encodeURIComponent(uuid)}/logs`,
      )
      let at = new URL(url)
      if (cursor) at.searchParams.set('cursor', cursor)
      let res = await resent(at.href, {
        headers: { authorization: `Bearer ${env.BUILD_LOG_TOKEN}` },
        signal,
      })
      if (!res.ok) return `build logs returned HTTP ${res.status}`
      let page = await res.json() as Logs
      if (!page.success || !page.result) return 'build logs response failed'
      for (let row of page.result.lines ?? []) {
        let line = row.at(-1)
        if (typeof line == 'string') lines.push(line)
      }
      cursor = page.result.truncated ? page.result.cursor : undefined
      if (page.result.truncated && !cursor) {
        return 'build logs pagination failed'
      }
      if (cursor && seen.has(cursor)) return 'build logs repeated a page'
      if (cursor) seen.add(cursor)
    } while (cursor)
    return failure(lines)
  } catch (error) {
    caught(error, { request: 'read build logs', build: uuid })
    return signal.aborted ? 'build logs timed out' : 'build logs request failed'
  }
}

/** Enrich one failure at the reporting boundary, leaving raw logs behind.
 * Its `cause` is what its bug is filed under: the step and error the log
 * names, with volatile parts gone, or `unknown` when the log can't be read. */
export let diagnosed = async (
  env: Env,
  b: Broke,
): Promise<Broke & { cause: string }> => {
  let detail = await logsOf(env, b.uuid)
  let summary = typeof detail == 'string'
    ? `Details unavailable: ${detail}`
    : `Step: ${detail.step}; error: ${detail.reason}; ${deployed(detail.step)}`
  let link = buildUrl(env, b)
  return {
    ...b,
    cause: typeof detail == 'string'
      ? 'unknown'
      : normalize(`${detail.step}: ${detail.reason}`),
    error: new BuildFailed(
      `${b.error.message}. ${summary}. Build log: ${
        link ?? 'location unavailable'
      }`,
    ),
  }
}

/** Note a failed build in the meta store as `eid`'s receipt, and say whether
 * it is the first: a later note finds the receipt and lands nothing. */
export let first = async (
  breaks: Breaks,
  eid: string,
  b: Broke,
): Promise<boolean> => {
  let failed = { at: new Date().toISOString(), reason: b.error.message }
  try {
    await breaks([{ entity: { eid }, $was: { failed: { at: null } }, failed }])
    return true
  } catch (e) {
    if (e instanceof Stale) return false
    throw e
  }
}

/** Start {@link PRODUCTION}'s build again through its deploy hook, the
 * `BUILD_HOOK` secret, and say what came of it. The hook builds the branch's
 * head: when a push came after the failed one, the build Builds already has
 * for it is the one that deploys, and the hook answers `already_exists` while
 * that build is pending. */
export let rebuild = async (env: Env): Promise<string> => {
  if (!env.BUILD_HOOK) return 'no BUILD_HOOK'
  try {
    let r = await fetch(env.BUILD_HOOK, { method: 'POST' })
    return r.ok ? 'started' : `refused ${r.status}`
  } catch {
    // Transport errors can include the deploy hook's credential-bearing URL.
    caught(new Error('failed to reach deploy hook'), {
      request: 'rebuild deploy hook',
    })
    return 'failed to reach deploy hook'
  }
}

type Batch = { messages: readonly { body: Built; ack(): void }[] }

/** The queue handler: decide each failed build once, however often it is
 * delivered, and acknowledge every message. A commit's first failure is built
 * again, and is a log line once that build started; any other failure goes to
 * the tracker with what its retry came to. A note that fails is telemetry: the
 * build is decided as new, and earns no retry, since a retry nobody recorded
 * is how the loop starts. */
export let builds = async (batch: Batch, env: Env) => {
  let breaks = metaBreaks(env)
  let noted = (b: Broke, eid: string | undefined, otherwise: boolean) =>
    eid
      ? first(breaks, eid, b).catch((why) => {
        caught(why, { request: `file ${b.request}` })
        return otherwise
      })
      : otherwise
  for (let m of batch.messages) {
    let event = broke(m.body)
    if (event && await noted(event, event.uuid, true)) {
      let detail = diagnosed(env, event)
      let once = await noted(event, event.commit, false)
      let retry = once ? await rebuild(env) : undefined
      let b = await detail
      if (retry == 'started') {
        console.log(`yak-builds: ${b.error.message}. Building it again.`)
      } else {
        defect(b.error, {
          request: b.request,
          ...b.tags,
          build_log: buildUrl(env, b),
          retry,
        }, {
          fault: `build failed:${b.tags.worker}:${b.cause}`,
          commit: b.commit ?? b.build,
        })
      }
    }
    m.ack()
  }
}
