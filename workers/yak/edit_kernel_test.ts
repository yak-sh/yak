// The pencil end to end, through a kernel: an owner's page of an app with no
// vocab of its own wears it and a stranger's does not, and the app's store
// keeps the owner's draft of a snippet as edit mode types it.
import { equal, ok, test } from '@yaks/testing'
import { connector, kernel, seed, unique } from './probe.ts'
import { draftEid } from '@yaks/draft'
import { placeOf } from './edit-mode.ts'

let k = await kernel()
let space = unique('edit')
let { cookie, person } = await seed(k, [{ slug: space, apps: ['site'] }])
let agent = connector(k, cookie)
let app = { space, app: 'site' }
await agent.tool('app_files', {
  ...app,
  files: [{ path: 'index.html', content: '<h1 data-copy="hero">Hi</h1>' }],
})
await agent.tool('app_deploy', app)
let host = `${space}.yaks.app`
let page = async (cookie?: string) =>
  await (await k.at(host, '/site/', cookie ? { headers: { cookie } } : {}))
    .text()
let [owned, strangers] = [await page(cookie), await page()]
let eid = draftEid(person, placeOf('hero'))
let kept = await k.at(host, '/site/api/apply', {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify([{
    entity: { eid },
    draft: { by: person, place: placeOf('hero'), text: 'Hello' },
    typed: { over: '' },
  }]),
})
let read = await k.at(host, `/site/api/query?.draft.by=${person}`, {
  headers: { cookie },
})

test("an owner's page wears the pencil, and a stranger's does not", () => {
  ok(owned.includes('data-yak-edit="'))
  ok(owned.includes(`/manage/${space}?app=site`))
  ok(!strangers.includes('data-yak-edit'))
})

test('an app with no vocab of its own keeps a snippet draft', async () => {
  equal(kept.status, 200, await kept.clone().text())
  let rows = JSON.stringify(await read.json())
  ok(rows.includes('"Hello"'), rows)
})
