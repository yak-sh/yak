// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow, until } from '../../src/testing.ts'
import {
  client,
  connector,
  kernel,
  letters,
  meta,
  seed,
  signIn,
} from './probe.ts'

// A space's front page is a choice (T-32947), and one nobody makes by
// accident: no app claims the bare hostname by being made first (T-33040), so
// until app_set(home) says which, that address lists the apps a visitor may
// open. `home: false` puts it back to the list. Where the space's own address
// points is the owner's, like publishing and membership — an editor is
// refused.
slow('the front page moves, and only the owner moves it', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'front', apps: ['first', 'second'] }])
    let agent = connector(k, them.cookie)
    let bare = () => k.at('front.yaks.app', '/', { redirect: 'manual' })
    // Which app the bare hostname IS, read off the store answering there —
    // the front page is served at that address, not redirected to. Nothing
    // is, yet: the list is.
    let front = async () => {
      let r = await k.at('front.yaks.app', '/api/graph')
      // The handle carries a key minted off the app's eid (directory.ts
      // `handle`), so what is asked here is WHICH app answers, not the key.
      return r.status == 200
        ? String((await r.json()).db).replace(/\.[0-9a-f]+$/, '')
        : r.status
    }
    let was = await bare()
    assertEquals(was.status, 200)
    assertStringIncludes(await was.text(), 'href="/first/"')
    assertEquals(await front(), 404)

    let said = await agent.tool('app_set', {
      space: 'front',
      app: 'second',
      home: true,
    })
    assertStringIncludes(said, 'the front page now')
    assertStringIncludes(said, 'https://front.yaks.app/')
    assertEquals(await front(), 'do:front/second')

    // Said where the person reads what they have: in the sentence, and in the
    // data the view beside it draws.
    let listing = await agent.call('tools/call', {
      name: 'app_list',
      arguments: { space: 'front' },
    })
    // Its address in the listing is the bare hostname: that is where it is —
    // and so is its mailbox, the bare space name for the same reason.
    assertStringIncludes(
      listing.content[0].text,
      'second (second) v0: https://front.yaks.app/ · front@yaks.app — ' +
        'the front page',
    )
    assertEquals(
      listing.structuredContent.spaces[0].apps
        .map((a: { slug: string; home: boolean }) => [a.slug, a.home]),
      [['first', false], ['second', true]],
    )

    // Cleared: both apps stand at their own addresses, and the space's own
    // address opens nothing.
    assertStringIncludes(
      await agent.tool('app_set', {
        space: 'front',
        app: 'second',
        home: false,
      }),
      'no longer the front page',
    )
    let none = await bare()
    assertEquals(none.status, 200)
    assertStringIncludes(await none.text(), 'href="/first/"')
    assertEquals(await front(), 404)
    assertEquals(
      (await agent.tool('app_list', { space: 'front' })).includes('front page'),
      false,
    )

    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    await agent.tool('member_add', {
      space: 'front',
      email: ann.email,
      role: 'editor',
    })
    assertStringIncludes(
      (await assertRejects(
        () =>
          connector(k, ann.cookie).tool('app_set', {
            space: 'front',
            app: 'first',
            home: true,
          }),
        Error,
      )).message,
      'not the owner of front',
    )
    let still = await bare()
    assertEquals(still.status, 200)
    await still.body?.cancel()
  } finally {
    await k.stop()
  }
})

