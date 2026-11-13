// Save and Undo in edit mode (save.ts), through a kernel: an owner's drafted
// snippets set in copy.json and released, two saves each keeping the other's,
// the app's other unreleased edits left in its draft, and Undo going back.
import { equal, ok, test } from '@yaks/testing'
import { connector, kernel, seed, unique } from './probe.ts'

let k = await kernel()
let space = unique('save')
let { cookie } = await seed(k, [{ slug: space, apps: ['site'] }])
let agent = connector(k, cookie)
let app = { space, app: 'site' }
await agent.tool('app_files', {
  ...app,
  files: [
    {
      path: 'index.html',
      content: '<h1 data-copy="hero"></h1><p data-copy="note"></p>',
    },
    { path: 'copy.json', content: '{\n  "hero": "Hi",\n  "note": "Old"\n}\n' },
  ],
})
await agent.tool('app_deploy', app)
// Somebody's edit, not yet released.
await agent.tool('app_files', { ...app, path: 'about.html', content: 'About' })

let host = `${space}.yaks.app`
let post = async (path: string, body: unknown, as = cookie) => {
  let r = await k.at(host, `/site/api/${path}`, {
    method: 'POST',
    headers: {
      ...as ? { cookie: as } : {},
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json() }
}
let page = async () => await (await k.at(host, '/site/')).text()
let shows = (html: string, hero: string, note: string) =>
  ok(html.includes(`>${hero}</h1>`) && html.includes(`>${note}</p>`), html)

let first = await post('save', { copy: { hero: 'Hello' } })
let second = await post('save', { copy: { note: 'New' } })
let saved = await page()
let again = await post('save', { copy: { note: 'New' } })
let listed = (await agent.answer('app_files', { ...app, op: 'list' }))
  .value as {
    unreleased: boolean
    files: { path: string }[]
  }
let history = await agent.tool('app_versions', app)
let undo = await post('save/undo', { version: 3 })
let undone = await page()
let late = await post('save/undo', { version: 3 })
let refused = [
  await post('save', { copy: { hero: 'x' } }, ''),
  await post('save', { copy: {} }),
  await post('save', { copy: { hero: 3 } }),
].map((r) => r.status)
let after = await page()

test('each save sets its snippets in the live copy.json and releases it', () => {
  equal(first, { status: 200, body: { version: 2, keys: ['hero'] } })
  equal(second, { status: 200, body: { version: 3, keys: ['note'] } })
  shows(saved, 'Hello', 'New')
})

test('a save sent again changes nothing and releases nothing', () => {
  equal(again, { status: 200, body: { version: 3, keys: [] } })
})

test("it releases only the copy: the draft's other edits stay unreleased", () => {
  ok(listed.unreleased)
  ok(listed.files.some((f) => f.path == 'about.html'))
  ok(!saved.includes('About'))
})

test('the release names the snippets it changed, and who saved it', () => {
  ok(history.includes('Saved on the page: note in copy.json'), history)
  ok(/→ v3 \S+ by you/.test(history), history)
})

test('undo takes the save back while it is live, and only then', () => {
  equal(undo, { status: 200, body: { version: 2 } })
  shows(undone, 'Hello', 'Old')
  equal(late.body.error.message, 'v3 is no longer live')
})

test('a stranger, and a save naming no snippets, are refused', () => {
  equal(refused, [401, 400, 400])
  shows(after, 'Hello', 'Old')
})
