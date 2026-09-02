// The kernel's contract, held in workerd itself (probe.ts boots it): the
// apex and its soft 404, a space and app born in the directory and served,
// the session cookie forged and signed, the file door, the graph API, and a
// route that threw becoming an error entity behind a soft page.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow } from '../../src/testing.ts'
import {
  client,
  connector,
  kernel,
  meta,
  seed,
  signedIn,
  signIn,
} from './probe.ts'

slow('the kernel routes, vouches, serves, and surfaces', async () => {
  let k = await kernel()
  try {
    // The apex: the home page, its assets, and a soft 404 in its voice.
    let home = await k.at('yaks.app', '/')
    assertEquals(home.status, 200)
    assertMatch(await home.text(), /Your ideas, made into little apps/)
    let css = await k.at('yaks.app', '/style.css')
    assertMatch(css.headers.get('content-type') ?? '', /text\/css/)
    await css.body?.cancel()
    let lost = await k.at('yaks.app', '/no/such/page')
    assertEquals(lost.status, 404)
    assertMatch(await lost.text(), /wandered off/)
    // A dev host is the apex too; the reserved doors answer, softly.
    assertEquals((await k.at('127.0.0.1', '/')).status, 200)
    let login = await k.at('yaks.app', '/login')
    assertEquals(login.status, 200)
    assertMatch(await login.text(), /Sign in to yaks.app/)
    // The connector answers POST only (mcp_test.ts drives it).
    let mcp = await k.at('yaks.app', '/mcp')
    assertEquals(mcp.status, 405)
    assertEquals((await mcp.json()).error.code, 'method_not_allowed')

    // A space nobody made, and a space made through the meta store.
    let nowhere = await k.at('nowhere.yaks.app', '/')
    assertEquals(nowhere.status, 404)
    assertMatch(await nowhere.text(), /Nothing here yet/)
    let { person: jeff, cookie, eids } = await seed(k, [{
      slug: 'jeff',
      apps: ['recipes', 'garden'],
    }])
    let bare = await k.at('jeff.yaks.app', '/', { redirect: 'manual' })
    assertEquals(bare.status, 302)
    assertEquals(bare.headers.get('location'), '/recipes/')
    let slash = await k.at('jeff.yaks.app', '/recipes', { redirect: 'manual' })
    assertEquals(slash.status, 302)
    assertEquals(slash.headers.get('location'), '/recipes/')
    let empty = await k.at('jeff.yaks.app', '/recipes/')
    assertEquals(empty.status, 404)
    assertMatch(await empty.text(), /Nothing here yet/)
    assertEquals((await k.at('jeff.yaks.app', '/nope/')).status, 404)

    // The file door: nobody and a forgery are refused, the owner is not; the
    // planted file then serves at its path with its type.
    // A forgery is one character of the mac changed — the FIRST one. The
    // last character of a base64url mac carries only padding bits, so
    // flipping it decodes to the same 32 bytes and verifies, which made this
    // check pass or fail with the secret of the run.
    let forged = cookie.replace(/\.(.)/, (_, c) => `.${c == 'A' ? 'B' : 'A'}`)
    let owner = client(k, 'jeff.yaks.app', 'recipes', cookie)
    let nobody = client(k, 'jeff.yaks.app', 'recipes')
    let forger = client(k, 'jeff.yaks.app', 'recipes', forged)
    let page = '<!doctype html><h1>Our recipe box</h1>'
    assertEquals((await nobody.put('/index.html', page)).status, 401)
    assertEquals((await forger.put('/index.html', page)).status, 401)
    assertEquals((await owner.put('/index.html', page)).status, 200)
    assertEquals(
      (await owner.put('/style.css', 'h1 { color: peru }')).status,
      200,
    )
    let served = await k.at('jeff.yaks.app', '/recipes/')
    assertEquals(served.status, 200)
    assertMatch(served.headers.get('content-type') ?? '', /text\/html/)
    // The page as written, plus the reporter the kernel injects (apps.ts).
    assertStringIncludes(await served.text(), page)
    let style = await k.at('jeff.yaks.app', '/recipes/style.css')
    assertMatch(style.headers.get('content-type') ?? '', /text\/css/)
    assertEquals(await style.text(), 'h1 { color: peru }')
    // Another app in the space has its own files and its own store.
    assertEquals((await k.at('jeff.yaks.app', '/garden/')).status, 404)

    // The graph API: the store is named by the route, the session is vouched
    // for, and a batch round-trips. A viewer may read and not write.
    let who = await (await k.at('jeff.yaks.app', '/recipes/api/graph', {
      headers: { cookie },
    })).json()
    assertEquals(who.db, 'do:jeff/recipes')
    assertEquals(who.person, jeff)
    assertEquals(who.role, 'owner')
    let anon = await (await k.at('jeff.yaks.app', '/recipes/api/graph')).json()
    assertEquals([anon.person, anon.role], [null, null])
    let cake = crypto.randomUUID()
    // A refusal answers a SENTENCE beside its code: the page catches it and
    // shows it, and the person's agent reads it after that (C-32574 item 2,
    // where a club member's vote showed them the bare code).
    let refusal = await nobody.post([])
    assertEquals(refusal.status, 401)
    let said = (await refusal.json()).error
    assertEquals(said.code, 'not_a_writer')
    assertEquals(said.message, 'sign in to change this app')
    // ...and where signing in happens, holding this page as its return
    // address, so the person comes back to it (T-32593).
    assertMatch(said.signIn, /^https:\/\/yaks\.app\/login\?return=/)
    await owner.applied([
      { eid: cake, name: 'doc', comp: { title: "Grandma's lemon cake" } },
    ])
    let [hit] = await owner.get(`id=${cake}`)
    assertEquals((hit.doc as { title: string }).title, "Grandma's lemon cake")
    assertEquals(await nobody.get(`id=${cake}`), [hit])
    // A body is stored as a content-addressed blob ENTITY, so the store's own
    // rows live in the spine a filter selects from. A listing must answer docs
    // and nothing else: the tester's first list rendered `undefined` for each
    // blob it got back (C-32498 item 4). An empty needle is the case that found
    // it — `.doc.title~=` asks whether the column is there, not whether every
    // string contains ''.
    let pie = crypto.randomUUID()
    await owner.applied([
      {
        eid: pie,
        name: 'doc',
        comp: { title: 'Rhubarb pie', body: 'rhubarb' },
      },
    ])
    let listing = await owner.get('.doc.title~=')
    assertEquals(
      listing.map((r) => (r.doc as { title: string }).title).sort(),
      [
        "Grandma's lemon cake",
        'Rhubarb pie',
      ],
    )
    assert(
      (await owner.get('.created.at!')).every((r) => !r.blob),
      'a filter answers the graph, never the store rows behind it',
    )
    // Naming the component is how a caller asks for them at all.
    assert((await owner.get('.blob!')).length > 0, 'the bodies are stored')
    assertEquals(
      await client(k, 'jeff.yaks.app', 'garden').get(`id=${cake}`),
      [],
    )
    let maya = crypto.randomUUID()
    await owner.applied([
      { eid: maya, name: 'person', comp: {} },
    ])
    // The directory is written through the graph tier, by the owner of `yak`
    // — the only door into the meta store there is.
    await meta(k, cookie).apply([
      { entity: { eid: maya }, person: {} },
      { member: { space: eids.jeff, person: maya, role: 'viewer' } },
    ])
    let viewer = client(k, 'jeff.yaks.app', 'recipes', await signedIn(k, maya))
    let seen = await viewer.post([])
    assertEquals(seen.status, 403)
    assertStringIncludes(
      (await seen.json()).error.message,
      'read this app but not change it',
    )
    assertEquals((await viewer.put('/x.txt', 'no')).status, 403)
    assertEquals((await viewer.get(`id=${cake}`)).length, 1)

    // The platform's own rows never leave the kernel (T-32585): the meta
    // store is not an app, so nothing answers at its address — not for a
    // stranger, not for the owner of `yak` himself, who reaches it through
    // the graph tier instead.
    for (
      let path of [
        '/platform/',
        '/platform/api/query?.signin!',
        '/platform/api/apply',
        '/platform/api/ws',
        '/platform/api/graph',
      ]
    ) {
      for (let as of [undefined, cookie, await signedIn(k, maya)]) {
        let shut = await k.at('yak.yaks.app', path, {
          headers: as ? { cookie: as } : {},
        })
        assertEquals(
          shut.status,
          404,
          `${path} as ${as ? 'someone' : 'nobody'}`,
        )
        assertMatch(await shut.text(), /Nothing here yet/)
      }
    }

    // A route that throws — a malformed escape in a file path — answers with
    // the soft page and leaves an exception entity in the app's store, naming
    // the request and carrying the message and stack; nothing wears `error`,
    // the facet for a failure the platform expected.
    let broke = await k.at('jeff.yaks.app', '/recipes/%E0%A4%A')
    assertEquals(broke.status, 500)
    assertMatch(await broke.text(), /Something went wrong/)
    let [broken] = await owner.get('.exception!&.created!')
    assert(broken, 'an exception entity')
    let ex = broken.exception as {
      message: string
      stack: string
      request: string
    }
    assertEquals(ex.request, 'GET /recipes/%E0%A4%A')
    // The platform's own row wears no doc, so a person's `.doc!` is theirs
    // alone (T-32533).
    assertEquals(broken.doc, undefined)
    assertMatch(ex.message, /URI/)
    assertMatch(ex.stack, /URIError|decodeURIComponent/)
    assertEquals(await owner.get('.error!'), [])
    // A signed-in page's write says who saved it: the kernel vouches for the
    // person, the store learns them as a row of its own, and `created.by` is
    // theirs (T-32534). A break the kernel reported names nobody. The stamp
    // comes back because the filter NAMED it — a listing that did not ask
    // carries the rows a person saved and no bookkeeping, at this door and at
    // the tools' alike (listing.ts, C-32574 item 5).
    let [mine] = await owner.get('.doc!&.created!')
    assertEquals((mine.created as { by: string }).by, jeff)
    assertEquals((await owner.get('.doc!'))[0].created, undefined)
    assertEquals(
      ((await owner.get('.person!'))[0].entity as { eid: string }).eid,
      jeff,
    )
    assertEquals((broken.created as { by: string | null }).by, null)

    // The kernel flag is the kernel's: a client sending it is still a client,
    // and its server-owned change is dropped, not written.
    let forgedFlag = await k.at('jeff.yaks.app', '/recipes/api/apply', {
      method: 'POST',
      headers: { cookie, 'x-yak-kernel': '1' },
      body: JSON.stringify([{
        eid: crypto.randomUUID(),
        name: 'exception',
        comp: { message: 'forged' },
      }]),
    })
    assertEquals(forgedFlag.status, 200)
    assertEquals((await owner.get('.exception!')).length, 1)
  } finally {
    await k.stop()
  }
})