// A SPACE moves (T-34658). Jeff, on T-34656: "let's add space re-naming and we
// can use the former concept for now and keep them reserved". So: the space
// answers at its new subdomain, the old one redirects there with the path kept
// and stays reserved, and what the platform keeps for the space — the store
// each app is named by, the domain somebody else owns, the roster — never
// spelled the slug and so never moves.
slow('a space moves, and the subdomain it leaves points at it', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'ada', apps: ['cookbook', 'garden'] }])
    let agent = connector(k, them.cookie)
    let box = client(k, 'ada.yaks.app', 'cookbook', them.cookie)
    await box.put('/index.html', '<!doctype html><h1>Our recipe box</h1>')
    let cake = crypto.randomUUID()
    await box.applied([{ entity: { eid: cake }, doc: { title: 'Lemon cake' } }])
    // A domain somebody else owns, aimed at the space by its eid.
    await meta(k, them.cookie).apply([{
      hostname: {
        name: 'ourbookclub.com',
        serves: them.eids['ada'],
        stage: 'active',
      },
    }])
    let handle = async (host: string, app: string) =>
      String((await (await k.at(host, `/${app}/api/graph`)).json()).db)
    let was = await handle('ada.yaks.app', 'cookbook')

    let said = await agent.tool('space_set', {
      space: 'ada',
      slug: 'ada-cooks',
    })
    assertStringIncludes(said, 'https://ada-cooks.yaks.app/')
    assertStringIncludes(said, 'redirects here and stays reserved')
    assertStringIncludes(said, 'cookbook, garden')

    // Served at the new address, files and rows and all.
    let now = await k.at('ada-cooks.yaks.app', '/cookbook/')
    assertEquals(now.status, 200)
    assertStringIncludes(await now.text(), '<h1>Our recipe box</h1>')
    let [kept] = await client(k, 'ada-cooks.yaks.app', 'cookbook', them.cookie)
      .get(`id=${cake}`) as unknown as { doc: { title: string } }[]
    assertEquals(kept.doc.title, 'Lemon cake')
    // The store handle did NOT move: it is the app's own, not the address's.
    assertEquals(await handle('ada-cooks.yaks.app', 'cookbook'), was)

    // The subdomain it left keeps answering, as the permanent move it was,
    // with the path and the query kept.
    let gone = await k.at('ada.yaks.app', '/cookbook/?page=2', {
      redirect: 'manual',
    })
    assertEquals(gone.status, 301)
    assertEquals(
      gone.headers.get('location'),
      'https://ada-cooks.yaks.app/cookbook/?page=2',
    )
    // A write keeps its method, the way a renamed app's does.
    let write = await k.at('ada.yaks.app', '/cookbook/api/apply', {
      method: 'POST',
      body: '[]',
      redirect: 'manual',
    })
    assertEquals(write.status, 308)
    assertEquals(
      write.headers.get('location'),
      'https://ada-cooks.yaks.app/cookbook/api/apply',
    )
    // And the address is not free just because the space left it.
    await assertRejects(
      () => agent.tool('space_new', { slug: 'ada', title: 'Ada again' }),
      Error,
      'used to be',
    )

    // The domain names an eid, so it opens the space wherever the space
    // lives — nothing about it was touched.
    let their = await k.at('ourbookclub.com', '/cookbook/')
    assertEquals(their.status, 200)
    assertStringIncludes(await their.text(), '<h1>Our recipe box</h1>')
    // And the roster is the space's own: its owner is still its owner, which
    // is what lets them move it a second time.
    assertStringIncludes(
      await agent.tool('space_set', {
        space: 'ada-cooks',
        title: "Ada's kitchen",
      }),
      'ada-cooks "Ada\'s kitchen"',
    )

    // Forgotten (T-34659): the subdomain stops redirecting and goes back into
    // circulation — a config change, and the answer names what it costs.
    assertStringIncludes(
      await agent.tool('space_set', { space: 'ada-cooks', forget: 'ada' }),
      'ada.yaks.app stops redirecting and is free for anyone to take',
    )
    assertEquals(
      (await k.at('ada.yaks.app', '/cookbook/', { redirect: 'manual' })).status,
      404,
    )
    assertStringIncludes(
      await agent.tool('space_new', { slug: 'ada', title: 'Ada again' }),
      'https://ada.yaks.app/',
    )
  } finally {
    await k.stop()
  }
})

