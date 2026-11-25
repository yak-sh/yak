import { equal, ok, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { parseHTML } from 'linkedom'
import { appMaking, type DraftAction } from '@yaks/platform/app-canvas'
import { drawCanvas } from '@yaks/platform/app-canvas-browser'
import { DRAWN, REACH } from '@yaks/platform/page-graph'
import { connector, kernel, seed, signIn, unique } from './probe.ts'

test('the app lists every open draft and its actions name only that draft', async () => {
  let k = await kernel()
  let space = unique('drafts')
  let { cookie, person, eids } = await seed(k, [{
    slug: space,
    apps: ['garden'],
  }])
  let ben = await signIn(k)
  let app = eids[`${space}/garden`]
  let address = { space, app: 'garden' }
  let agent = connector(k, cookie)
  let write = async (files: Record<string, string>) =>
    (await agent.answer('app_files', {
      ...address,
      draft: 'new',
      files: Object.entries(files).map(([path, content]) => ({
        path,
        content,
      })),
    })).value!.draft as string
  let deploy = (draft: string) =>
    agent.answer('app_deploy', { ...address, draft })
  await deploy(await write({ 'index.html': '<h1>Garden v1</h1>' }))
  let legacy = await write({
    'notes.html': '<p>Notes</p>',
    'beds.css': 'p{color:green}',
  })
  let left = await write({ 'index.html': '<h1>Draft garden</h1>' })
  let row = (await k.dir.appAt(app))!.app
  let edited = new Date(Date.now() - 2 * 3_600_000).toISOString()
  await k.dir.stamp({
    entities: [
      { entity: { eid: person }, doc: { title: 'Ana Martin' } },
      { entity: { eid: ben.person }, doc: { title: 'Ben Reyes' } },
      {
        entity: { eid: legacy },
        app_draft: { by: null, via: null, at: edited },
      },
      { entity: { eid: left }, app_draft: { at: edited } },
      ...[
        ...(await k.dir.written(row, legacy)),
        ...(await k.dir.written(row, left)),
      ]
        .map((w) => ({
          entity: { eid: w.eid },
          written: {
            at: edited,
            ...w.path == 'beds.css' ? { by: ben.person } : {},
          },
        })),
    ],
  })
  await deploy(await write({ 'index.html': '<h1>Garden v2</h1>' }))

  let get = (path: string, as = cookie) =>
    k.at(k.host, path, { headers: { cookie: as }, redirect: 'manual' })
  let canvas = async () => {
    let page = await get(`/${space}?app=garden`)
    equal(page.status, 200)
    let { document } = parseHTML(await page.text())
    let root = document.querySelector<HTMLElement>('[data-canvas-view]')!
    let q = new URLSearchParams({ q: appMaking(app) })
    let making = await (await get(`${REACH}/query?${q}`)).json() as Bundle[]
    drawCanvas(root, {
      apps: JSON.parse(document.querySelector(DRAWN)!.textContent!).rows,
      making,
    })
    return root
  }
  let act = (act: DraftAction['act'], draft: string, as = cookie) =>
    k.at(k.host, `${REACH}/apply`, {
      method: 'POST',
      headers: { cookie: as, 'content-type': 'application/json' },
      body: JSON.stringify([{
        entity: { eid: crypto.randomUUID() },
        appDraftAct: { app, draft, act },
      }]),
    })

  let root = await canvas()
  equal(
    root.querySelector('iframe')?.getAttribute('src'),
    `https://${space}.yaks.app/garden/`,
  )
  let drafts = root.querySelectorAll('[aria-label="Open drafts"] li')
  equal(
    [...drafts].map((r) => r.getAttribute('data-key')).sort(),
    [legacy, left].sort(),
  )
  let migrated = root.querySelector(`[data-key="${legacy}"]`)!
  let older = root.querySelector(`[data-key="${left}"]`)!
  for (
    let text of [
      'Ana Martin',
      'Ben Reyes',
      'Edited 2 hours ago',
      'beds.css, notes.html',
      'Behind live',
    ]
  ) {
    ok(migrated.textContent!.includes(text), migrated.textContent!)
  }
  ok(older.textContent!.includes('Also changed in a release · index.html'))
  let link = older.querySelector('a')!.getAttribute('href')!
  ok((await get(link, ben.cookie)).status >= 400)
  ok((await act('discard', left, ben.cookie)).status >= 400)
  let preview = await get(link)
  equal(preview.status, 303)
  let at = new URL(preview.headers.get('location')!)
  let draftPage = await k.at(at.host, at.pathname)
  ok((await draftPage.text()).includes('<h1>Draft garden</h1>'))

  equal((await act('discard', legacy)).status, 200)
  equal(
    (await canvas()).querySelectorAll('[aria-label="Open drafts"] li').length,
    1,
  )
  let released = await act('release', left)
  let answer = await released.json()
  equal(released.status, 200, JSON.stringify(answer))
  equal(answer[0].appDraftActed.said, 'Released v3.')
  equal((await act('discard', left)).status, 404)
  equal(
    (await canvas()).querySelector('[data-part=drafts]')?.textContent,
    'No open drafts.',
  )
  let page = await k.at(at.host, '/garden/')
  ok((await page.text()).includes('<h1>Draft garden</h1>'))
})
