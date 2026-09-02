// The connector's contract, held in workerd (probe.ts boots the kernel): an
// MCP session initialized and its tools listed, a space and an app born
// through the sugar and served through the kernel, a bundle written and
// read back through the graph tier, and a route that threw reaching the
// agent as the next reply's unseen section — once — then through
// app_errors.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
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
        'app_set',
        'app_errors',
        'graph_apply',
        'graph_query',
        'search',
      ])
      assert(tools.every((t: { inputSchema: unknown }) => t.inputSchema))

      // What a model reads before anything else: the address, the four
      // steps, and the store a page writes to — enough to build the first
      // app WITH its data without opening anything (T-32481).
      for (
        let said of [
          '<space>.yaks.app/<app>/',
          'app_new',
          'app_files',
          'app_deploy',
          "import { apply, query, search } from './api/client.js'",
          'not localStorage',
        ]
      ) assertStringIncludes(init.instructions, said)
      let says = (name: string) =>
        tools.find((t: { name: string }) => t.name == name).description
      assertStringIncludes(says('app_files'), './api/client.js')
      assertStringIncludes(says('app_files'), 'never localStorage')
      assertStringIncludes(says('graph_query'), '.doc!')
      assertStringIncludes(says('graph_apply'), './api/client.js')

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
      // A space needs no naming: the caller's own is the default, and with
      // more than one the tools say which names there are (T-32482).
      assertMatch(
        await agent.tool('app_new', { slug: 'garden', title: 'Garden' }),
        /jeff\.yaks\.app\/garden\//,
      )
      assertEquals(
        await agent.tool('app_files', { app: 'garden', op: 'list' }),
        '(no files)',
      )
      await agent.tool('space_new', { slug: 'jeff-work', title: 'Work' })
      await assertRejects(
        () => agent.tool('app_new', { slug: 'x', title: 'X' }),
        Error,
        'name one of jeff, jeff-work',
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
      // A file a person asks to be rid of: gone from the listing and from
      // the address, and asking twice says so rather than pretending.
      await agent.tool('app_files', {
        ...app,
        op: 'write',
        path: 'draft.html',
        content: '<p>oops',
      })
      assertMatch(
        await agent.tool('app_files', {
          ...app,
          op: 'delete',
          path: 'draft.html',
        }),
        /deleted draft\.html/,
      )
      await assertRejects(
        () =>
          agent.tool('app_files', { ...app, op: 'delete', path: 'draft.html' }),
        Error,
        'no file draft.html',
      )
      assertEquals(
        (await k.at('jeff.yaks.app', '/recipes/draft.html')).status,
        404,
      )
      assertMatch(await agent.tool('app_deploy', app), /v1/)
      assertMatch(await agent.tool('app_deploy', app), /v2/)
      let served = await k.at('jeff.yaks.app', '/recipes/')
      assertEquals(served.status, 200)
      assertStringIncludes(await served.text(), page)
      let bare = await k.at('jeff.yaks.app', '/', { redirect: 'manual' })
      assertEquals(bare.headers.get('location'), '/recipes/')

      // The graph tier: a bundle in, the same shape out, the search beside
      // it. A write answers one line naming what it wrote, by id, with the
      // alias it minted (T-32506) — never the wire's change rows.
      let applied = await agent.tool('graph_apply', {
        ...app,
        entities: [{
          entity: { eid: '$cake' },
          doc: { title: "Grandma's lemon cake" },
        }],
      })
      assertMatch(applied, /^wrote 1 entity in jeff\/recipes: \$cake=\S+$/)
      let cake = applied.match(/\$cake=(\S+)/)![1]
      let [hit] = JSON.parse(
        await agent.tool('graph_query', { ...app, query: `id=${cake}` }),
      )
      assertEquals(hit.entity.eid, cake)
      assertEquals(hit.doc.title, "Grandma's lemon cake")
      // A listing is what the person saved: the store's stamps about saving
      // it are not in the answer unless the filter names one.
      assert(!('created' in hit), 'no stamp rides an unasked-for listing')
      let stamped = JSON.parse(
        await agent.tool('graph_query', { ...app, query: '.doc!&.created!' }),
      )
      assertEquals(stamped.length, 1)
      assert(stamped[0].created, 'naming a stamp asks for it back')
      let found = JSON.parse(
        await agent.tool('search', { ...app, text: 'lemon' }),
      )
      assertEquals(
        found.map((r: { entity: { eid: string } }) => r.entity.eid),
        [cake],
      )
      // The app's OWN components: vocab.json declares them, app_deploy plants
      // them in this app's store, and nothing about them exists in any other.
      // Both doors teach the same missing act, with no other graph's ids in
      // the sentence.
      for (
        let ask of [
          () =>
            agent.tool('graph_apply', {
              ...app,
              entities: [{ entity: { eid: '$r' }, recipe: { serves: 4 } }],
            }),
          () => agent.tool('graph_query', { ...app, query: '.recipe!' }),
        ]
      ) {
        let why = (await assertRejects(ask, Error)).message
        assertStringIncludes(why, 'vocab.json')
        assertStringIncludes(why, 'https://yaks.app/guide.md')
        assertEquals(/P-\d|T-\d/.test(why), false)
      }
      await agent.tool('app_files', {
        ...app,
        op: 'write',
        path: 'vocab.json',
        content: '{"recipe":{"title":"text","serves":"number"}}',
      })
      assertStringIncludes(
        await agent.tool('app_deploy', app),
        'components: recipe',
      )
      let box = (await agent.tool('graph_apply', {
        ...app,
        entities: [{
          entity: { eid: '$pancakes' },
          doc: { title: 'Pancakes' },
          recipe: { title: 'Pancakes', serves: 4 },
        }],
      })).match(/\$pancakes=(\S+)/)![1]
      let [own] = JSON.parse(
        await agent.tool('graph_query', { ...app, query: '.recipe.serves=4' }),
      )
      assertEquals(own.entity.eid, box)
      assertEquals(own.recipe, { title: 'Pancakes', serves: 4 })
      // A column the manifest never named is still a typo, not a new word.
      await assertRejects(
        () =>
          agent.tool('graph_apply', {
            ...app,
            entities: [{ entity: { eid: box }, recipe: { calories: 500 } }],
          }),
        Error,
        'unknown column: recipe.calories',
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

      // Renaming: the title is what it is called, the slug is where it
      // lives. The app moves whole — its files serve at the new address and
      // everything it saved is still there, because its store is named for
      // where it was born and not for where it lives.
      assertMatch(
        await agent.tool('app_set', {
          ...app,
          slug: 'cookbook',
          title: 'The cookbook',
        }),
        /jeff\.yaks\.app\/cookbook\/.*moved from \/recipes\//,
      )
      let moved = { space: 'jeff', app: 'cookbook' }
      let atNew = await k.at('jeff.yaks.app', '/cookbook/')
      assertEquals(atNew.status, 200)
      assertStringIncludes(await atNew.text(), page)
      assertEquals((await k.at('jeff.yaks.app', '/recipes/')).status, 404)
      assertEquals(
        await agent.tool('app_files', { ...moved, op: 'list' }),
        'css/site.css\nindex.html\nvocab.json',
      )
      let still = JSON.parse(
        await agent.tool('graph_query', { ...moved, query: `id=${cake}` }),
      )
      assertEquals(still[0].doc.title, "Grandma's lemon cake")
      assertEquals(
        (await agent.tool('app_errors', moved)).split('\n')
          .filter((l) => l.startsWith('- ')).length,
        2,
      )
      // A retitle alone leaves the address alone; a slug already taken and
      // an empty ask are both refused.
      assertMatch(
        await agent.tool('app_set', { ...moved, title: 'Recipes' }),
        /jeff\.yaks\.app\/cookbook\/$/,
      )
      await assertRejects(
        () => agent.tool('app_set', { ...moved, slug: 'garden' }),
        Error,
        'app garden exists in jeff',
      )
      await assertRejects(
        () => agent.tool('app_set', moved),
        Error,
        'nothing to change',
      )

      // A stranger belongs to no space of ours: every tool refuses him by
      // name, and he may make his own.
      let stranger = connector(k, await signedIn(k, crypto.randomUUID()))
      // Even someone who has never had a space gets one the moment they
      // need it, rather than being asked to invent a name.
      assertMatch(
        await stranger.tool('app_new', { slug: 'notes', title: 'Notes' }),
        /\.yaks\.app\/notes\//,
      )
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