// Forgetting an address (T-34659). Jeff, on T-34656: "whether the old domain
// redirects should be a simple config change, not a infrastructure migration".
// So it is one argument, and what it changes is the redirect and nothing else —
// which is only true because the store is named by the app's own handle
// (T-34657): a freed address can be taken by a NEW app, and the two are two
// objects with two sets of data.
slow('an address is forgotten, freed, and taken by another app', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'ada', apps: ['recipes'] }])
    let agent = connector(k, them.cookie)
    let handle = async (app: string) =>
      String(
        (await (await k.at('ada.yaks.app', `/${app}/api/graph`)).json()).db,
      )
    let was = await handle('recipes')
    await agent.tool('app_set', {
      space: 'ada',
      app: 'recipes',
      slug: 'cookbook',
    })
    let asked = (path: string) =>
      k.at('ada.yaks.app', path, { redirect: 'manual' })
    assertEquals(
      (await asked('/recipes/')).headers.get('location'),
      '/cookbook/',
    )

    // An address it never left, and the one it is AT, are both refused: the
    // one act here that breaks a link is not a thing to guess at.
    await assertRejects(
      () =>
        agent.tool('app_set', {
          space: 'ada',
          app: 'cookbook',
          forget: 'garden',
        }),
      Error,
      'does not answer at garden',
    )
    await assertRejects(
      () =>
        agent.tool('app_set', {
          space: 'ada',
          app: 'cookbook',
          forget: 'cookbook',
        }),
      Error,
      'is where it IS',
    )

    // Forgotten: the redirect stops, and the answer says what that costs.
    assertStringIncludes(
      await agent.tool('app_set', {
        space: 'ada',
        app: 'cookbook',
        forget: 'recipes',
      }),
      'stops redirecting and is free for anyone to take',
    )
    assertEquals((await asked('/recipes/')).status, 404)

    // And the address is free: a NEW app is born there, with its own handle
    // and its own store — the old app's rows are not in it.
    await agent.tool('app_new', {
      space: 'ada',
      slug: 'recipes',
      title: 'Recipes again',
    })
    let now = await handle('recipes')
    assert(now != was, `${now} is the store the first app had`)
    assertEquals(await handle('cookbook'), was)
  } finally {
    await k.stop()
  }
})

// Jeff, on T-34227: "and if i screw up my home app, can i reset it back to the
// default in some way? maybe if you delete the home app, it just resets to the
// default?" — it does, and it falls out of the word being ON the app rather
// than beside it: an app in the trash is nobody's front page, and an erased
// one takes `home` with it, so either way nothing is left saying which app the
// bare hostname opens. The word itself stays on the trashed row, because a
// restore has to put the space back exactly as it was (T-34430).
slow('deleting the front page puts the space back to the default', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'reset', apps: ['site', 'garden'] }])
    let agent = connector(k, them.cookie)
    let bare = () => k.at('reset.yaks.app', '/', { redirect: 'manual' })
    let front = async () => {
      let r = await k.at('reset.yaks.app', '/api/graph')
      // The handle carries a key minted off the app's eid (directory.ts
      // `handle`), so what is asked here is WHICH app answers, not the key.
      return r.status == 200
        ? String((await r.json()).db).replace(/\.[0-9a-f]+$/, '')
        : r.status
    }
    await agent.tool('app_set', {
      space: 'reset',
      app: 'site',
      home: true,
      first: ['/garden/*'],
    })
    assertEquals(await front(), 'do:reset/site')

    // Thrown away, and the space is a space with no front page again — the
    // ordinary state, and the state it was in before anybody said otherwise.
    await agent.tool('app_delete', { space: 'reset', app: 'site' })
    let back = await bare()
    assertEquals(back.status, 200)
    assertStringIncludes(await back.text(), 'href="/garden/"')
    assertEquals(await front(), 404)
    // Nothing ANSWERING carries the word, so nothing carries its globs
    // either: `/garden/x` is the garden app's again. The row in the trash
    // still wears it — that is what a restore puts back — and no listing of
    // the space's apps says anything is the front page.
    assertEquals(
      (await agent.tool('app_list', { space: 'reset' })).includes('front page'),
      false,
    )
    assertEquals(
      (await meta(k, them.cookie).query('.home!&.trashed=')).length,
      0,
    )
    // Its own address is nobody's now — not a redirect to a former slug, and
    // not the front page's fall-through, because there is no front page.
    assertEquals((await k.at('reset.yaks.app', '/site/')).status, 404)
    // And `<space>@yaks.app` is a space with no front page again, which the
    // mail door already refuses by name and tells the sender where to write
    // instead (inbox.ts `opened`, inbox_test.ts).
    // And the space takes another one whenever it is ready to.
    await agent.tool('app_set', { space: 'reset', app: 'garden', home: true })
    assertEquals(await front(), 'do:reset/garden')
  } finally {
    await k.stop()
  }
})

