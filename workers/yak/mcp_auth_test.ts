// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow } from '../../src/testing.ts'
import { COOKIE, sign } from '../../src/token.ts'
import { client, connector, kernel, letter, seed, signIn } from './probe.ts'
import { PAGES, uriOf } from './guide.ts'
import { PROMPTS } from './prompts.ts'
import { APPS, b64u, ERRORS, facing, GUIDE, HELLO } from './mcp-probe.ts'

// Nobody has signed in, and the door still says what this place is (T-33030).
// Owner, 2026-09-03, setting up the ChatGPT connector: "i selected 'mixed
// auth', because i think we offer some tools if you haven't authed yet? or at
// least we should."
//
// Two halves, and the second is the one that would hurt to get wrong. The
// public surface answers — what this platform is, and the guide, which the
// web already hands anybody at those very addresses. Everything else answers
// exactly what it answered before: the 401 carrying the `WWW-Authenticate`
// challenge, which is how an MCP client discovers our authorization server.
// Break that header while making things public and no connector can sign in
// at all.
slow('the door before anyone signs in', async () => {
  let k = await kernel()
  try {
    let anon = connector(k)
    // Raw, so a refusal can be read as a refusal: `connector` throws on one.
    let post = (method: string, params: unknown = {}) =>
      k.at('yaks.app', '/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })

    let init = await anon.call('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'probe', version: '0' },
    })
    assertEquals(init.protocolVersion, '2025-03-26')
    facing(init.serverInfo)
    assertEquals(init.capabilities.tools.listChanged, true)
    assertEquals(init.capabilities.resources.listChanged, true)
    // Prompts too, since one of them is public (T-34557). Not logging, which
    // is a break in somebody's app: a capability this door would refuse is
    // worse than one it never claimed.
    assertEquals(init.capabilities.prompts.listChanged, true)
    assertEquals(init.capabilities.logging, undefined)
    // What it says is the orientation, not the recipe — nobody who cannot
    // call app_new is told to call it — and it names where signing in is.
    assertStringIncludes(init.instructions, 'yourname.yaks.app')
    assertStringIncludes(init.instructions, 'https://yaks.app/guide.md')
    assertEquals(init.instructions.includes('app_new'), false)
    assertEquals(await anon.call('ping'), {})

    // The tools a stranger may CALL (anon.ts): about, the guide, the gallery,
    // feedback, and the generic READS scoped to one app — beside the MENU of
    // the ones they may not (T-34465). The callable half is held whole in the
    // test below; here it is `about`, the one lifted out of preauth.ts.
    let schemes = async (of: typeof anon) =>
      Object.fromEntries(
        ((await of.call('tools/list')).tools as {
          name: string
          _meta?: { securitySchemes?: unknown }
        }[]).map((t) => [t.name, t._meta?.securitySchemes]),
      )
    let listed = (await anon.call('tools/list')).tools as {
      name: string
      title: string
      annotations: Record<string, boolean>
      _meta?: { securitySchemes?: unknown }
    }[]
    let about = listed.find((t) => t.name == 'about')!
    // And the menu around it: every platform verb a stranger may not call,
    // listed all the same, each saying `oauth2` — the tools that give a host
    // something to offer the sign-in FOR (T-34465, mcp.ts `menu`). Mixed auth
    // is a list plus a refusal, and a list holding only the open tools is a
    // connector that can never ask anybody to sign in.
    assert(listed.length > 1, 'the menu, not the open tools alone')
    assert(listed.some((t) => t.name == 'app_new'), 'the verbs are on the menu')
    // What a stranger may call is the other test's subject; here it is only
    // that everything ELSE on the menu wants a token.
    let callable = [
      'about',
      'app_published',
      'feedback',
      // The gallery: a public page whether or not anybody has signed in
      // (gallery.ts, T-34478).
      'gallery_search',
      'guide',
      'graph_query',
      'graph_schema',
      'graph_show',
      'search',
    ]
    for (let t of listed.filter((one) => !callable.includes(one.name))) {
      assertEquals(t._meta?.securitySchemes, [{
        type: 'oauth2',
        scopes: ['graph'],
      }], t.name)
    }
    // It wears the same title and hints signed in and out (tools.ts lifts it
    // from preauth.ts): this is the list a directory reviewer sees first, and
    // a bare entry here reads as a door with no annotations at all.
    assertEquals(about.title, 'What yaks.app is')
    assertEquals(about.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
    // And it says out loud how it is reached (T-34349): a host reads a
    // mixed-auth server one tool at a time, so an open tool that declares no
    // scheme is a tool it will not offer. Both schemes, because both work —
    // no token is needed and one is welcome (T-34467).
    assertEquals(about._meta?.securitySchemes, [
      { type: 'noauth' },
      { type: 'oauth2', scopes: ['graph'] },
    ])
    let said = await anon.tool('about')
    for (
      let word of [
        // It opens with the name, so a stranger's first sentence about this
        // place says what the place is called (T-34302).
        'yaks.app is a place to make small web apps',
        'yourname.yaks.app/<app>/',
        'index.html',
        'https://yaks.app',
        'https://yaks.app/guide.md',
      ]
    ) assertStringIncludes(said, word)
    // And nothing here sells anything: yaks.app is declared to the plugin
    // directories as an app that links to no subscription or purchase, and
    // this text is the part of it a stranger reads.
    assertEquals(/subscription|upgrade|pricing|billing|\$\d/i.test(said), false)

    // The guide, and only the guide.
    let pages = (await anon.call('resources/list')).resources as {
      uri: string
      mimeType: string
    }[]
    assertEquals(pages.map((r) => r.uri), [
      GUIDE,
      ...PAGES.map((p) => uriOf(p.slug)),
    ])
    let read = async (uri: string) =>
      (await anon.call('resources/read', { uri })).contents[0]
    let map = await read(GUIDE)
    assertEquals(map.mimeType, 'text/markdown')
    assertStringIncludes(map.text, '# ')
    assertStringIncludes((await read(uriOf('querying'))).text, '# ')
    // Which is the same bytes the web already hands anybody at that address:
    // this door exposes nothing new, it saves an agent a browser.
    let plain = await k.at('yaks.app', '/guide.md')
    assertEquals(plain.status, 200)
    assertEquals(await plain.text(), map.text)

    // And the one prompt a stranger may pick: ideas, which cost no account.
    // The message says the ideas first and where the account is (T-34557),
    // and it names nobody's apps, because nobody is asking.
    assertEquals(
      ((await anon.call('prompts/list')).prompts as { name: string }[])
        .map((p) => p.name),
      ['app-ideas'],
    )
    let ideas = (await anon.call('prompts/get', { name: 'app-ideas' }))
      .messages[0].content.text
    assertStringIncludes(ideas, "Any yaks.app ideas you think I'd like")
    assertStringIncludes(ideas, 'I have not signed in there yet')
    assertStringIncludes(ideas, 'https://yaks.app/login')

    // A notification is answered the transport's way, with no body to sign
    // in for.
    let noted = await k.at('yaks.app', '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    })
    assertEquals(noted.status, 202)
    await noted.body?.cancel()

    // Now a person, an app, and a page of that app's own — so the refusals
    // below are refusals of things that exist.
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
      .exec(await agent.tool('app_new', { slug: 'runs', title: 'Run club' }))![
        1
      ]
    await agent.tool('app_files', {
      space,
      app: 'runs',
      files: [
        { path: 'vocab.json', content: '{"jog":{"miles":"number"}}' },
        {
          path: 'tools.json',
          content: JSON.stringify({
            leaderboard: {
              description: 'Every run so far',
              input: {},
              query: '.jog!',
              view: 'leaderboard.html',
            },
          }),
        },
        { path: 'leaderboard.html', content: '<!doctype html><ol id=board>' },
      ],
    })
    await agent.tool('app_deploy', { space, app: 'runs' })
    let view = `ui://${space}/runs/leaderboard.html`
    assertStringIncludes(
      (await agent.call('resources/read', { uri: view })).contents[0].text,
      '<base href=',
    )

    // THE thing that must not have moved: every protected method answers the
    // 401 it always answered, carrying the challenge that names our
    // authorization server. A client reads this header to find the OAuth
    // door; without it, making anything public would have cost everybody the
    // ability to sign in.
    let challenge = ''
    let shut = async (method: string, params: unknown = {}) => {
      let r = await post(method, params)
      let body = await r.json()
      let said = r.headers.get('www-authenticate') ?? ''
      assertEquals(r.status, 401, `${method} ${JSON.stringify(params)}`)
      // The challenge names where the metadata that names the authorization
      // server is — and every refusal says the same one, so no method has
      // grown a different way of being shut.
      assertMatch(
        said,
        /^Bearer realm="OAuth", resource_metadata="http.*\/\.well-known\/oauth-protected-resource\/mcp"$/,
      )
      challenge = challenge || said
      assertEquals(said, challenge, method)
      // And the same challenge said a second way, inside the refusal itself:
      // ChatGPT draws its sign-in button off `_meta['mcp/www_authenticate']`
      // and not off the header, so the two halves ride together or the person
      // is stuck (T-34349). It carries the `error` and `error_description`
      // that half wants, and the sentence says where signing in happens.
      // One builder makes both (identity.ts `challenge`); they are compared by
      // shape and not spelling because wrangler's dev proxy puts its public
      // port into a header and never into a body, so only here do the two
      // origins read differently.
      assertEquals(body.result.isError, true)
      assertStringIncludes(
        body.result.content[0].text,
        'https://yaks.app/login',
      )
      let carried = body.result._meta['mcp/www_authenticate'] as string[]
      assertEquals(carried.length, 1)
      assertMatch(
        carried[0],
        /^Bearer realm="OAuth", resource_metadata="http.*\/\.well-known\/oauth-protected-resource\/mcp", error="invalid_token", error_description="sign in at https:\/\/yaks\.app\/login[^"]*"$/,
      )
    }
    // A tool of the platform's, an app's own command, and a tool nobody
    // wrote: one answer for all three, so nothing here says which apps exist.
    // The generic tier's WRITE is among them — it is LISTED signed out
    // (T-34541) and it is this refusal that answers a call, which is the
    // sequence a host walks into the sign-in.
    await shut('tools/call', { name: 'graph_apply', arguments: { change: [] } })
    await shut('tools/call', { name: 'app_list' })
    await shut('tools/call', {
      name: 'command',
      arguments: { name: 'leaderboard' },
    })
    await shut('tools/call', { name: 'nope' })
    // Every prompt but the ideas one asks for something to be built or
    // shared, so it stays a person's own.
    await shut('prompts/get', { name: PROMPTS[0].name })
    await shut('logging/setLevel', { level: 'error' })
    // The platform's own views, the app's own page, and an asset that is not
    // the guide — the public read is a named list, not a way to fetch the
    // site.
    await shut('resources/read', { uri: APPS })
    await shut('resources/read', { uri: ERRORS })
    await shut('resources/read', { uri: view })
    await shut('resources/read', { uri: 'https://yaks.app/index.html' })
    await shut('resources/read', { uri: 'https://yaks.app/guide/nope.md' })
    await shut('nonsense/method')
    // A body nobody could read: a refusal every caller gets, and still the
    // challenge for one who has not signed in.
    let bad = await k.at('yaks.app', '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    assertEquals(bad.status, 401)
    await bad.body?.cancel()
    // A credential that did not VERIFY is not an anonymous caller (T-34344).
    // Nobody at all gets the public surface; somebody whose token expired, was
    // revoked, was minted for another resource, or is simply garbage gets the
    // 401 and the challenge — the answer MCP's spec requires, and the only one
    // Claude reads as "sign in again", since it honors no `WWW-Authenticate`
    // on a 200. Answered on `tools/list`, which is exactly what a stranger IS
    // served, so nothing here can pass by falling through to the public list.
    let offered = async (headers: Record<string, string>) => {
      let r = await k.at('yaks.app', '/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      })
      assertEquals(r.status, 401, JSON.stringify(headers))
      assertEquals(r.headers.get('www-authenticate'), challenge)
      assertEquals((await r.json()).error.code, 'unauthorized')
    }
    await offered({ authorization: 'Bearer nope' })
    // Shaped like one of ours and known to nobody: what a token this provider
    // minted reads as once its grant is revoked or its record has expired out
    // of the store, and what somebody else's server mints for their own
    // resource.
    await offered({
      authorization:
        `Bearer ${crypto.randomUUID()}:${crypto.randomUUID()}:${crypto.randomUUID()}`,
    })
    // A scheme this door does not take at all is still a caller who tried.
    await offered({ authorization: 'Basic bm9wZTpub3Bl' })
    // And the cookie half of the same rule: a session that ran out.
    await offered({
      cookie: `${COOKIE}=${await sign(
        {
          person: jeff.person,
          space: null,
          exp: Math.floor(Date.now() / 1000) - 60,
        },
        k.secret,
      )}`,
    })

    // And the stream, which is a person's own: there is no public one.
    let stream = await k.at('yaks.app', '/mcp', {
      headers: { accept: 'text/event-stream' },
    })
    assertEquals(stream.status, 401)
    assertEquals(stream.headers.get('www-authenticate'), challenge)
    await stream.body?.cancel()

    // Signing in swaps no surface and adds no NAME: the roster is one list
    // for everybody (T-34541), and what changes is which of them will answer
    // — said per tool in `securitySchemes`, which is the field a host reads to
    // know when to ask for the sign-in. Every public resource is still listed.
    let fullSchemes = await schemes(agent)
    let full = Object.keys(fullSchemes)
    let open = listed.map((t) => t.name)
    // Every tool says how it is reached, and a tool that works signed out
    // says the same thing on both lists — one tool cannot need signing in on
    // one and not the other. The scope is the one our resource metadata names
    // (identity.ts).
    let openTools = [
      'about',
      'app_published',
      'feedback',
      'gallery_search',
      'guide',
    ]
    for (let name of openTools) {
      assertEquals(fullSchemes[name], [
        { type: 'noauth' },
        { type: 'oauth2', scopes: ['graph'] },
      ], name)
    }
    for (let name of full.filter((n) => !openTools.includes(n))) {
      assertEquals(fullSchemes[name], [{
        type: 'oauth2',
        scopes: ['graph'],
      }], name)
    }
    // The same names, in the same order, whoever is asking: this is the list
    // a directory snapshots at submission and serves forever, so a tool a
    // signed-in person has and the snapshot never saw would be a tool nobody
    // could call (T-34541).
    assertEquals(full, open)
    // And an app's own verbs are not in it at all — they are commands, which
    // these two tools carry.
    assert(full.includes('commands') && full.includes('command'))
    assertEquals(full.some((n) => n.includes('log_run')), false)
    // The same words, and one thing more: the list this door is serving them
    // and the version naming it (T-34277), which is the answer to "is my tool
    // list still the tool list". Nobody signed in has a roster to be told
    // about — the public list is this one tool.
    let ours = await agent.tool('about')
    assertStringIncludes(ours, said)
    assertMatch(ours, /The tools here right now, roster [0-9a-f]{8}:/)
    for (let name of full) assertStringIncludes(ours, name)
    let mine = ((await agent.call('resources/list')).resources as {
      uri: string
    }[]).map((r) => r.uri)
    assert(pages.every((p) => mine.includes(p.uri)), 'the guide is still hers')
    assert(mine.includes(APPS) && mine.includes(view))
  } finally {
    await k.stop()
  }
})

// The anonymous surface (T-34467). Owner, 2026-09-06: "we should expose as
// much as possible to the anon users, but obviously, most things will require
// auth." So the rule is the web's own — anything a browser at the address
// would show somebody who never signed in, this door shows: the guide, the
// gallery of published apps, and the DATA of one app anyone with the link can
// read, named on the call. Nothing else, and no write.
slow('signed out: the gallery, the guide, and one public app', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'ada', apps: [] }])
    let agent = connector(k, them.cookie)
    let anon = connector(k)
    let made = async (
      slug: string,
      comp: string,
      cols: Record<string, string>,
      access?: string,
    ) => {
      await agent.tool('app_new', {
        space: 'ada',
        slug,
        title: slug,
        ...(access ? { access } : {}),
      })
      await agent.tool('app_files', {
        space: 'ada',
        app: slug,
        files: [{
          path: 'vocab.json',
          content: JSON.stringify({ [comp]: cols }),
        }],
      })
      await agent.tool('app_deploy', { space: 'ada', app: slug })
    }
    // One app anyone with the link reads, one only its members do.
    await made('runs', 'jog', { miles: 'number' })
    await made('diary', 'confession', { mood: 'text' }, 'private')
    let run = crypto.randomUUID()
    await agent.tool('graph_apply', {
      space: 'ada',
      app: 'runs',
      entities: [{
        entity: { eid: run },
        doc: { title: 'Morning loop' },
        jog: { miles: 3 },
      }],
    })
    await agent.tool('graph_apply', {
      space: 'ada',
      app: 'diary',
      entities: [{
        entity: { eid: crypto.randomUUID() },
        doc: { title: 'Tuesday' },
        confession: { mood: 'fine' },
      }],
    })
    await agent.tool('app_publish', {
      space: 'ada',
      app: 'runs',
      name: 'run-club',
      about: 'A log of everybody runs',
    })

    // THE LIST a stranger reads: what they may CALL — the four generic READS,
    // each scoped to one app, and the platform tools that need nobody — beside
    // the menu of what they may not (T-34465). A tool says which it is in the
    // one field a host reads for exactly that, so the two halves are told
    // apart here the same way ChatGPT tells them apart.
    let listed = (await anon.call('tools/list')).tools as {
      name: string
      annotations: Record<string, boolean>
      inputSchema: { properties: Record<string, unknown>; required?: string[] }
      _meta?: { securitySchemes?: { type: string }[] }
    }[]
    let open = listed.filter((t) =>
      t._meta?.securitySchemes?.some((s) => s.type == 'noauth')
    )
    assertEquals(open.map((t) => t.name).sort(), [
      'about',
      'app_published',
      'feedback',
      'gallery_search',
      'graph_query',
      'graph_schema',
      'graph_show',
      'guide',
      'search',
    ])
    for (let t of open) {
      // Each works with a token and without one: no token is needed, and one
      // is welcome.
      assertEquals(t._meta?.securitySchemes, [
        { type: 'noauth' },
        { type: 'oauth2', scopes: ['graph'] },
      ], t.name)
    }
    // The write is LISTED and refused (T-34541), like every other tool a
    // stranger may not call: the list is one list for everybody, because it is
    // the list a directory snapshots, and `securitySchemes` is what tells the
    // two halves apart.
    let shut = listed.find((t) => t.name == 'graph_apply')!
    assertEquals(shut._meta?.securitySchemes?.map((one) => one.type), [
      'oauth2',
    ])
    assert(listed.some((t) => t.name == 'app_new'), 'the menu is still there')
    for (let name of ['graph_query', 'graph_schema', 'graph_show', 'search']) {
      let t = listed.find((one) => one.name == name)!
      assertEquals(t.annotations.readOnlyHint, true, name)
      // And each says which app to name, and that naming it is not optional.
      assertEquals(t.inputSchema.required?.includes('app'), true, name)
      assertEquals(t.inputSchema.required?.includes('space'), true, name)
    }

    // The guide, read here instead of fetched off the web.
    assertStringIncludes(await anon.tool('guide'), '# ')
    assertStringIncludes(await anon.tool('guide', { page: 'querying' }), '# ')

    // The gallery, and the same list searched — an offer is made to everybody,
    // so browsing it needs nobody.
    assertStringIncludes(await anon.tool('app_published'), 'run-club')
    assertStringIncludes(
      await anon.tool('app_published', { words: 'log runs' }),
      'run-club',
    )
    assertStringIncludes(
      await anon.tool('app_published', { words: 'kayak' }),
      'nothing published says kayak',
    )

    // The public app's own data, named on the call — the answer its page
    // gets at that address, through the tool an agent already has.
    let rows = JSON.parse(
      await anon.tool('graph_query', {
        space: 'ada',
        app: 'runs',
        q: '.jog!&.doc?',
      }),
    ) as { entity: { eid: string }; doc: { title: string } }[]
    assertEquals(rows.length, 1)
    assertEquals(rows[0].entity.eid, run)
    assertEquals(rows[0].doc.title, 'Morning loop')
    let page = await client(k, 'ada.yaks.app', 'runs').get('.jog!')
    assertEquals(page.map((r) => r.entity.eid), [run])
    // Whole, by id, and by its words.
    let shown = JSON.parse(
      await anon.tool('graph_show', {
        space: 'ada',
        app: 'runs',
        ids: [run],
        backrefs: false,
      }),
    ) as { bundles: { entity: { eid: string } }[] }
    assertEquals(shown.bundles[0].entity.eid, run)
    let found = JSON.parse(
      await anon.tool('search', {
        space: 'ada',
        app: 'runs',
        words: 'Morning',
      }),
    ) as { entity: { eid: string } }[]
    assertEquals(found[0].entity.eid, run)
    // And the app's own word is in the schema it answers — the vocabulary of
    // THAT app, because it is the only one this caller is reading.
    let words = await anon.tool('graph_schema', { space: 'ada', app: 'runs' })
    assertStringIncludes(words, 'jog')
    assertEquals(words.includes('confession'), false)

    // A private app is refused BY NAME: its address already answers a browser
    // that way, so saying it plainly is what tells "not that app" from "not
    // signed in".
    let hidden = await assertRejects(
      () =>
        anon.tool('graph_query', {
          space: 'ada',
          app: 'diary',
          q: '.confession!',
        }),
      Error,
    )
    assertStringIncludes(hidden.message, 'ada/diary is private')
    // A read that names no app says the app is what is missing, and where the
    // apps to read are listed.
    let bare = await assertRejects(
      () => anon.tool('graph_query', { q: '.jog!' }),
      Error,
    )
    assertStringIncludes(bare.message, 'signed out, a read answers for ONE app')
    assertStringIncludes(bare.message, 'app_published')
    // Naming an app on the query LINE is not a way around it either: `.in=`
    // asks about a membership, and a stranger holds none.
    let inLine = await assertRejects(
      () => anon.tool('graph_query', { q: '.in=ada/diary&.confession!' }),
      Error,
    )
    assertStringIncludes(inLine.message, 'signed out')

    // Feedback, from somebody with no account: the words are kept and the
    // letter says who it is from, which is nobody.
    let sent = await anon.tool('feedback', {
      text: 'The gallery could say how many people installed each one.',
    })
    assertStringIncludes(sent, 'people who run yaks.app')
    let mailed = await letter(k, 'hello@yaks.app', 'how many people installed')
    assertStringIncludes(mailed.body, 'someone, signed out')
    // And one an hour, shared by everybody signed out — harder than a
    // person's own three, and still a pause rather than a no.
    let held = await assertRejects(
      () => anon.tool('feedback', { text: 'And another thought.' }),
      Error,
    )
    assertStringIncludes(held.message, 'pause, not a no')
    assertStringIncludes(held.message, 'https://yaks.app/login')

    // Everything else is the challenge, exactly as it was: a tool of the
    // platform's that reads somebody's own apps, and the write.
    for (
      let call of [
        { name: 'app_list' },
        { name: 'graph_apply', arguments: { change: [] } },
      ]
    ) {
      let r = await k.at('yaks.app', '/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: call,
        }),
      })
      assertEquals(r.status, 401, call.name)
      let body = await r.json()
      assertEquals(body.result.isError, true)
      assertStringIncludes(
        body.result._meta['mcp/www_authenticate'][0],
        'resource_metadata=',
      )
    }

    // Signing in adds and never swaps: the same words the stranger read, and
    // the whole list beside them.
    let full = ((await agent.call('tools/list')).tools as { name: string }[])
      .map((t) => t.name)
    for (let name of listed.map((t) => t.name)) {
      assert(full.includes(name), `${name} is not on the signed-in list`)
    }
    assert(full.includes('graph_apply'))
  } finally {
    await k.stop()
  }
})

