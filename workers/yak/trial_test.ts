// A trial of the Personal plan (D-476), through the whole kernel: a space
// whose trial is over builds nothing new, while one whose trial waits for its
// owner builds as it always did.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { connector, kernel, seed, unique } from './probe.ts'
import { PAUSED } from '@yaks/platform/standing'
import { owed } from './trial.ts'

let DAY = 86_400_000

test('a space whose trial is over builds nothing new; one paused while away still does', async () => {
  let k = await kernel()
  let slug = unique('tried')
  try {
    let { cookie, eids } = await seed(k, [{ slug, apps: ['one'] }])
    let agent = connector(k, cookie)
    let trial = (at: number, paused?: number) => ({
      entity: { eid: eids[slug] },
      plan_trial: {
        at: new Date(at).toISOString(),
        through: new Date(at + 30 * DAY).toISOString(),
        paused: paused == null ? null : new Date(paused).toISOString(),
        told: 'started',
      },
    })
    let now = Date.now()
    await k.dir.stamp({ entities: [trial(now - 40 * DAY)] })
    let made = () =>
      agent.tool('app_new', { space: slug, slug: 'two', title: 'Two' })
    await assertRejects(made, Error, PAUSED)
    await assertRejects(
      () => agent.tool('app_deploy', { space: slug, app: 'one' }),
      Error,
      `${slug}'s trial has ended`,
    )
    // Away since its tenth day: the clock stopped, so the trial is still on.
    await k.dir.stamp({ entities: [trial(now - 40 * DAY, now - 30 * DAY)] })
    assertStringIncludes(await made(), 'two')
  } finally {
    await k.stop()
  }
})

test('a trial is owed once a person: from when trials began, from birth, or over at birth', () => {
  let from = Date.parse('2026-12-01T00:00:00Z')
  let free = { tier: null, trashed: null }
  assertEquals(owed(free, from - DAY, true, from)?.told, '')
  assertEquals(
    owed(free, from - DAY, false, from)?.at,
    new Date(from).toISOString(),
  )
  assertEquals(owed(free, from + DAY, true, from)?.told, 'started')
  let later = owed(free, from + DAY, false, from)!
  assertEquals(later.at, later.through)
  assertEquals(
    owed({ tier: 'plus', trashed: null }, from - DAY, true, from),
    null,
  )
})