// Jeff, on T-34430: "can deleted apps be brought back if done by mistake?" —
// "there should be a grace period. like a 30 day trash". The whole round trip
// through the door an agent actually uses: an app with files, data and a tool
// of its own goes in the trash, and everything that names it stops naming it
// while nothing it holds is touched; then it comes back, whole, and the same
// four answers are the answers again.
slow('an app goes to the trash, and app_restore brings it back', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'binlab', apps: ['garden'] }])
    let agent = connector(k, them.cookie)
    let at = { space: 'binlab', app: 'notes' }
    // What the app can be asked to do — its commands leave every list the day
    // it goes in the trash and come back with it (T-34430, T-34541).
    let listed = async () =>
      (((await agent.call('tools/call', { name: 'commands', arguments: {} }))
        .structuredContent?.commands ?? []) as { name: string }[])
        .map((c) => c.name)
    let page = () => k.at('binlab.yaks.app', '/notes/')

    await agent.tool('app_new', { ...at, slug: 'notes', title: 'Notes' })
    await agent.tool('app_files', {
      ...at,
      files: [
        { path: 'index.html', content: '<!doctype html><h1>notes</h1>' },
        {
          path: 'vocab.json',
          content: JSON.stringify({ note: { at: 'text' } }),
        },
        {
          path: 'tools.json',
          content: JSON.stringify({
            log_note: {
              description: 'Write a note',
              input: { at: 'text' },
              apply: { note: { at: '{{at}}' } },
            },
          }),
        },
      ],
    })
    await agent.tool('app_deploy', at)
    await agent.tool('graph_apply', {
      ...at,
      entities: [{ entity: { eid: '$n' }, doc: { title: 'a kept thing' } }],
    })
    assertEquals((await page()).status, 200)
    assert((await listed()).includes('log_note'))

    // In. Everything that names the app stops naming it: the web, the tool
    // list, and the listing — where it is under Trash instead, with its days.
    assertStringIncludes(
      await agent.tool('app_delete', at),
      'binlab/notes is in the trash',
    )
    assertEquals((await page()).status, 404)
    assertEquals((await listed()).includes('log_note'), false)
    let saying = await agent.tool('app_list', { space: 'binlab' })
    assertStringIncludes(saying, 'Trash — app_restore brings one back')
    assertStringIncludes(saying, '- Notes (notes), 30 days left')
    assertEquals(saying.includes('https://binlab.yaks.app/notes/'), false)
    // And the slug is held for it: a second app here is the one thing a
    // restore could not undo, so `app_new` refuses and says which two words
    // resolve it.
    assertStringIncludes(
      (await assertRejects(
        () =>
          agent.tool('app_new', {
            space: 'binlab',
            slug: 'notes',
            title: 'Notes again',
          }),
        Error,
      )).message,
      'notes is in the trash in binlab, 30 days left — app_restore',
    )
    // Deleting it again is not a second delete; it says where the app is.
    assertStringIncludes(
      (await assertRejects(() => agent.tool('app_delete', at), Error)).message,
      'is already in the trash',
    )

    // Out, and every one of those answers is the old answer again — including
    // the row nothing touched while it sat there.
    assertStringIncludes(
      await agent.tool('app_restore', at),
      'binlab/notes is back',
    )
    assertEquals((await page()).status, 200)
    assert((await listed()).includes('log_note'))
    assertStringIncludes(
      await agent.tool('app_list', { space: 'binlab' }),
      'https://binlab.yaks.app/notes/',
    )
    assertEquals(
      JSON.parse(await agent.tool('graph_query', { q: '.doc.title~=kept' }))
        .length,
      1,
    )
    // An app that is not in the trash has nothing to restore.
    assertStringIncludes(
      (await assertRejects(() => agent.tool('app_restore', at), Error)).message,
      'is not in the trash',
    )

    // And `forever` is the other word: no trash, nothing kept, and the
    // address free for the next app, which wakes up in an empty store.
    await agent.tool('app_delete', { ...at, forever: true })
    assertEquals((await page()).status, 404)
    await agent.tool('app_new', {
      space: 'binlab',
      slug: 'notes',
      title: 'Notes again',
    })
    assertEquals(
      JSON.parse(await agent.tool('graph_query', { q: '.doc.title~=kept' })),
      [],
    )
  } finally {
    await k.stop()
  }
})

