// The connector's contract, held in workerd (probe.ts boots the kernel): an
// MCP session initialized and its tools listed, a space and an app born
// through the sugar and served through the kernel, a bundle written and
// read back through the graph tier, and a route that threw reaching the
// agent as the next reply's unseen section — once — then through
// app_errors.
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { connector, kernel, signedIn } from './probe.ts'

let GUIDE = 'https://yaks.app/guide.md'

slow(
  'the connector: tools, a space made, an app served, errors seen',
  async () => {
    let k = await kernel()
    try {
      let jeff = crypto.randomUUID()
      let agent = connector(k, await signedIn(k, jeff))
      // Nobody is answered; a session is.
      await assertRejects(() => connector(k).call('initialize'), Error, '401')
      let init = await agent.call('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'probe', version: '0' },
      })
      assertEquals(init.protocolVersion, '2025-03-26')
      assertEquals(init.serverInfo.name, 'yaks.app')
      let { tools } = await agent.call('tools/list')
      assertEquals(tools.map((t: { name: string }) => t.name), [
        'space_new',
        'app_new',
        'app_files',
        'app_deploy',
        'app_errors',
        'graph_apply',
        'graph_query',
        'search',
      ])
      assert(tools.every((t: { inputSchema: unknown }) => t.inputSchema))

      // The guide the tool descriptions point at, offered as a resource and
      // read from the address that serves it.
      assert(init.capabilities.resources, 'resources are offered')
      let { resources } = await agent.call('resources/list')
      assertEquals(
        resources.map((r: { uri: string }) => r.uri),
        [GUIDE],
      )
      let read = await agent.call('resources/read', { uri: GUIDE })
      assertMatch(read.contents[0].text, /api\/client\.js/)
      await assertRejects(
        () => agent.call('resources/read', { uri: 'https://yaks.app/nope' }),
        Error,
        'no resource',
      )

      // A space, then an app in it; the slugs are one per namespace.
      assertMatch(
        await agent.tool('space_new', { slug: 'jeff', title: 'Jeff' }),
        /jeff\.yaks\.app/,
      )
      await assertRejects(
        () => agent.tool('space_new', { slug: 'jeff', title: 'Again' }),
        Error,
        'taken',
      )
      await assertRejects(
        () => agent.tool('space_new', { slug: 'Not A Slug', title: 'x' }),
        Error,
        'slug',
      )
      assertMatch(
        await agent.tool('app_new', {
          space: 'jeff',
          slug: 'recipes',
          title: 'Recipe box',
        }),
        /jeff\.yaks\.app\/recipes\//,
      )
      // Files written through the tool serve at the app's address, and the
      // first app answers the space's bare hostname.
      let page = '<!doctype html><h1>Our recipe box</h1>'
      let app = { space: 'jeff', app: 'recipes' }
      await agent.tool('app_files', {
        ...app,
        op: 'write',
        path: 'index.html',
        content: page,
      })
      await agent.tool('app_files', {
        ...app,
        op: 'write',
        path: 'css/site.css',
        content: 'h1{}',
      })
      assertEquals(
        await agent.tool('app_files', { ...app, op: 'list' }),
        'css/site.css\nindex.html',
      )
      assertEquals(
        await agent.tool('app_files', {
          ...app,
          op: 'read',
          path: 'index.html',
        }),
        page,
      )
      assertMatch(await agent.tool('app_deploy', app), /v1/)
      assertMatch(await agent.tool('app_deploy', app), /v2/)
      let served = await k.at('jeff.yaks.app', '/recipes/')
      assertEquals(served.status, 200)
      assertEquals(await served.text(), page)
      let bare = await k.at('jeff.yaks.app', '/', { redirect: 'manual' })
      assertEquals(bare.headers.get('location'), '/recipes/')

      // The graph tier: a bundle in, the same shape out, the search beside it.
      let applied = JSON.parse(
        await agent.tool('graph_apply', {
          ...app,
          entities: [{
            entity: { eid: '$cake' },
            doc: { title: "Grandma's lemon cake" },
          }],
        }),
      )
      let cake = applied.aliases.$cake
      assert(cake, 'the alias resolved')
      let [hit] = JSON.parse(
        await agent.tool('graph_query', { ...app, query: `id=${cake}` }),
      )
      assertEquals(hit.entity.eid, cake)
      assertEquals(hit.doc.title, "Grandma's lemon cake")
      let found = JSON.parse(
        await agent.tool('search', { ...app, text: 'lemon' }),
      )
      assertEquals(
        found.map((r: { entity: { eid: string } }) => r.entity.eid),
        [cake],
      )
      // A refused store answer is the tool's error, not a 500.
      await assertRejects(
        () => agent.tool('graph_query', { ...app, query: 'work=build' }),
        Error,
        'work lanes',
      )

      // A route that throws reaches the agent on its next reply, once; after
      // that only app_errors lists it, and a fresh break rides again.
      assertEquals(
        (await k.at('jeff.yaks.app', '/recipes/%E0%A4%A')).status,
        500,
      )
      let told = await agent.tool('graph_query', {
        ...app,
        query: `id=${cake}`,
      })
      assertMatch(
        told,
        /## unseen errors\n- \S+ \S+ exception recipes: GET \/recipes\/%E0%A4%A — .*URI/,
      )
      let quiet = await agent.tool('graph_query', {
        ...app,
        query: `id=${cake}`,
      })
      assert(!quiet.includes('unseen'), 'served once')
      assertEquals(
        (await k.at('jeff.yaks.app', '/recipes/%E0%A4%B')).status,
        500,
      )
      let listed = await agent.tool('app_errors', app)
      assertEquals(
        listed.split('\n').filter((l) => l.startsWith('- ')).length,
        2,
      )
      assert(
        !listed.includes('unseen'),
        'app_errors is the listing, not a second section',
      )
      assert(
        !(await agent.tool('graph_query', { ...app, query: `id=${cake}` }))
          .includes('unseen'),
      )

      // A stranger belongs to no space of ours: every tool refuses him by
      // name, and he may make his own.
      let stranger = connector(k, await signedIn(k, crypto.randomUUID()))
      await assertRejects(
        () => stranger.tool('app_files', { ...app, op: 'list' }),
        Error,
        'not a member of jeff',
      )
      await assertRejects(
        () => stranger.tool('graph_query', { ...app, query: 'id=1' }),
        Error,
        'not a member of jeff',
      )
      assertMatch(
        await stranger.tool('space_new', { slug: 'maya', title: 'Maya' }),
        /maya\.yaks\.app/,
      )
    } finally {
      await k.stop()
    }
  },
)
