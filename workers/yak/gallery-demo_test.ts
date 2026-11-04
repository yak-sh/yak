import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { connector, fresh, letter, owned, vocabFile } from './probe.ts'
import { ServingCopy } from './serving-copy.ts'
import type { ServingCopyDoor } from './directory-copy.ts'
import { directoryOf } from './directory.ts'

let copy = new ServingCopy({
  persistence: { read: () => undefined, write: () => {} },
})
let rpc: ServingCopyDoor = {
  begin: (floor) => Promise.resolve(copy.begin(floor)),
  finish: (revision) => Promise.resolve(copy.finish(revision)),
  revision: () => Promise.resolve(copy.revision),
  settle: (revision, committed) =>
    Promise.resolve(copy.settle(revision, committed)),
  put: (...args) => Promise.resolve(copy.put(...args)),
  get: (key) => Promise.resolve().then(() => copy.get(key)),
  valid: (revision) => Promise.resolve(copy.valid(revision)),
  publish: (...args) => Promise.resolve(copy.publish(...args)),
}
let dir!: ReturnType<typeof directoryOf>
let k = await fresh({
  SERVING_COPY: { idFromName: (name) => name, get: () => rpc },
}, (env) => {
  dir = directoryOf(env.STORE)
})
let agent = connector(k, k.owner.cookie)
await owned(k, k.owner.person, 'yourname', 'Demos')
await owned(k, k.owner.person, 'home', 'Private home')
let cases = ['skip', 'tool', 'web', 'resume']
for (let app of cases) {
  await agent.tool('app_new', {
    space: 'home',
    slug: app,
    title: app,
    access: 'private',
  })
  await agent.tool('app_files', {
    space: 'home',
    app,
    files: [
      {
        path: 'index.html',
        content: `<meta property="og:image" content="card.png"><h1>${app}</h1>`,
      },
      {
        path: 'vocab.json',
        content: vocabFile({ note: { body: { type: 'string' } } }),
      },
    ],
  })
  await agent.tool('app_deploy', { space: 'home', app })
  await agent.tool('graph_apply', {
    app: `home/${app}`,
    entities: [{
      entity: { eid: crypto.randomUUID() },
      note: { body: 'Private records stay home' },
    }],
  })
  await agent.tool('app_publish', {
    space: 'home',
    app,
    name: `private-${app}`,
    gallery: app != 'skip',
  })
}

let home = (await dir.space('home'))!
let demosSpace = (await dir.space('yourname'))!
let source = (await dir.app(home, 'resume'))!
await agent.tool('app_new', {
  space: 'yourname',
  slug: 'resume',
  title: 'Interrupted copy',
  access: 'open',
})
let partial = (await dir.app(demosSpace, 'resume'))!
await dir.stamp({
  entities: [{
    entity: { eid: partial.eid },
    installed: { of: source.eid, version: source.published!.version },
  }],
})

for (let app of cases) {
  test(`a private internal gallery listing gets an installable demo through ${app}`, async () => {
    if (app == 'skip') {
      await agent.tool('app_set', {
        space: 'home',
        app,
        gallery: true,
        review: false,
      })
    } else if (app == 'tool' || app == 'resume') {
      await agent.tool('gallery_review', {
        app: `home/${app}`,
        decision: 'approve',
      })
    } else {
      let mail = await letter(k, 'hello@yaks.app', app)
      let yes =
        mail.body.match(/https:\/\/yaks\.app\/gallery\/review\?t=([^\s]+)/)![1]
      let response = await k.at('yaks.app', '/gallery/review', {
        method: 'POST',
        headers: { cookie: k.owner.cookie },
        body: new URLSearchParams({ t: decodeURIComponent(yes) }),
      })
      assertEquals(response.status, 200)
      await response.body?.cancel()
    }
    let page = await k.at('yaks.app', '/gallery').then((r) => r.text())
    assertStringIncludes(page, `https://yourname.yaks.app/${app}/`)
    assertStringIncludes(page, `/install?name=private-${app}`)
    let shown = await connector(k, undefined, undefined, '/mcp?auth=mixed')
      .tool('gallery_search', { words: app })
    assertStringIncludes(shown, `app_install(name: 'private-${app}')`)
    // A stranger at the private original, or at its copy, is served its
    // sample, never its records (visit.ts).
    let original = await k.at('home.yaks.app', `/${app}/api/query?q=.note`)
    assertEquals(original.status, 200)
    assertEquals(await original.json(), [])
    let demo = await k.at('yourname.yaks.app', `/${app}/`)
    assertEquals(demo.status, 200)
    await demo.body?.cancel()
    let rows = await k.at('yourname.yaks.app', `/${app}/api/query?q=.note`)
    assertEquals(rows.status, 200)
    assertEquals(await rows.json(), [])
    await agent.tool('app_set', {
      space: 'home',
      app,
      gallery: true,
      review: false,
    })
    let apps = await agent.tool('app_list', { space: 'yourname' })
    assert(!apps.includes(`/${app}-2/`), 'listing again reuses the copy')
  })
}

