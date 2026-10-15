// A successful deploy review answers the model without shipping an app. The
// account pays for its model work, and no build is counted until it releases.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { build, fake } from './builder.ts'
import { ADA, platform, seeded } from './serving-probe.ts'
import { call } from './tools.ts'

await using p = platform()
let { dir, space } = await seeded(p.env)
let ctx = { env: p.env, dir, person: ADA }
await call(ctx, 'app_files', {
  app: 'cookbook',
  files: [{ path: 'index.html', content: '<h1>Serving</h1>' }],
})
await call(ctx, 'app_deploy', { app: 'cookbook' })
let review = await build(
  p.env,
  { person: ADA, role: 'owner' },
  space,
  [{ said: 'person', text: 'release my draft' }],
  {
    model: fake([
      {
        calls: [{
          id: 'review',
          name: 'app_deploy',
          args: JSON.stringify({ app: 'cookbook', base: 0 }),
        }],
      },
      { text: 'Please review the files before confirming.' },
    ]),
  },
)
let meter = (await dir.space('ada'))!.meter

test('a deploy review ships no version and consumes no build', () => {
  assertStringIncludes(
    review.lines.find((l) => l.said == 'tool')!.text,
    'no version was deployed',
  )
  assertEquals(meter?.built, undefined)
  assertEquals(meter?.builds, undefined)
})