// The same trash one row up (T-34431): a whole SPACE. The agent still cannot
// delete one — the letter is the door and the owner is the only caller who
// reaches it — so this walks the whole way an owner actually goes, and then
// every answer that named the space stops naming it while nothing it holds is
// touched.
slow(
  'a space goes to the trash, and space_restore brings it back',
  async () => {
    let k = await kernel()
    try {
      let them = await seed(k, [{ slug: 'binspace', apps: [] }])
      let agent = connector(k, them.cookie)
      let at = { space: 'binspace', app: 'notes' }
      let listed = async () =>
        (((await agent.call('tools/call', { name: 'commands', arguments: {} }))
          .structuredContent?.commands ?? []) as { name: string }[])
          .map((c) => c.name)
      let page = (path = '/notes/') => k.at('binspace.yaks.app', path)

      await agent.tool('app_new', { ...at, slug: 'notes', title: 'Notes' })
      await agent.tool('app_files', {
        ...at,
        files: [
          { path: 'index.html', content: '<!doctype html><h1>notes</h1>' },
          {
            path: 'vocab.json',
            content: JSON.stringify({ note: { at: 'text' } }),
          },
          {
            path: 'tools.json',
            content: JSON.stringify({
              log_note: {
                description: 'Write a note',
                input: { at: 'text' },
                apply: { note: { at: '{{at}}' } },
              },
            }),
          },
        ],
      })
      await agent.tool('app_deploy', at)
      await agent.tool('graph_apply', {
        ...at,
        entities: [{ entity: { eid: '$n' }, doc: { title: 'a kept thing' } }],
      })
      assertEquals((await page()).status, 200)
      assert((await listed()).includes('log_note'))
      assertStringIncludes(await agent.tool('about'), 'binspace/notes')

      // The agent deletes nothing, as ever: it mails the owner. What the letter
      // and the answer say is what the trash DOES — every line something that
      // stops, and the address held rather than released.
      let said = await agent.tool('space_delete', { space: 'binspace' })
      assertStringIncludes(said, 'nothing is deleted')
      assertStringIncludes(said, 'stops answering')
      let mail = await until(
        () =>
          letters(k, them.email).findLast((l) => l.subject.includes('Delete')),
        { timeout: 20_000, poll: 100, label: 'the delete letter' },
      )
      assertStringIncludes(
        mail!.body,
        'puts the space in the trash for 30 days',
      )
      let link = /https:\/\/yaks\.app(\/space\/binspace\/delete\?t=[^\s]+)/
        .exec(mail!.body)
      assert(link, `no confirmation link in: ${mail!.body}`)

      // The owner opens it, and the page asks in the trash's words.
      let asking = await (await k.at('yaks.app', link[1], {
        headers: { cookie: them.cookie },
      })).text()
      assertStringIncludes(asking, 'What stops until you restore it')
      assertStringIncludes(asking, 'Put binspace.yaks.app in the trash')
      let gone = await k.at('yaks.app', '/space/binspace/delete', {
        method: 'POST',
        headers: {
          cookie: them.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ t: link[1].split('t=')[1] }).toString(),
      })
      assertEquals(gone.status, 200)
      assertStringIncludes(
        await gone.text(),
        'binspace.yaks.app is in the trash',
      )

      // Every address of it answers what a wrong address answers: the front
      // page, an app of its own, a path no app claims.
      for (let path of ['/', '/notes/', '/whatever']) {
        let out = await page(path)
        assertEquals(out.status, 404, path)
        assertStringIncludes(await out.text(), 'Nothing here yet')
      }
      // Except for its owner, who is told where it went and given it back.
      let mine = await k.at('binspace.yaks.app', '/', {
        headers: { cookie: them.cookie },
      })
      assertEquals(mine.status, 404)
      let says = await mine.text()
      assertStringIncludes(says, 'binspace is in the trash')
      assertStringIncludes(says, 'name="restore-space" value="binspace"')
      // Its apps left every roster the moment the space did — the tool list,
      // and the passage `about` and `initialize` both put at the top of an
      // agent's context (standing.ts), which is one `reachable` behind both.
      assertEquals((await listed()).includes('log_note'), false)
      assertEquals(
        (await agent.tool('about')).includes('binspace/notes'),
        false,
      )
      // And the slug is held for it: a second space here is the one thing a
      // restore could not put back.
      assertStringIncludes(
        (await assertRejects(
          () => agent.tool('space_new', { slug: 'binspace', title: 'again' }),
          Error,
        )).message,
        'binspace is in the trash',
      )
      // Asking again is not a second delete; it says where the space is.
      assertStringIncludes(
        (await assertRejects(
          () => agent.tool('space_delete', { space: 'binspace' }),
          Error,
        )).message,
        'is already in the trash',
      )

      // Out, and every one of those answers is the old answer again — the rows
      // in its apps' stores included, since nothing ever touched them.
      assertStringIncludes(
        await agent.tool('space_restore', { space: 'binspace' }),
        'binspace is back',
      )
      assertEquals((await page()).status, 200)
      assert((await listed()).includes('log_note'))
      assertStringIncludes(await agent.tool('about'), 'binspace/notes')
      assertEquals(
        JSON.parse(
          await agent.tool('graph_query', { ...at, q: '.doc.title~=kept' }),
        )
          .length,
        1,
      )
      assertStringIncludes(
        (await assertRejects(
          () => agent.tool('space_restore', { space: 'binspace' }),
          Error,
        )).message,
        'is not in the trash',
      )
    } finally {
      await k.stop()
    }
  },
)

