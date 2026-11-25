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
      content: '<h1 data-copy="hero"></h1><p data-copy="note"></p>' +
        '<ul data-copy-list="always"><li class="Item">Members</li></ul>',
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
  await post('save', { copy: { always: ['One', 3] } }),
].map((r) => r.status)
let after = await page()
let list = await post('save', { copy: { always: ['Members', 'Guests'] } })
let grown = await page()

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
  equal(refused, [401, 400, 400, 400])
  shows(after, 'Hello', 'Old')
})

test('a list is saved whole, and its page has an item for each', () => {
  equal(list, { status: 200, body: { version: 4, keys: ['always'] } })
  ok(
    grown.includes(
      '<ul data-copy-list="always"><li class="Item">Members</li>' +
        '<li class="Item">Guests</li></ul>',
    ),
    grown,
  )
})

let privateSpace = unique('private-save')
let privateOwner = await seed(k, [{ slug: privateSpace, apps: ['site'] }])
let privateAgent = connector(k, privateOwner.cookie)
let privateApp = { space: privateSpace, app: 'site' }
await privateAgent.tool('app_set', { ...privateApp, access: 'private' })
await privateAgent.tool('app_files', {
  ...privateApp,
  files: [
    {
      path: 'index.html',
      content: '<h1 data-copy="hero"></h1><p data-copy="note"></p>',
    },
    { path: 'copy.json', content: '{"hero":"Hi","note":"Old"}' },
  ],
})
await privateAgent.tool('app_deploy', privateApp)

test('concurrent private page saves reuse the live declaration and merge both edits', async () => {
  let at = (path: string, init: RequestInit = {}) =>
    k.at(
      privateSpace + '.yaks.app',
      '/site/' + path,
      {
        ...init,
        headers: {
          cookie: privateOwner.cookie,
          'content-type': 'application/json',
        },
      },
    )
  let current = async () =>
    (await k.dir.app(
      (await k.dir.space(privateSpace))!,
      'site',
    ))!
  let before = await current()
  let save = async (copy: Record<string, string>) => {
    let response = await at('api/save', {
      method: 'POST',
      body: JSON.stringify({ copy }),
    })
    let answer = await response.json()
    equal(response.status, 200, JSON.stringify(answer))
    return answer.version as number
  }
  let versions = await Promise.all([
    save({ hero: 'Hello' }),
    save({ note: 'New' }),
  ])
  equal(versions.sort(), [2, 3])
  let after = await current()
  equal(after.declaration, before.declaration)
  shows(await (await at('')).text(), 'Hello', 'New')
  equal(await save({ note: 'New' }), 3)
  let undo = await at('api/save/undo', {
    method: 'POST',
    body: '{"version":3}',
  })
  equal(await undo.json(), { version: 2 })
  let newVersion = await save({ hero: 'Again' })
  equal(newVersion, 4)
})
