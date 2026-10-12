// What Workers Builds says happened to a build of this Worker. Its event
// subscription writes to the `yak-builds` queue (wrangler.toml
// `[[queues.consumers]]`), and a failed build is a fault like any other:
// the tracker hears it, and the meta store keeps the retry receipt
// (unseen.ts). The version already live keeps serving through a
// failed build, so what breaks is only that the fix in it never arrives, and
// nothing about the site says so. Builds that fail for one cause are one
// tracker bug, filed under the failing step and error the log names (or one
// "unknown" cause while the log is unreadable), so one cause brings one letter
// and one fixer however many commits it breaks. Each failure is a hit under
// the commit it built, so a build that fails after its bug was resolved
// brings the bug back.
//
// The subscription asks for failures alone; anything else that arrives is
// acknowledged unread, and so is a failed build of any branch but the one
// Builds deploys (README "Workers Builds"): nothing it built was on its way
// to production.
//
// A failed build is built once more, because most failures are the network's
// (a download that 404s for a minute, a registry push that times out) and a
// commit nothing is pushed after would otherwise never deploy. Once per commit,
// and never for a build that names none: the deploy hook's own builds carry
// an empty commit while their event still says `push_event`, so the trigger
// source cannot tell a retry from a push, and a retry that retried its own
// failure would never stop. The meta store holds the once: a receipt is noted
// as the commit's own entity, on the condition (`$was`) that the commit holds
// no receipt yet. Delivering one failure twice therefore notes it once, and
// only the note that lands earns the retry.

import { Stale } from '@yaks/graph/errors'
import { normalize } from '@yaks/tracker'
import type { Env } from './env.ts'
import { caught, defect } from './defects.ts'
import { type Breaks, metaBreaks } from './unseen.ts'
import { accountUrl } from './workers_api.ts'

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
        `failed, so it never deployed: ${commitMessage ?? ''}`.trim(),
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

// Build output can print credentials. Only fixed labels and numeric status
// codes leave this function; no log line is sent to the tracker or the meta store.
export let failure = (
  lines: string[],
  prior = { step: 'Workers Builds setup', reason: 'see build log' },
) => {
  let { step, reason } = prior
  for (let line of lines) {
    if (line.includes('--- installing deno')) step = 'install Deno'
    if (line.includes('--- deno task check')) step = 'deno task check'
    if (line.includes('--- deno task test')) {
      step = 'deno task test'
    }
    if (line.includes('Executing user deploy command')) step = 'deploy command'
    if (/Task deploy:yak-staging\b/.test(line)) step = 'deploy staging'
    else if (/Task deploy:yak\b/.test(line)) step = 'deploy yak'

    let type = line.match(/\bTS\d{4}\b/)?.[0]
    let http = line.match(
      /\b(?:HTTP|status|returned(?: error:)?|response)\s*(4\d\d|5\d\d)\b/i,
    )?.[1]
    if (type) reason = `TypeScript ${type}`
    else if (http) reason = `HTTP ${http}`
    else if (/\binternal server error\b/i.test(line)) {
      reason = 'Cloudflare internal error'
    } else if (/\bcould not resolve file type\b/i.test(line)) {
      reason = 'file type could not be resolved'
    } else if (/\b(?:timed? out|timeout|ETIMEDOUT)\b/i.test(line)) {
      reason = 'timeout'
    } else if (
      /\b(?:ENOTFOUND|could not resolve host|DNS lookup failed)\b/i.test(line)
    ) {
      reason = 'DNS failure'
    } else if (/\b(?:ECONNRESET|connection reset)\b/i.test(line)) {
      reason = 'connection reset'
    } else if (/\b(?:ENOSPC|no space left on device)\b/i.test(line)) {
      reason = 'disk full'
    } else if (/\b(?:out of memory|OOM)\b/i.test(line)) {
      reason = 'out of memory'
    } else if (/\b(?:test failed|failed test|FAILURES)\b/i.test(line)) {
      reason = 'test failure'
    }
  }
  return { step, reason }
}

/** Read every log page so the failing step at the end is visible. A broken
 * logs API leaves the build report intact and says why details are absent. */
export let logsOf = async (env: Env, uuid?: string) => {
  if (!uuid || !env.CF_ACCOUNT) return 'build UUID or account unavailable'
  if (!env.BUILD_LOG_TOKEN) return 'BUILD_LOG_TOKEN unavailable'
  let detail = failure([])
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
      let res = await fetch(at, {
        headers: { authorization: `Bearer ${env.BUILD_LOG_TOKEN}` },
        signal,
      })
      if (!res.ok) return `build logs returned HTTP ${res.status}`
      let page = await res.json() as Logs
      if (!page.success || !page.result) return 'build logs response failed'
      detail = failure(
        (page.result.lines ?? []).flatMap((row) => {
          let line = row.at(-1)
          return typeof line == 'string' ? [line] : []
        }),
        detail,
      )
      cursor = page.result.truncated ? page.result.cursor : undefined
      if (page.result.truncated && !cursor) {
        return 'build logs pagination failed'
      }
      if (cursor && seen.has(cursor)) return 'build logs repeated a page'
      if (cursor) seen.add(cursor)
    } while (cursor)
    return detail
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
    : `Step: ${detail.step}; error: ${detail.reason}`
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

/** Note a failed build in the meta store, and say whether it earns a retry:
 * only the first note of a commit does. A build with no commit is noted under
 * an id of its own and earns none. */
export let first = async (breaks: Breaks, b: Broke): Promise<boolean> => {
  if (!b.commit) return false
  let failed = { at: new Date().toISOString(), reason: b.error.message }
  try {
    await breaks([{
      entity: { eid: b.commit },
      $was: { failed: { at: null } },
      failed,
    }])
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

/** The queue handler: note each failed build, build a commit's first
 * failure again, send each to the tracker with what the retry came to, and
 * acknowledge every message. A note that fails is telemetry and earns no
 * retry: a retry nobody recorded is how the loop starts. */
export let builds = async (batch: Batch, env: Env) => {
  for (let m of batch.messages) {
    let event = broke(m.body)
    if (event) {
      let detail = diagnosed(env, event)
      let once = await first(metaBreaks(env), event).catch((why) => {
        caught(why, { request: `file ${event.request}` })
        return false
      })
      let retry = once ? await rebuild(env) : undefined
      let b = await detail
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
    m.ack()
  }
}
