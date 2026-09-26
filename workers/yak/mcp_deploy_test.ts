// The connector through the whole kernel (probe.ts `kernel`), by subject.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { connector, kernel, meta, seed, signIn } from './probe.ts'

// The whole of T-32907 (C-32905 items 1 and 3): an app's own files never name
// the app. Its pages say `./api/client.js` and `./style.css`, the kernel gives
// every page it serves a `<base href>` at the app's own address, and the copy
// someone installs works at whatever address it took — including from a pretty
// path, where a relative URL would otherwise resolve against the page's depth.
// Before this, an install under another name served bare HTML: no stylesheet,
// no script, and nothing said so.
Deno.test('an app names no app, and the copy works at its own address', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let his = connector(k, jeff.cookie)
    let write = (path: string, content: string) =>
      his.tool('app_files', { app: 'chores', op: 'write', path, content })
    await his.tool('app_new', { slug: 'chores', title: 'Chores' })
    await write(
      'index.html',
      '<!doctype html><html><head>' +
        '<link rel="stylesheet" href="./style.css">' +
        '<script type="module" src="./api/client.js"></script>' +
        '</head><body><h1>Chores</h1></body></html>',
    )
    await write('style.css', 'h1 { color: rebeccapurple }')
    // A page that answers for its own addresses keeps its own base, and is
    // given no second one — the first in tree order is the document's.
    await write(
      'own.html',
      '<!doctype html><html><head><base href="/elsewhere/">' +
        '</head><body>mine</body></html>',
    )
    await his.tool('app_deploy', { app: 'chores' })
    // Published under a name that is not its slug, which is what renamed the
    // copy out from under its own code.
    await his.tool('app_publish', { app: 'chores', name: 'chore-chart' })
    // The offer says what it will be called.
    assertStringIncludes(await his.tool('app_published'), 'installs as chores')

    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    let hers = connector(k, ann.cookie)
    let space = ann.email.split('@')[0]
    let host = `${space}.yaks.app`
    assertStringIncludes(
      await hers.tool('app_install', { name: 'chore-chart', as: 'sisters' }),
      `as ${space}/sisters`,
    )

    // Her page, at the app's root and at a pretty path under it: what a
    // browser would resolve every relative address to, fetched.
    for (let at of ['/sisters/', '/sisters/week/2']) {
      let r = await k.at(host, at)
      assertEquals(r.status, 200)
      let html = await r.text()
      assertStringIncludes(html, '<h1>Chores</h1>')
      // The reporter still rides along, at her address.
      assertStringIncludes(html, '/sisters/api/report.js')
      let base = /<base href="([^"]+)">/.exec(html)?.[1]
      assertEquals(base, '/sisters/', at)
      for (
        let [href, type] of [
          ['./api/client.js', /javascript/],
          ['./style.css', /css/],
        ] as [string, RegExp][]
      ) {
        let to = new URL(href, new URL(base!, `https://${host}${at}`))
        let got = await k.at(host, to.pathname)
        assertEquals(got.status, 200, `${at} -> ${to.pathname}`)
        assertMatch(got.headers.get('content-type') ?? '', type)
      }
    }

    // The page that brought its own base keeps it, alone.
    let own = await (await k.at(host, '/sisters/own.html')).text()
    assertEquals(own.split('<base').length - 1, 1)
    assertStringIncludes(own, '<base href="/elsewhere/">')

    // With no address asked for, a copy lands at the app's own slug — the one
    // its code was written at — and falls back to the published name when
    // that address is already spoken for here.
    assertStringIncludes(
      await hers.tool('app_install', { name: 'chore-chart' }),
      `as ${space}/chores`,
    )
    assertStringIncludes(
      await hers.tool('app_install', { name: 'chore-chart' }),
      `as ${space}/chore-chart`,
    )
  } finally {
    await k.stop()
  }
})