// The front page is the space's ROUTER, and `first` is how it opts in
// (D-34197): the paths its worker sees before the app whose slug owns them,
// written as columns of the `home` component the front page wears (T-34227).
// Routing itself is T-34200/T-34201; what this proves is the vocabulary, the
// tool and the read back — that only a front page routes, and that the
// platform's own paths are refused, whole, before anything is written.
slow('the front page says which paths it answers first', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'route', apps: ['site', 'recipes'] }])
    let agent = connector(k, them.cookie)
    let graph = meta(k, them.cookie)
    let at = { space: 'route', app: 'site' }
    // The rows carrying the component, whatever else is in the store.
    let stored = async () =>
      (await graph.query('.home!'))
        .map((r) => (r.home as { first: string | null }).first)

    // The globs are columns of the word that says which app is home, so an
    // app that is not the front page has nowhere to put them.
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_set', { ...at, first: ['/recipes/*'] }),
        Error,
      )).message,
      'route/site is not the front page',
    )
    assertEquals(await stored(), [])

    let said = await agent.tool('app_set', {
      ...at,
      home: true,
      first: ['/recipes/*', '/*/print'],
    })
    // Said back off the row as it now stands, not off what arrived: the tool
    // re-reads the app after the write and the sentence is built from the App
    // row (directory.ts `appOf` → router.ts `firstOf`).
    assertStringIncludes(
      said,
      'it answers /recipes/*, /*/print before the apps that own them',
    )
    // And the column itself: one text column holding the JSON list, in order.
    assertEquals(await stored(), ['["/recipes/*","/*/print"]'])

    // An empty list is an empty COLUMN now, not a component that goes away:
    // the word is what says this app is the front page, and it still is.
    assertStringIncludes(
      await agent.tool('app_set', { ...at, first: [] }),
      'it answers no path before the app that owns it',
    )
    assertEquals(await stored(), [null])

    // The platform's own paths are nobody's, and a refusal names the glob and
    // the rule. Nothing in the batch lands — not even the globs beside it.
    for (
      let [glob, why] of [
        ['/mcp', '/mcp names /mcp, which the platform answers itself'],
        ['/*/api/query', '/*/api/query names /*/api/*'],
        ['/*', '/* names /login'],
        ['recipes', 'recipes does not start with / — a glob is a path'],
      ]
    ) {
      assertStringIncludes(
        (await assertRejects(
          () => agent.tool('app_set', { ...at, first: ['/recipes/*', glob] }),
          Error,
        )).message,
        why,
      )
      assertEquals(await stored(), [null], `${glob} was written anyway`)
    }

    // AT MOST ONE per space, which the vocabulary cannot say and the
    // directory therefore does (T-34227): moving the front page is one batch
    // that takes the word off the app that had it, globs and all.
    await agent.tool('app_set', { ...at, first: ['/recipes/*'] })
    assertEquals(await stored(), ['["/recipes/*"]'])
    await agent.tool('app_set', {
      space: 'route',
      app: 'recipes',
      home: true,
    })
    assertEquals(await stored(), [null])
    assertEquals(
      (await graph.query('.home!&.app!'))
        .map((r) => (r.app as { slug: string }).slug),
      ['recipes'],
    )
  } finally {
    await k.stop()
  }
})