test('relisting updates the demo copy and keeps its records', async () => {
  await agent.tool('graph_apply', {
    app: 'yourname/skip',
    entities: [{
      entity: { eid: crypto.randomUUID() },
      note: { body: 'Copy record' },
    }],
  })
  await agent.tool('app_files', {
    space: 'home',
    app: 'skip',
    path: 'index.html',
    content: '<h1>Updated manual</h1>',
  })
  await agent.tool('app_deploy', { space: 'home', app: 'skip' })
  await agent.tool('app_publish', { space: 'home', app: 'skip', gallery: true })
  let demo = await k.at('yourname.yaks.app', '/skip/')
  assertStringIncludes(await demo.text(), 'Updated manual')
  let copied = await agent.tool('app_files', {
    space: 'yourname',
    app: 'skip',
    path: 'index.html',
    op: 'read',
  })
  assertStringIncludes(copied, 'Updated manual')
  assertStringIncludes(
    await agent.tool('graph_query', { app: 'yourname/skip', filter: '.note' }),
    'Copy record',
  )
  let rows = await k.at('yourname.yaks.app', '/skip/api/query?q=.note')
  assertEquals(await rows.json(), [])
  let who = await k.at('yourname.yaks.app', '/skip/api/me').then((r) =>
    r.json()
  )
  assertEquals([who.role, who.writes], ['viewer', true])
  let offer = await agent.tool('app_published', { words: 'private-skip-demo' })
  assertStringIncludes(offer, 'v2')
})

let demos = await Promise.all(['bible-study', 'housebook'].map(async (app) => {
  let k = await fresh()
  let agent = connector(k, k.owner.cookie)
  await owned(k, k.owner.person, 'yourname', 'Demos')
  await owned(k, k.owner.person, 'home', 'Private home')
  let at = { space: 'home', app }
  await agent.tool('app_new', {
    ...at,
    slug: app,
    title: app,
    access: 'private',
  })
  await agent.tool('app_files', {
    ...at,
    files: [
      {
        path: 'index.html',
        content:
          `<meta property="og:image" content="card.png"><h1>Private ${app}</h1>`,
      },
      {
        path: 'vocab.json',
        content: vocabFile({ note: { body: { type: 'string' } } }),
      },
      {
        path: 'seed.json',
        content: JSON.stringify([{
          entity: { eid: crypto.randomUUID() },
          note: { body: `Sample ${app}` },
        }]),
      },
      { path: 'samples/care.txt', content: 'Sample care instructions' },
    ],
  })
  await agent.tool('app_deploy', at)
  await agent.tool('app_publish', {
    ...at,
    name: `private-${app}`,
    gallery: true,
  })
  await agent.tool('gallery_review', {
    app: `home/${app}`,
    decision: 'approve',
  })
  await agent.tool('app_install', {
    space: 'home',
    name: `private-${app}`,
    as: `${app}-copy`,
  })
  return { app, k, agent }
}))

let notes = (rows: { note: { body: string } }[]) =>
  rows.map((row) => row.note.body)

for (let { app, k, agent } of demos) {
  test(`${app}'s demo copy shows strangers its seed, as every install starts`, async () => {
    let at = (path: string) => k.at('yourname.yaks.app', `/${app}/${path}`)
    assertEquals(
      notes(await at('api/query?q=.note').then((r) => r.json())),
      [`Sample ${app}`],
    )
    assertStringIncludes(await at('').then((r) => r.text()), `Private ${app}`)
    assertEquals(
      await at('samples/care.txt').then((r) => r.text()),
      'Sample care instructions',
    )
    assertStringIncludes(
      await agent.tool('graph_query', {
        app: `home/${app}-copy`,
        filter: '.note',
      }),
      `Sample ${app}`,
    )
  })
}

test('an app of the demo space is its own demo: listing it makes no copy', async () => {
  await agent.tool('app_new', {
    space: 'yourname',
    slug: 'own',
    title: 'own',
    access: 'private',
  })
  await agent.tool('app_files', {
    space: 'yourname',
    app: 'own',
    path: 'index.html',
    content: '<meta property="og:image" content="card.png"><h1>own</h1>',
  })
  await agent.tool('app_deploy', { space: 'yourname', app: 'own' })
  await agent.tool('app_publish', { space: 'yourname', app: 'own' })
  await agent.tool('app_set', {
    space: 'yourname',
    app: 'own',
    gallery: true,
    review: false,
  })
  let apps = await agent.tool('app_list', { space: 'yourname' })
  assert(!apps.includes('/own-2/'), apps)
})
