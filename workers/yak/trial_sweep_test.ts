// The trial sweep (trial.ts) over a platform in memory: nothing until
// `TRIALS` says trials began, then a space made before that moment is given
// its trial with its notice, and an owner away for a week stops its clock.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { line } from '@yaks/query'
import { platform } from './testing.ts'
import { directory, fetch, stamp } from './directory.ts'
import { bound } from './env.ts'
import { KERNEL, meta } from './meta.ts'
import { trials } from './trial.ts'

let DAY = 86_400_000
let FROM = '2026-12-01T00:00:00.000Z'

test('the sweep starts a trial at the moment trials began, then stops its clock a week after its owner was last seen', async () => {
  let start = async (vars: Record<string, string>) => {
    let p = platform(`trial sweep ${Object.keys(vars).length}`, {
      MAIL_TOKEN: 'test',
      MAIL_API: 'https://mail.invalid',
      ...vars,
    })
    let dir = directory(bound(p.env.DIRECTORY, fetch, p.env))
    let person = crypto.randomUUID()
    await stamp(p.env, {
      entities: [{
        entity: { eid: person },
        person: {},
        email: { address: 'ada@example.com' },
        signed_in: { at: '2026-11-20T00:00:00.000Z', via: 'code' },
      }],
    })
    let space = await dir.mint(person, 'ada', 'Ada', KERNEL)
    let trial = async () =>
      (await meta(p.env).query(line`.entity.eid=${space}&?plan_trial`))[0]
        ?.plan_trial as Record<string, string | null> | undefined
    return { p, trial }
  }

  let off = await start({})
  assertEquals(await trials(off.p.env, new Date(FROM)), 0)
  assertEquals(await off.trial(), undefined)

  let { p, trial } = await start({ TRIALS: FROM })
  // Made before trials began, and its owner last seen 11 days before: its
  // trial starts at that moment, already waiting for them, with the notice
  // owed and sent.
  assertEquals(await trials(p.env, new Date(Date.parse(FROM) + DAY)), 1)
  let t = await trial()
  assertEquals(t?.at, FROM)
  assertEquals(t?.paused, FROM)
  assertEquals(t?.told, 'started')
  // Kept again, nothing new is owed.
  assertEquals(await trials(p.env, new Date(Date.parse(FROM) + 2 * DAY)), 0)
})
