// What Workers Builds says happened to a build of this Worker. Its event
// subscription writes to the `yak-builds` queue (wrangler.toml
// `[[queues.consumers]]`), and a failed build is a fault like any other:
// Sentry hears it, and the meta store keeps it beside every other break of
// ours (unseen.ts). The version already live keeps serving through a
// failed build, so what breaks is only that the fix in it never arrives, and
// nothing about the site says so. Each build is its own Sentry issue, so each
// one is news rather than another event on an issue already seen.
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
// failure would never stop. The meta store holds the once: a failure is noted as the commit's own entity, on the
// condition (`$was`) that the commit holds no break yet, so the queue
// delivering one failure twice notes it once, and only the note that lands
// earns the retry.

import { withScope } from '@sentry/core'
import { Stale } from '@yaks/graph'
import type { Env } from './env.ts'
import { caught, defect } from './sentry.ts'
import { type Breaks, exceptionOf, metaBreaks } from './unseen.ts'

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

/** A build that did not deploy: the error Sentry is handed. */
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

/** Note a failed build in the meta store, and say whether it earns a retry:
 * only the first note of a commit does. A build with no commit is noted under
 * an id of its own and earns none. */
export let first = async (breaks: Breaks, b: Broke): Promise<boolean> => {
  let exception = exceptionOf({
    request: b.request,
    message: b.error.message,
    stack: b.error.stack,
  })
  if (!b.commit) {
    await breaks([{ entity: { eid: '$broke' }, exception }])
    return false
  }
  try {
    await breaks([{
      entity: { eid: b.commit },
      $was: { exception: { request: null } },
      exception,
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
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : e}`
  }
}

type Batch = { messages: readonly { body: Built; ack(): void }[] }

/** The queue handler: note each failed build, build a commit's first
 * failure again, send each to Sentry with what the retry came to, and
 * acknowledge every message. A note that fails is telemetry and earns no
 * retry: a retry nobody recorded is how the loop starts. */
export let builds = async (batch: Batch, env: Env) => {
  for (let m of batch.messages) {
    let b = broke(m.body)
    if (b) {
      let once = await first(metaBreaks(env), b).catch((why) => {
        caught(why, { request: `file ${b.request}` })
        return false
      })
      let retry = once ? await rebuild(env) : undefined
      withScope((scope) => {
        scope.setFingerprint(['build failed', b.build])
        defect(b.error, { request: b.request, ...b.tags, retry })
      })
    }
    m.ack()
  }
}
