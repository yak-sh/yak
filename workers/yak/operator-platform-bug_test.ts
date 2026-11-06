// The Operator's platform_bug report about a break the tracker already has
// joins that break's bug; only a failure no break records is a bug of its own.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { faultOf } from '@yaks/tracker/report'
import { ADA, seeded } from './serving-data-probe.ts'
import { platform } from './deploy-probe.ts'
import { call } from './tools.ts'
import { noted } from './unseen.ts'
import { within } from './defects.ts'
import { platformBug } from './operator.ts'

let tags = (row: Bundle) =>
  (row.error as { tags?: Record<string, string> } | undefined)?.tags ?? {}

test('platform_bug joins the bug of the break it is about', async () => {
  await using p = platform('unseen-secret')
  let { env } = p
  let { dir, space, app } = await seeded(env)
  let sent: Bundle[] = []
  let send = env.ERRORS!.send.bind(env.ERRORS)
  env.ERRORS = { send: (rows) => (sent.push(...rows), send(rows)) }
  await noted({
    request: 'page /',
    message: "unhandled rejection: Can't find variable: AsyncDisposableStack",
    stack: 'bind@https://yaks.app/__packages/abc/entry-1.js:1:4301',
    version: 41,
  }, { env, space, app })
  let copy = sent.find((r) => tags(r).source == 'app')!
  let ctx = { env, dir, person: ADA }
  let listed = await call(ctx, 'app_errors', { space: 'ada', app: 'cookbook' })
  let id = listed.text.split(' ')[1]

  // No window ever closes: each report is sent as it is made.
  let clock = { now: Date.now, after: () => () => {} }
  let report = async (args: Record<string, unknown>) => {
    sent.length = 0
    await within(
      env,
      {},
      () => platformBug(ctx, space).run(args, {} as never),
      clock,
    )
    return sent.find((r) => r.error)!
  }
  let text = 'The page is clean; @yaks/host uses AsyncDisposableStack.'

  let known = await report({ text, error: id })
  assertEquals(faultOf(known), faultOf(copy))
  assertEquals(known.exception, undefined)
  assertEquals((known.error as { message: string }).message, text)
  assertEquals(tags(known).occurrence, tags(copy).occurrence)

  let fresh = await report({ text: 'app_deploy lost a file' })
  assertEquals((fresh.error as { fault?: string }).fault, undefined)
  assertEquals(
    (fresh.error as { message: string }).message,
    'app_deploy lost a file',
  )

  await assertRejects(() => report({ text, error: '#0000000000' }))
})