// Putting an app back (T-32886, V-32361: error-correction over initial
// correctness). The person's own repair when their assistant breaks a working
// page is "put it back", so every deploy is a version and one word restores
// one — as a new version, since history is never rewritten.
Deno.test('a deploy is a version, and one word puts it back', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: 'undo31', apps: ['recipes'] }])
    let agent = connector(k, cookie)
    let app = { space: 'undo31', app: 'recipes' }
    let served = async (path: string) => {
      let r = await k.at('undo31.yaks.app', `/recipes/${path}`)
      return { status: r.status, text: await r.text() }
    }

    // v1: a page that works.
    await agent.tool('app_files', {
      ...app,
      files: [{ path: 'index.html', content: '<h1>lemon cake</h1>' }],
    })
    assertMatch(await agent.tool('app_deploy', app), /v1/)

    // v2: the change that broke it, with a file that did not exist before.
    await agent.tool('app_files', {
      ...app,
      files: [
        { path: 'index.html', content: '<h1>OOPS</h1>' },
        { path: 'broken.js', content: 'throw new Error("no")' },
      ],
    })
    assertMatch(await agent.tool('app_deploy', app), /v2/)
    assertStringIncludes((await served('')).text, 'OOPS')

    // What it has to pick from: newest first, with what each deploy changed.
    let list = await agent.tool('app_versions', app)
    assertStringIncludes(list, 'undo31/recipes: 2 versions')
    // When it went out, off the row's own created stamp.
    assertMatch(list, /- v2 \(live\) 20\d\d-\d\d-\d\dT/)
    assertStringIncludes(list, 'added broken.js, changed index.html')

    // One word. It names what came back and where, and goes out as v3.
    let back = await agent.tool('app_rollback', app)
    assertStringIncludes(back, 'put undo31/recipes back to v1, live now as v3')
    assertStringIncludes(back, 'https://undo31.yaks.app/recipes/')
    assertStringIncludes(back, 'changed index.html, removed broken.js')

    // The page is v1's own bytes again — the kernel adds its reporter to
    // every page it serves (apps.ts), so the bytes are read back as the file
    // and seen in what it serves — and the file v2 added is gone.
    assertEquals(
      await agent.tool('app_files', { ...app, op: 'read', path: 'index.html' }),
      '<h1>lemon cake</h1>',
    )
    assertStringIncludes((await served('')).text, '<h1>lemon cake</h1>')
    assertEquals((await served('broken.js')).status, 404)

    // History is not rewritten: three versions, and v2 is still there to go
    // forward to by name.
    let after = await agent.tool('app_versions', app)
    assertStringIncludes(after, 'undo31/recipes: 3 versions')
    assertStringIncludes(after, 'v3 (live)')
    assertMatch(
      await agent.tool('app_rollback', { ...app, version: 2 }),
      /put undo31\/recipes back to v2, live now as v4/,
    )
    assertStringIncludes((await served('')).text, 'OOPS')
    assertEquals((await served('broken.js')).status, 200)

    // A version it never had is a refusal that says which it keeps, and the
    // bytes a version pins are the platform's business, never a file the
    // person wrote.
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_rollback', { ...app, version: 9 }),
        Error,
      )).message,
      'no v9 of undo31/recipes — it keeps v4, v3, v2, v1',
    )
    assertEquals(
      (await agent.tool('app_files', { ...app, op: 'list' })).split('\n')
        .sort(),
      ['broken.js', 'index.html'],
    )

    // A size down from a deploy: every write keeps what it replaced
    // (versions.ts, T-34508). The page has been written three times by now, so
    // the path can already answer its own past.
    let past = await agent.tool('app_files', {
      ...app,
      op: 'history',
      path: 'index.html',
    })
    assertStringIncludes(past, 'index.html in undo31/recipes:')
    assertMatch(past, /now — 13 B, sha256 [0-9a-f]{64}/)
    assertMatch(past, /- until 20\d\d-\d\d-\d\dT[\d:.]+Z — 19 B, sha256 /)
    // Undo the last write, with nothing to remember: the newest entry.
    assertStringIncludes(
      await agent.tool('app_files', {
        ...app,
        op: 'restore',
        path: 'index.html',
      }),
      'put index.html back to what it was until',
    )
    // A restore is itself a write, so the history grew rather than being
    // rewritten, and the bytes it replaced are the newest thing on it.
    assertEquals(
      (await agent.tool('app_files', {
        ...app,
        op: 'read',
        path: 'index.html',
      }))
        .trim(),
      '<h1>lemon cake</h1>',
    )
    assert(
      (await agent.tool('app_files', {
        ...app,
        op: 'history',
        path: 'index.html',
      })).split('\n').length >
        past.split('\n').length,
    )
    // A file deleted is kept the same way, and comes back by the same word.
    await agent.tool('app_files', {
      ...app,
      op: 'delete',
      path: 'broken.js',
    })
    await agent.tool('app_files', { ...app, op: 'restore', path: 'broken.js' })
    assertEquals(
      await agent.tool('app_files', { ...app, op: 'read', path: 'broken.js' }),
      'throw new Error("no")',
    )
    // A path nothing has ever replaced says so rather than answering nothing.
    assertStringIncludes(
      (await assertRejects(
        () =>
          agent.tool('app_files', {
            ...app,
            op: 'restore',
            path: 'nothing.css',
          }),
        Error,
      )).message,
      'nothing has replaced it',
    )

    // And the other half of the same word (recover.ts, T-34507): the store's
    // way back. With no moment named it says the window and does nothing —
    // which is all this can be held to here, because no runtime this runs on
    // moves SQLite backwards (testing.ts `Pitr`).
    let window = await agent.tool('store_restore', app)
    assertStringIncludes(window, "undo31/recipes's store can be put back")
    assertMatch(window, /any moment since 20\d\d-\d\d-\d\dT/)
    assertStringIncludes(window, "store_restore(app: 'recipes', at:")
    // A moment outside the thirty days is refused before the store is asked
    // anything, and the refusal names the window rather than saying no.
    assertStringIncludes(
      (await assertRejects(
        () =>
          agent.tool('store_restore', { ...app, at: '2020-01-01T00:00:00Z' }),
        Error,
      )).message,
      'outside the 30-day window',
    )
  } finally {
    await k.stop()
  }
})

