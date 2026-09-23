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
// acknowledged unread.

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

/** What a failed build is filed as, and nothing for any other event. */
export let broke = (b: Built) => {
  if (b.type != 'cf.workersBuilds.worker.build.failed') return null
  let worker = b.source?.workerName ?? 'yak'
  let { branch, commitHash, commitMessage } = b.payload?.buildTriggerMetadata ??
    {}
  let commit = commitHash?.slice(0, 8) ?? 'unknown'
  return {
    build: b.payload?.buildUuid ?? commit,
    request: `BUILD ${worker} ${commit}`,
    error: new BuildFailed(
      `the Workers Build of ${worker} at ${commit} (${branch ?? '?'}) ` +
        `failed, so it never deployed: ${commitMessage ?? ''}`.trim(),
    ),
    tags: { worker, commit: commitHash, branch },
  }
}

type Batch = { messages: readonly { body: Built; ack(): void }[] }

/** The queue handler: file each failed build, acknowledge every message. */
export let builds = async (batch: Batch, env: Env) => {
  for (let m of batch.messages) {
    let b = broke(m.body)
    if (b) {
      await withScope((scope) => {
        scope.setFingerprint(['build failed', b.build])
        return fault(env, b.request, b.error, b.tags)
      })
    }
    m.ack()
  }
}