// The address for a host that cannot do mixed auth (T-34416), walked in the
// order such a host walks it: probe anonymously, read the status, follow the
// challenge to the two metadata documents, and only then sign in. At `/mcp`
// the probe answers 200 and the host writes down "no auth"; at
// `/mcp?auth=required` it answers the challenge, which is the whole
// difference — everything past signing in is the same door and the same list.
slow('?auth=required answers the challenge a probing host needs', async () => {
  let k = await kernel()
  try {
    let hello = (auth?: string) => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(auth ? { authorization: auth } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: HELLO,
      }),
    })

    // Step 1, the probe. Lazy at `/mcp` — this is what Claude is given and
    // what T-33030 is for — and the challenge at the strict address.
    let lazy = await k.at('yaks.app', '/mcp', hello())
    assertEquals(lazy.status, 200)
    assertEquals((await lazy.json()).result.serverInfo.name, 'yaks.app')
    let probe = await k.at('yaks.app', '/mcp?auth=required', hello())
    assertEquals(probe.status, 401)
    await probe.body?.cancel()

    // Step 2, the challenge names where the metadata is (RFC 9728). It names
    // `/mcp`, not the query: the resource is one resource, said two ways.
    let says = probe.headers.get('www-authenticate') ?? ''
    let where = /resource_metadata="([^"]+)"/.exec(says)?.[1] ?? ''
    assertEquals(
      new URL(where).pathname,
      '/.well-known/oauth-protected-resource/mcp',
    )

    // Step 3, the protected-resource document, and the authorization server
    // it names.
    let prm = await (await k.at('yaks.app', new URL(where).pathname)).json()
    assertEquals(prm.scopes_supported, ['graph'])
    assertMatch(prm.resource, /\/mcp$/)
    assertEquals(prm.authorization_servers.length, 1)

    // Step 4, the authorization server's own document: every endpoint the
    // host has to be handed, and the two things it checks before it starts —
    // that S256 is offered, and that it can name itself without a secret,
    // either by registering (RFC 7591) or by CIMD.
    let as = await (await k.at(
      'yaks.app',
      '/.well-known/oauth-authorization-server',
    )).json()
    assertMatch(as.authorization_endpoint, /\/oauth\/authorize$/)
    assertMatch(as.token_endpoint, /\/oauth\/token$/)
    assertMatch(as.registration_endpoint, /\/oauth\/register$/)
    assertEquals(as.code_challenge_methods_supported, ['S256'])
    assertEquals(as.scopes_supported, ['graph'])
    assert(as.token_endpoint_auth_methods_supported.includes('none'))

    // Step 5, a token that does not verify is still the challenge, at both
    // addresses — a host that lets its token lapse must be asked again and
    // never quietly handed the stranger's surface (T-34344).
    for (let at of ['/mcp', '/mcp?auth=required']) {
      let stale = await k.at('yaks.app', at, hello('Bearer nope'))
      assertEquals(stale.status, 401)
      assertMatch(stale.headers.get('www-authenticate') ?? '', /resource_meta/)
      await stale.body?.cancel()
    }
    // And the stream, which was never public, is the challenge either way.
    for (let at of ['/mcp', '/mcp?auth=required']) {
      let held = await k.at('yaks.app', at, {
        headers: { accept: 'text/event-stream' },
      })
      assertEquals(held.status, 401)
      await held.body?.cancel()
    }

    // Step 6, signed in. The strict address is the SAME door: the whole tool
    // list, not the stranger's one, and byte for byte what `/mcp` serves.
    let jeff = await signIn(k)
    let tools = async (at: string) => {
      let r = await k.at('yaks.app', at, {
        method: 'POST',
        headers: {
          cookie: jeff.cookie,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      })
      assertEquals(r.status, 200)
      return ((await r.json()).result.tools as { name: string }[])
        .map((t) => t.name)
    }
    let strict = await tools('/mcp?auth=required')
    assertEquals(strict, await tools('/mcp'))
    assert(strict.includes('app_new'), 'the whole list, not the public one')
    assert(strict.length > 1)
  } finally {
    await k.stop()
  }
})

