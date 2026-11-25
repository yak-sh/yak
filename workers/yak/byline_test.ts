// A paid space's line at the foot of its pages, "Website by yaks.app"
// (@yaks/platform/woven `bylineOf`): off unless its owner turns it on, with
// space_set or on the Settings page.
import { equal, ok, test } from '@yaks/testing'
import { connector, fresh, seed, spaceAct } from './probe.ts'
import { stamp } from './directory.ts'
import type { Env } from './env.ts'
import { managePath } from '@yaks/platform/routes'

let env!: Env
let k = await fresh({}, (e) => env = e)
let them = await seed(k, [{ slug: 'oak-church', apps: ['site'] }])
let eid = them.eids['oak-church']
let agent = connector(k, them.cookie)
let on = async () => !!(await k.dir.at(eid))!.byline
let settings = () =>
  k.at(k.host, managePath('settings', 'oak-church'), {
    headers: { cookie: them.cookie },
  })

test('an owner turns the line on with space_set or in Settings, which offers it on a paid plan alone', async () => {
  equal(await on(), false)
  ok(!(await (await settings()).text()).includes('Website by yaks.app'))
  ok(
    (await agent.tool('space_set', { space: 'oak-church', byline: true }))
      .includes('once it is on a paid plan'),
  )
  equal(await on(), true)

  await stamp(env, { entities: [{ entity: { eid }, plan: { tier: 'pro' } }] })
  let page = await (await settings()).text()
  ok(page.includes('Website by yaks.app'))
  ok(/name="byline" value="on" checked/.test(page))
  // Settings' Save bar writes the box as ticked or not: unticked, the line
  // comes off; ticked, back on; saved again unchanged, it stays.
  let save = async (set: Record<string, unknown>, after: boolean) => {
    let saved = await spaceAct(k, them, eid, { spaceSettings: set })
    equal(saved.status, 200, await saved.text())
    equal(await on(), after)
  }
  await save({ title: 'Oak Church', byline: false }, false)
  await save({ title: 'Oak Church', byline: false }, false)
  await save({ byline: true }, true)
  await save({ title: 'Oak Church', byline: true }, true)
})
