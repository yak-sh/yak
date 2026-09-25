// What Workers Builds says happened to a build of this Worker. Its event
// subscription writes to the `yak-builds` queue (wrangler.toml
// `[[queues.consumers]]`), and a failed build is a fault like any other:
// Sentry hears it, and the meta store keeps it beside every other break of
// ours (unseen.ts `fault`). The version already live keeps serving through a
// failed build, so what breaks is only that the fix in it never arrives, and
// nothing about the site says so. Each build is its own Sentry issue, so each
// one is news rather than another event on an issue already seen.
//
// The subscription asks for failures alone; anything else that arrives is
// acknowledged unread, and so is a failed build of any branch but the one
// Builds deploys (README "Workers Builds"): nothing it built was on its way
// to production.
//
// A failed build of a push is built once more, because most failures are the
// network's (a download that 404s for a minute, a registry push that times
// out) and a commit nothing is pushed after would otherwise never deploy. The
// second build is started by the deploy hook, so it is not a push's and its
// own failure is filed without another try: a commit that fails twice holds a
// fault, and Sentry already has it.

import { withScope } from '@sentry/core'
import type { Env } from './env.ts'
import { fault } from './unseen.ts'

/** The part of a Workers Builds event this reads. */
export type Built = {
  type?: string
  source?: { workerName?: string }
  payload?: {
    buildUuid?: string
    buildTriggerMetadata?: {
      buildTriggerSource?: string
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
  let { branch, commitHash, commitMessage, buildTriggerSource } =
    b.payload?.buildTriggerMetadata ?? {}
  if (branch && branch != PRODUCTION) return null
  let commit = commitHash?.slice(0, 8) ?? 'unknown'
  return {
    build: b.payload?.buildUuid ?? commit,
    request: `BUILD ${worker} ${commit}`,
    error: new BuildFailed(
      `the Workers Build of ${worker} at ${commit} (${branch ?? '?'}) ` +
        `failed, so it never deployed: ${commitMessage ?? ''}`.trim(),
    ),
    tags: { worker, commit: commitHash, branch },
    again: buildTriggerSource == 'push_event',
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

/** The queue handler: build each failed push again, file each failed build
 * with what the retry came to, acknowledge every message. */
export let builds = async (batch: Batch, env: Env) => {
  for (let m of batch.messages) {
    let b = broke(m.body)
    if (b) {
      let retry = b.again ? await rebuild(env) : undefined
      await withScope((scope) => {
        scope.setFingerprint(['build failed', b.build])
        return fault(env, b.request, b.error, { ...b.tags, retry })
      })
    }
    m.ack()
  }
}