// What an app lets a stranger with the link do (T-32504), and the guest list
// beside it: three apps, one per access word, each asked by the person who
// owns it, by nobody at all, and by someone invited into the space by email.
slow('an app says who may read it and who may write it', async () => {
  let k = await kernel()
  try {
    // He signs in for real: the address is his, and the first sign-in on a
    // fresh kernel owns the meta space.
    let { cookie, email } = await signIn(k)
    let agent = connector(k, cookie)
    await agent.tool('space_new', { slug: 'club', title: 'Book club' })
    let born = (slug: string, access?: string) =>
      agent.tool('app_new', {
        space: 'club',
        slug,
        title: slug,
        ...(access ? { access } : {}),
      })
    // Every tool that sets access says what it means where it is felt: what
    // happens when the person sends someone the link.
    assertStringIncludes(await born('list'), 'only its members can change it')
    assertStringIncludes(
      await born('vote', 'open'),
      'anyone with the link can use it',
    )
    assertStringIncludes(
      await born('diary', 'private'),
      'only its members can see it',
    )
    await assertRejects(
      () => born('junk', 'sideways'),
      Error,
      'access: one of public, open, private',
    )

    let owner = (app: string) => client(k, 'club.yaks.app', app, cookie)
    let anyone = (app: string) => client(k, 'club.yaks.app', app)
    let line = (title: string) => [{
      eid: crypto.randomUUID(),
      name: 'doc',
      comp: { title },
    }]
    for (let app of ['list', 'vote', 'diary']) {
      await owner(app).applied(line(`the ${app}`))
    }

    // public, the default: anyone with the link reads, and a stranger's write
    // is refused — 401, because nobody signed in.
    assertEquals((await anyone('list').get('.doc!')).length, 1)
    let refused = await anyone('list').post(line('not mine to add'))
    assertEquals(refused.status, 401)
    assertEquals((await refused.json()).error.code, 'not_a_writer')

    // open: the vote page. Anyone with the link writes, without signing in.
    await anyone('vote').applied(line('my vote'))
    assertEquals((await anyone('vote').get('.doc!')).length, 2)

    // private: the data answers members only, both ways. The PAGE still
    // serves — an app's bytes are not its data, and a visitor who is asked to
    // sign in has to have somewhere to be asked.
    await agent.tool('app_files', {
      space: 'club',
      app: 'diary',
      op: 'write',
      path: 'index.html',
      content: '<!doctype html><h1>the diary</h1>',
    })
    assertEquals((await k.at('club.yaks.app', '/diary/')).status, 200)
    let shut = await k.at('club.yaks.app', '/diary/api/query?.doc!')
    assertEquals(shut.status, 401)
    assertEquals((await shut.json()).error.code, 'not_a_reader')
    assertEquals((await anyone('diary').post(line('no'))).status, 401)
    assertEquals((await owner('diary').get('.doc!')).length, 1)

    // The guest list: an invitation is an address, and the person behind it is
    // minted here so their sign-in later finds this same row.
    let said = await agent.tool('member_add', {
      space: 'club',
      email: ' Maya@Example.COM ',
    })
    assertStringIncludes(said, 'maya@example.com is an editor of club')
    assertStringIncludes(said, 'sign in at https://yaks.app')
    let [row] = await meta(k, cookie).query('.email.address=maya@example.com')
    let maya = row.entity.eid
    let mayaIn = await signedIn(k, maya)
    let editor = (app: string) => client(k, 'club.yaks.app', app, mayaIn)
    await editor('list').applied(line('her line'))
    assertEquals((await anyone('list').get('.doc!')).length, 2)
    // The private app is hers to read and to write.
    await editor('diary').applied(line('her secret'))
    assertEquals((await editor('diary').get('.doc!')).length, 2)
    // An editor writes the data; who belongs is the owner's alone.
    await assertRejects(
      () =>
        connector(k, mayaIn).tool('member_add', {
          space: 'club',
          email: 'someone@example.com',
        }),
      Error,
      'not the owner of club',
    )

    // Taken back out, she is a signed-in stranger: 403, not 401.
    assertStringIncludes(
      await agent.tool('member_remove', {
        space: 'club',
        email: 'maya@example.com',
      }),
      'maya@example.com is no longer a member of club',
    )
    assertEquals((await editor('list').post(line('again'))).status, 403)
    let out = await k.at('club.yaks.app', '/diary/api/query?.doc!', {
      headers: { cookie: mayaIn },
    })
    assertEquals(out.status, 403)
    await assertRejects(
      () =>
        agent.tool('member_remove', {
          space: 'club',
          email: 'maya@example.com',
        }),
      Error,
      'not a member of club',
    )

    // A space is never left with nobody to say who belongs. He is found by
    // the address he signed in with — the row his sign-in wrote.
    await assertRejects(
      () => agent.tool('member_remove', { space: 'club', email }),
      Error,
      'the only owner of club',
    )

    // The word is not fixed at birth: a list the whole club may add to, and
    // then a list shut to everyone but them.
    assertStringIncludes(
      await agent.tool('app_set', {
        space: 'club',
        app: 'list',
        access: 'open',
      }),
      'anyone with the link can use it',
    )
    await anyone('list').applied(line('everyone can now'))
    assertEquals((await anyone('list').get('.doc!')).length, 3)
    await agent.tool('app_set', {
      space: 'club',
      app: 'list',
      access: 'private',
    })
    assertEquals(
      (await k.at('club.yaks.app', '/list/api/query?.doc!')).status,
      401,
    )
  } finally {
    await k.stop()
  }
})
