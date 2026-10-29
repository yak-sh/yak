import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { connector, fresh, letter, vocabFile } from './probe.ts'

let k = await fresh()
let agent = connector(k, k.owner.cookie)
await agent.tool('space_new', { slug: 'yourname', title: 'Demos' })
await agent.tool('space_new', { slug: 'home', title: 'Private home' })
let cases = ['skip', 'tool', 'web']
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

for (let app of cases) {
  test(`a private internal gallery listing gets an installable demo through ${app}`, async () => {
    if (app == 'skip') {
      await agent.tool('app_set', {
        space: 'home',
        app,
        gallery: true,
        review: false,
      })
    } else if (app == 'tool') {
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
    let shown = await connector(k).tool('gallery_search', { words: app })
    assertStringIncludes(shown, `app_install(name: 'private-${app}')`)
    let original = await k.at('home.yaks.app', `/${app}/`)
    assertEquals(original.status, 303)
    await original.body?.cancel()
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

test('relisting updates the demo offer and keeps its sample records', async () => {
  await agent.tool('app_set', {
    space: 'yourname',
    app: 'skip',
    access: 'public',
  })
  await agent.tool('graph_apply', {
    app: 'yourname/skip',
    entities: [{
      entity: { eid: crypto.randomUUID() },
      note: { body: 'Sample record' },
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
  let rows = await k.at('yourname.yaks.app', '/skip/api/query?q=.note')
  assertStringIncludes(await rows.text(), 'Sample record')
  let who = await k.at('yourname.yaks.app', '/skip/api/me').then((r) =>
    r.json()
  )
  assertEquals(who.writes, true)
  let offer = await agent.tool('app_published', { words: 'private-skip-demo' })
  assertStringIncludes(offer, 'v2')
})

let demos = await Promise.all(['bible-study', 'housebook'].map(async (app) => {
  let k = await fresh()
  let agent = connector(k, k.owner.cookie)
  await agent.tool('space_new', { slug: 'yourname', title: 'Demos' })
  await agent.tool('space_new', { slug: 'home', title: 'Private home' })
  let index = await Deno.readTextFile(
    new URL(`../../apps/${app}/demo/index.html`, import.meta.url),
  )
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
      { path: 'demo/index.html', content: index },
      {
        path: 'demo/seed.json',
        content: JSON.stringify([{
          entity: { eid: crypto.randomUUID() },
          note: { body: `Sample ${app}` },
        }]),
      },
      { path: 'demo/documents/care.txt', content: 'Sample care instructions' },
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
  await agent.tool('app_files', {
    ...at,
    path: 'release.txt',
    content: 'Source version two',
  })
  await agent.tool('app_deploy', at)
  return { app, at, index, k, agent }
}))

for (let { app, at, index, k, agent } of demos) {
  test(`${app}'s demo files and edited sample data survive a source republish`, async () => {
    let rows = await k.at('yourname.yaks.app', `/${app}/api/query?q=.note`)
      .then((r) => r.json())
    assertEquals(rows.length, 1)
    await agent.tool('graph_apply', {
      app: `yourname/${app}`,
      entities: [{
        entity: rows[0].entity,
        note: { body: 'A visitor edited this sample' },
      }],
    })
    await agent.tool('app_publish', at)
    let copied = await agent.tool('app_files', {
      space: 'yourname',
      app,
      op: 'read',
      path: 'index.html',
    })
    assertEquals(copied, index)
    let page = await k.at('yourname.yaks.app', `/${app}/`).then((r) => r.text())
    assertStringIncludes(
      page,
      app == 'housebook' ? 'data-demo' : 'A shared demo with sample studies.',
    )
    assertStringIncludes(
      await k.at('yourname.yaks.app', `/${app}/release.txt`).then((r) =>
        r.text()
      ),
      'Source version two',
    )
    assertStringIncludes(
      await k.at('yourname.yaks.app', `/${app}/documents/care.txt`).then((r) =>
        r.text()
      ),
      'Sample care instructions',
    )
    let kept = await k.at('yourname.yaks.app', `/${app}/api/query?q=.note`)
      .then((r) => r.json())
    assertEquals(kept.map((row: { note: { body: string } }) => row.note.body), [
      'A visitor edited this sample',
    ])
    let ordinary = await agent.tool('app_files', {
      space: 'home',
      app: `${app}-copy`,
      op: 'read',
      path: 'index.html',
    })
    assertEquals(
      ordinary,
      `<meta property="og:image" content="card.png"><h1>Private ${app}</h1>`,
    )
    let empty = await agent.tool('graph_query', {
      app: `home/${app}-copy`,
      filter: '.note',
    })
    assert(!empty.includes(`Sample ${app}`))
  })
}