// After a rollback the answers agree (T-32910, C-32905 items 5 and 6): the
// list says which version is live and which one this version put back, and it
// says it right after the write. The directory's read cache is 30 seconds
// wide and private to an isolate, so a deploy made anywhere else is invisible
// to an ordinary read — which is why the tool tier reads fresh (directory.ts).
Deno.test(
  'after a rollback, the list says what is live and what came back',
  async () => {
    let k = await kernel()
    try {
      let { cookie, eids } = await seed(k, [{
        slug: 'back32',
        apps: ['recipes'],
      }])
      let agent = connector(k, cookie)
      let app = { space: 'back32', app: 'recipes' }
      let file = (content: string) =>
        agent.tool('app_files', {
          ...app,
          files: [{ path: 'index.html', content }],
        })

      await file('<h1>lemon cake</h1>')
      await agent.tool('app_deploy', app)
      await file('<h1>OOPS</h1>')
      await agent.tool('app_deploy', app)
      assertStringIncludes(
        await agent.tool('app_rollback', app),
        'back to v1, live now as v3',
      )

      // A version a rollback made says so, beside what it changed to do it.
      let list = await agent.tool('app_versions', app)
      assertMatch(
        list,
        /- v3 \(live\) 20\d\d-\d\d-\d\dT.* — restored v1, changed index\.html/,
      )
      // And the ones that put nothing back say only what they changed.
      assert(!/- v2 .*restored/.test(list), 'v2 restored nothing')
      assert(!/- v1 .*restored/.test(list), 'v1 restored nothing')

      // Serving the app warms the read cache; a version bump through the graph
      // tier is NOT the door that empties it, so the kernel is now holding a
      // version the app has moved past — exactly as it is in the seconds after
      // somebody else's deploy.
      await (await k.at('back32.yaks.app', '/recipes/')).body?.cancel()
      await meta(k).apply([
        { entity: { eid: eids['back32/recipes'] }, app: { version: 4 } },
        {
          entity: { eid: '$deploy' },
          deploy: {
            app: eids['back32/recipes'],
            version: 4,
            files: '{"index.html":"beef"}',
            worker: '',
          },
        },
      ])
      let after = await agent.tool('app_versions', app)
      assertStringIncludes(after, 'v4 (live)')
      assert(!after.includes('v3 (live)'), 'the answer is not a cache old')
    } finally {
      await k.stop()
    }
  },
)

// With no token there is nothing to read, and the agent is told so in one
// sentence rather than handed a failure: the secret is the owner's to set and
// there is nothing an agent can do about it (README.md).
Deno.test('app_stats with no analytics token says so, once', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: 'quiet33', apps: ['weather'] }])
    let said = await connector(k, cookie).tool('app_stats', {
      space: 'quiet33',
      app: 'weather',
    })
    assertStringIncludes(said, 'not switched on')
  } finally {
    await k.stop()
  }
})

// D-32318 §Errors, verbatim: "One is open until a later deploy stops
// producing it or the agent marks it fixed." So the deploy that carries the
// fix closes it, with nobody archiving by hand (T-32910, C-32905 item 7).
Deno.test('the deploy that fixes a break closes it', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: 'mend34', apps: ['weather'] }])
    let agent = connector(k, cookie)
    let app = { space: 'mend34', app: 'weather' }
    let report = (message: string) =>
      k.at('mend34.yaks.app', '/weather/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          url: 'https://mend34.yaks.app/weather/',
        }),
      })

    await agent.tool('app_files', {
      ...app,
      files: [{
        path: 'index.html',
        content: '<h1>W</h1><script src="app.js">',
      }],
    })
    assertMatch(await agent.tool('app_deploy', app), /v1/)

    // The page dies in someone's browser, on v1.
    await (await report('failed to load script /weather/app.js')).body?.cancel()
    let open = await agent.tool('app_errors', app)
    assertStringIncludes(open, 'weather v1: page /weather/ — failed to load')
    assertStringIncludes(
      await agent.tool('app_list', { space: 'mend34' }),
      '1 open',
    )

    // The fix goes out. Nothing archives it by hand.
    await agent.tool('app_files', {
      ...app,
      files: [{ path: 'app.js', content: 'document.title = "W"' }],
    })
    let out = await agent.tool('app_deploy', app)
    assertMatch(out, /v2/)
    assertStringIncludes(out, 'closed 1 break from earlier versions')
    assertEquals(await agent.tool('app_errors', app), 'no open errors')
    assert(
      !(await agent.tool('app_list', { space: 'mend34' })).includes('open'),
      'the count follows',
    )

    // A break on the version now serving stays open: only the code that is
    // gone is answered for.
    await (await report('boom is not a function')).body?.cancel()
    assertStringIncludes(
      await agent.tool('app_errors', app),
      'weather v2: page /weather/ — boom is not a function',
    )
  } finally {
    await k.stop()
  }
})
