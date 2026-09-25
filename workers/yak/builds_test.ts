// A failed Workers Build is filed with its commit; nothing else is filed.
import { assertEquals, assertInstanceOf } from '@std/assert'
import { broke, BuildFailed, type Built, rebuild } from './builds.ts'
import type { Env } from './env.ts'

let event = (type: string): Built => ({
  type: `cf.workersBuilds.worker.build.${type}`,
  source: { workerName: 'yak' },
  payload: {
    buildUuid: 'build-1',
    buildTriggerMetadata: {
      buildTriggerSource: 'push_event',
      branch: 'main',
      commitHash: '191f7134aa',
      commitMessage: '@yaks/mail pulls what arrived',
    },
  },
})

Deno.test('builds: a failure is filed under its build, with its commit', () => {
  let b = broke(event('failed'))!
  assertEquals(b.build, 'build-1')
  assertEquals(b.request, 'BUILD yak 191f7134')
  assertEquals(b.tags, { worker: 'yak', commit: '191f7134aa', branch: 'main' })
  assertInstanceOf(b.error, BuildFailed)
  assertEquals(
    b.error.message,
    'the Workers Build of yak at 191f7134 (main) failed, so it never ' +
      'deployed: @yaks/mail pulls what arrived',
  )
})

Deno.test('builds: any other event is nothing to file', () => {
  for (let type of ['started', 'succeeded', 'canceled']) {
    assertEquals(broke(event(type)), null)
  }
})

Deno.test('builds: a failed build of a branch that deploys nothing is not filed', () => {
  let branch = event('failed')
  branch.payload!.buildTriggerMetadata!.branch = 'worktree-agent-1'
  assertEquals(broke(branch), null)
})

Deno.test('builds: a push that failed is built again, and only a push', () => {
  assertEquals(broke(event('failed'))!.again, true)
  let retry = event('failed')
  retry.payload!.buildTriggerMetadata!.buildTriggerSource = 'deploy_hook'
  assertEquals(broke(retry)!.again, false)
})

Deno.test('builds: with no hook there is nothing to start', async () => {
  assertEquals(await rebuild({} as Env), 'no BUILD_HOOK')
})