// MIXED AUTH, played through at plain `/mcp` in the order OpenAI documents it
// (developers.openai.com/plugins/build/auth, read 2026-09-06) — owner,
// 2026-09-06: "mixed auth is documented and should work correctly. chatgpt
// will then prompt auth on the first auth-required tool use".
//
// The host connects with nobody signed in, lists the WHOLE surface, reads each
// tool's `securitySchemes` to see which want a token, and offers the sign-in
// the first time the person asks for one of those — the refusal carrying
// `_meta['mcp/www_authenticate']` is what it draws that button from. Then the
// half every OAuth client walks: the challenge to the two metadata documents,
// dynamic registration as a public client, authorization code with PKCE, and
// the exchange — which ChatGPT sends carrying a `client_secret` it was never
// issued (T-34416), in the code grant exactly as in the refresh.
//
// One test rather than five because it is one sequence: every step here is
// what the step before it handed over, and a break anywhere in it is a person
// looking at a connector that will not connect.
slow(
  'mixed auth: a stranger reads the menu, then signs in for it',
  async () => {
    let k = await kernel()
    try {
      let say = async (
        method: string,
        params: unknown = {},
        token?: string,
      ) => {
        let r = await k.at('yaks.app', '/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
        return {
          status: r.status,
          said: r.headers.get('www-authenticate') ?? '',
          body: await r.json(),
        }
      }

      // 1. The probe. A host doing mixed auth opens with no credential, and
      // being ANSWERED is what tells it this server has an anonymous surface.
      let hello = await say('initialize', HELLO)
      assertEquals(hello.status, 200)
      facing(hello.body.result.serverInfo)

      // 2. The menu. Every tool a stranger is shown says what it wants: `about`
      // is `noauth` and callable now, the platform's verbs are `oauth2` and are
      // the reason there is anything to sign in FOR. A list holding only what a
      // stranger may call is a connector that can never ask them to sign in.
      let listed = (await say('tools/list')).body.result.tools as {
        name: string
        _meta?: { securitySchemes?: { type: string; scopes?: string[] }[] }
      }[]
      let wants = new Map(listed.map((t) => [t.name, t._meta?.securitySchemes]))
      for (let [name, schemes] of wants) {
        assert(schemes?.length, `${name} declares nothing about signing in`)
      }
      // A tool a stranger may call says BOTH: no token is needed and one is
      // welcome, which is how a host tells the open half of a mixed-auth
      // surface from the closed half (T-34467).
      assertEquals(wants.get('about'), [
        { type: 'noauth' },
        { type: 'oauth2', scopes: ['graph'] },
      ])
      assertEquals(wants.get('guide'), [
        { type: 'noauth' },
        { type: 'oauth2', scopes: ['graph'] },
      ])
      assertEquals(wants.get('app_list'), [{
        type: 'oauth2',
        scopes: ['graph'],
      }])
      assertEquals(wants.get('app_new'), [{
        type: 'oauth2',
        scopes: ['graph'],
      }])
      assert(wants.size > 2, 'the whole menu, not the two open tools')
      // And the open half is open: `about` answers a stranger.
      let open = await say('tools/call', { name: 'about', arguments: {} })
      assertEquals(open.status, 200)
      assertEquals(open.body.result.isError, undefined)

      // 3. The person asks for an app, so the host calls the tool that makes
      // one — and the refusal is a tool RESULT carrying the challenge, which is
      // the half ChatGPT reads to draw its sign-in button.
      let asked = await say('tools/call', { name: 'app_list', arguments: {} })
      assertEquals(asked.status, 401)
      assertEquals(asked.body.result.isError, true)
      let challenge = asked.body.result
        ._meta['mcp/www_authenticate'][0] as string
      assertMatch(challenge, /error="[^"]+", error_description="[^"]+"/)
      let where = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] ?? ''
      assertEquals(
        new URL(where).pathname,
        '/.well-known/oauth-protected-resource/mcp',
      )

      // 4. The two metadata documents that challenge names, and the two things
      // a public client checks before it starts: that it can name itself with
      // no secret, and that S256 is offered.
      let prm = await (await k.at('yaks.app', new URL(where).pathname)).json()
      assertEquals(prm.scopes_supported, ['graph'])
      assertEquals(prm.authorization_servers.length, 1)
      let as = await (await k.at(
        'yaks.app',
        '/.well-known/oauth-authorization-server',
      )).json()
      assert(as.token_endpoint_auth_methods_supported.includes('none'))
      assertEquals(as.code_challenge_methods_supported, ['S256'])

      // 5. Registration, as the public client ChatGPT registers itself as: no
      // secret is issued, and PKCE is what protects the code instead.
      let back = 'https://probe.invalid/cb'
      let reg = await k.at(
        'yaks.app',
        new URL(as.registration_endpoint).pathname,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: 'A mixed-auth host',
            redirect_uris: [back],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          }),
        },
      )
      assertEquals(reg.status, 201)
      let { client_id, client_secret } = await reg.json()
      assert(client_id, 'a registered client')
      assertEquals(client_secret, undefined, 'a public client holds no secret')

      // 6. The person signs in and allows it: authorization code with PKCE.
      let jeff = await signIn(k)
      let verifier = crypto.randomUUID() + crypto.randomUUID()
      let q = new URLSearchParams({
        response_type: 'code',
        client_id,
        redirect_uri: back,
        state: 'a-mixed-state',
        scope: 'graph',
        code_challenge: b64u(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(verifier),
          ),
        ),
        code_challenge_method: 'S256',
      }).toString()
      let granted = await k.at('yaks.app', '/oauth/allow', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: jeff.cookie,
        },
        body: new URLSearchParams({ q }).toString(),
      })
      assertEquals(granted.status, 302)
      let to = new URL(granted.headers.get('location') ?? '')
      assertEquals(to.searchParams.get('state'), 'a-mixed-state')
      let code = to.searchParams.get('code') ?? ''
      assert(code, 'an authorization code')

      // 7. The exchange, carrying a `client_secret` this client was never
      // issued — which is what ChatGPT sends, on the code grant as on the
      // refresh. Refusing it is the "your connection has expired" a person
      // reads at the end of a flow that worked (T-34416).
      let token = (fields: Record<string, string>) =>
        k.at('yaks.app', new URL(as.token_endpoint).pathname, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields).toString(),
        })
      let first = await token({
        grant_type: 'authorization_code',
        code,
        client_id,
        client_secret: 'invented',
        redirect_uri: back,
        code_verifier: verifier,
      })
      assertEquals(first.status, 200, await first.clone().text())
      let got = await first.json()
      assert(got.access_token && got.refresh_token)

      // 8. And the tool that was refused now answers: the sign-in the menu
      // asked for is the whole of what was missing.
      let served = await say(
        'tools/call',
        { name: 'app_list', arguments: {} },
        got.access_token,
      )
      assertEquals(served.status, 200)
      assertEquals(served.body.result.isError, undefined)

      // 9. And it keeps answering: the refresh carries the invented secret too.
      let next = await token({
        grant_type: 'refresh_token',
        refresh_token: got.refresh_token,
        client_id,
        client_secret: 'invented',
      })
      assertEquals(next.status, 200, await next.clone().text())
      let again = await next.json()
      let still = await say(
        'tools/call',
        { name: 'app_list', arguments: {} },
        again.access_token,
      )
      assertEquals(still.status, 200)
      assertEquals(still.body.result.isError, undefined)
    } finally {
      await k.stop()
    }
  },
)
