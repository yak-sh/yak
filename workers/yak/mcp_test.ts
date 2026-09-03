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
let APPS = 'ui://yaks/apps'
let ERRORS = 'ui://yaks/errors'

slow(
  'the connector: tools, a space made, an app served, errors seen',
  async () => {
    let k = await kernel()
    try {
      let jeff = crypto.randomUUID()
      let agent = connector(k, await signedIn(k, jeff))
      // Nobody is answered — and the refusal says so in a sentence, with
      // where signing in happens, like every other door (C-32607 item 1).
      let shut = await k.at('yaks.app', '/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      })
      assertEquals(shut.status, 401)
      let refusal = (await shut.json()).error
      assertEquals(refusal.code, 'unauthorized')
      assertStringIncludes(refusal.message, 'sign in at https://yaks.app')
      assertEquals(refusal.signIn, 'https://yaks.app/login')
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
        'app_delete',
        'app_errors',
        'app_list',
        'member_add',
        'member_remove',
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
          "import { apply, query, search, subscribe } from './api/client.js'",
          'vocab.json',
          "subscribe('.doc!', draw)",
          'not localStorage',
          // Who an app is for is part of making it (T-32504).
          "access 'open'",
          'member_add',
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
        [GUIDE, APPS, ERRORS],
      )
      let read = await agent.call('resources/read', { uri: GUIDE })
      assertMatch(read.contents[0].text, /api\/client\.js/)

      // The first MCP App view: a ui:// resource the host renders, named by
      // the tool whose answer it draws (T-32492).
      assertEquals(
        tools.find((t: { name: string }) => t.name == 'app_list')._meta.ui
          .resourceUri,
        APPS,
      )
      let view = resources.find((r: { uri: string }) => r.uri == APPS)
      assertEquals(view.mimeType, 'text/html;profile=mcp-app')
      let drawn = (await agent.call('resources/read', { uri: APPS }))
        .contents[0]
      assertEquals(drawn.mimeType, 'text/html;profile=mcp-app')
      assertStringIncludes(drawn.text, 'ui/notifications/tool-result')
      assertStringIncludes(drawn.text, 'ui/initialize')
      await assertRejects(
        () => agent.call('resources/read', { uri: 'https://yaks.app/nope' }),
        Error,
        'no resource',
      )

      // The second view (T-32601), and the one thing its cards need that a
      // listing does not: the host only lets a view call a tool back when
      // the tool says `app` in its visibility.
      let errors = tools.find((t: { name: string }) => t.name == 'app_errors')
      assertEquals(errors._meta.ui.resourceUri, ERRORS)
      assertEquals(errors._meta.ui.visibility, ['model', 'app'])
      let cards = (await agent.call('resources/read', { uri: ERRORS }))
        .contents[0]
      assertEquals(cards.mimeType, 'text/html;profile=mcp-app')
      assertStringIncludes(cards.text, 'ui/notifications/tool-result')
      assertStringIncludes(cards.text, "name: 'app_errors'")

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
        await agent.tool('graph_query', { ...app, filter: '.doc!&.created!' }),
      )
      assertEquals(stamped.length, 1)
      assert(stamped[0].created, 'naming a stamp asks for it back')
      // The parameter is `filter` — the word every other door uses for the
      // same line — and `query` stays a spelling of it (C-32607 item 2).
      assertEquals(
        await agent.tool('graph_query', { ...app, filter: `id=${cake}` }),
        await agent.tool('graph_query', { ...app, query: `id=${cake}` }),
      )
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

      // A manifest that reaches for one of the platform's words is refused
      // WHOLE and before anything is planted, naming every collision at once
      // — so probing for a free name is one deploy, and the names tried on
      // the way do not stay in the app (C-32624 item 1).
      let manifest = (json: string) =>
        agent.tool('app_files', {
          ...app,
          op: 'write',
          path: 'vocab.json',
          content: json,
        })
      await manifest(
        '{"recipe":{"title":"text","serves":"number"},' +
          '"dayline":{"on":"time"},"card":{},"entry":{"at":"time"}}',
      )
      let taken = (await assertRejects(() =>
        agent.tool('app_deploy', app), Error))
        .message
      assertStringIncludes(
        taken,
        'card, entry are words the platform already says',
      )
      assertStringIncludes(taken, GUIDE)
      await assertRejects(
        () =>
          agent.tool('graph_apply', {
            ...app,
            entities: [{ entity: { eid: '$d' }, dayline: { on: 'today' } }],
          }),
        Error,
        'unknown component: dayline',
      )

      // And a word the next manifest stops naming goes, table and all, so
      // long as nothing was written under it.
      await manifest(
        '{"recipe":{"title":"text","serves":"number"},"jot":{"text":"text"}}',
      )
      assertStringIncludes(
        await agent.tool('app_deploy', app),
        'components: recipe, jot',
      )
      await manifest('{"note":{"text":"text"}}')
      let shed = await agent.tool('app_deploy', app)
      assertStringIncludes(shed, 'dropped (no rows): jot')
      await assertRejects(
        () =>
          agent.tool('graph_apply', {
            ...app,
            entities: [{ entity: { eid: '$j' }, jot: { text: 'hi' } }],
          }),
        Error,
        'unknown component: jot',
      )
      // `recipe` the same manifest stopped naming stays: it has rows, and
      // the rows are the record of what its columns are.
      assertStringIncludes(shed, 'components: recipe, note')
      assertEquals(
        JSON.parse(
          await agent.tool('graph_query', {
            ...app,
            query: '.recipe.serves=4',
          }),
        ).length,
        1,
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
        /## unseen errors\n- \S+ \S+ exception recipes v\d+: GET \/recipes\/%E0%A4%A — .*URI/,
      )
      // A crash is the platform's row, not the person's: `.doc!` — the query
      // the instructions teach as everything they saved — has only the cake
      // (T-32533, C-32531 item 1).
      assertEquals(
        JSON.parse(await agent.tool('graph_query', { ...app, query: '.doc!' }))
          .map((r: { doc: { title: string } }) => r.doc.title),
        ["Grandma's lemon cake", 'Pancakes'],
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
      // A break is the platform's row about the app, not a row the person
      // saved: asking for the stamps does not drag it in, and naming the
      // component is how it is asked for (C-32607 item 4).
      let stamps = JSON.parse(
        await agent.tool('graph_query', { ...app, filter: '.created!' }),
      ) as { exception?: unknown }[]
      assert(stamps.length > 0, 'the person has rows')
      assert(stamps.every((r) => !r.exception), 'no break rides a stamps list')
      assertEquals(
        JSON.parse(
          await agent.tool('graph_query', { ...app, filter: '.exception!' }),
        ).length,
        2,
      )
      assert(
        !(await agent.tool('graph_query', { ...app, query: `id=${cake}` }))
          .includes('unseen'),
      )

      // A page's own break, reported the way public/report.js reports one:
      // the stack names a file and a line in the app's OWN pages, which is
      // what the card shows and what the person opens.
      for (
        let broke of [
          { at: 'index.html:42:9', said: 'whisk is not a function' },
          { at: 'cook.js:7:3', said: 'fold is not a function' },
        ]
      ) {
        assertEquals(
          (await k.at('jeff.yaks.app', '/recipes/api/report', {
            method: 'POST',
            body: JSON.stringify({
              message: broke.said,
              stack: `TypeError: ${broke.said}\n    at https://jeff.yaks` +
                `.app/recipes/${broke.at}`,
              url: 'https://jeff.yaks.app/recipes/',
            }),
          })).status,
          204,
        )
      }

      // The errors view (T-32601): the same answer as cards — one per break,
      // the message, the file and line, the version it happened on, how many
      // times. A break on the way in has no address to open, so it wears its
      // request instead.
      let asOf = async (args: unknown = app) =>
        await agent.call('tools/call', { name: 'app_errors', arguments: args })
      let seen = await asOf()
      let breaks = seen.structuredContent.errors as {
        eids: string[]
        message: string
        where: string
        version: number
        count: number
      }[]
      assertEquals(seen.structuredContent.app, 'recipes')
      assertEquals(
        breaks.map((b) => `${b.message} @ ${b.where} x${b.count}`).sort(),
        [
          'URI malformed @ GET /recipes/%E0%A4%A x1',
          'URI malformed @ GET /recipes/%E0%A4%B x1',
          'fold is not a function @ /recipes/cook.js:7 x1',
          'whisk is not a function @ /recipes/index.html:42 x1',
        ],
      )
      // v5: two files, a vocabulary, the word it dropped — every deploy
      // above bumped it, and a break wears the version it happened on.
      assert(breaks.every((b) => b.version == 5), 'the deploy it happened on')

      // The fixed button: the view calls this same tool back through the
      // host with the card's eids, and what it gets is the listing that is
      // left — so the break stops showing here and in every later reply.
      let whisk = breaks.find((b) => b.where == '/recipes/index.html:42')!
      let after = await asOf({ ...app, fixed: whisk.eids })
      assertStringIncludes(after.content[0].text, 'archived 1')
      assertEquals(after.structuredContent.errors.length, 3)
      assert(
        !after.content[0].text.includes('whisk'),
        'archived is not listed',
      )

      // The agent's own door is the same one, by the id it read off a line.
      let said = String(after.content[0].text).split('\n')
        .find((l) => l.includes('fold is not a function'))!
      assertStringIncludes(
        await agent.tool('app_errors', { ...app, fixed: [said.split(' ')[1]] }),
        'archived 1',
      )
      await assertRejects(
        () => agent.tool('app_errors', { ...app, fixed: ['X-99999'] }),
        Error,
        'nothing open here',
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
      // The address it left keeps answering, permanently, as the move it
      // was: a link someone already has still finds the app, and a page still
      // open on the old address still writes to it (C-32574 item 4, where a
      // rename broke every open phone in silence).
      let asked = (path: string, init?: RequestInit) =>
        k.at('jeff.yaks.app', path, { ...init, redirect: 'manual' })
      let gone = await asked('/recipes/')
      assertEquals(gone.status, 301)
      assertEquals(gone.headers.get('location'), '/cookbook/')
      assertEquals(
        (await asked('/recipes/css/site.css')).headers.get('location'),
        '/cookbook/css/site.css',
      )
      // A write keeps its method — a 301 is retried as a GET, which would
      // land a page's `apply` on the query door.
      let write = await asked('/recipes/api/apply', {
        method: 'POST',
        body: '[]',
      })
      assertEquals(write.status, 308)
      assertEquals(write.headers.get('location'), '/cookbook/api/apply')
      // A second move keeps the first address too: every address the app has
      // ever had points at where it is now.
      await agent.tool('app_set', { ...moved, slug: 'kitchen' })
      for (let was of ['/recipes/', '/cookbook/']) {
        assertEquals((await asked(was)).headers.get('location'), '/kitchen/')
      }
      // An address is not free just because an app left it.
      await assertRejects(
        () =>
          agent.tool('app_new', {
            space: 'jeff',
            slug: 'recipes',
            title: 'Recipes again',
          }),
        Error,
        'used to be',
      )
      // …and back, so the rest of this reads of the cookbook. An address the
      // app returns to is its own again, never a redirect to itself.
      await agent.tool('app_set', {
        space: 'jeff',
        app: 'kitchen',
        slug: 'cookbook',
      })
      assertEquals((await asked('/cookbook/')).status, 200)
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

      // What the person has, in a sentence for the model and as data for the
      // view beside it: every space, every app, its address, its version and
      // what is still broken in it.
      let listing = await agent.call('tools/call', {
        name: 'app_list',
        arguments: {},
      })
      assertStringIncludes(listing.content[0].text, 'jeff — https://jeff')
      assertMatch(
        listing.content[0].text,
        /Recipes \(cookbook\) v\d+, 2 open: https:\/\/jeff\.yaks\.app\/cookbook\//,
      )
      let { spaces } = listing.structuredContent
      assertEquals(spaces.map((s: { slug: string }) => s.slug), [
        'jeff',
        'jeff-work',
      ])
      assertEquals(spaces[0].apps.map((a: { slug: string }) => a.slug), [
        'cookbook',
        'garden',
      ])
      assertEquals(spaces[0].apps[0].errors, 2)
      assertEquals(spaces[0].apps[0].url, 'https://jeff.yaks.app/cookbook/')
      assertEquals(spaces[1].apps, [])
      assertEquals(
        (await agent.tool('app_list', { space: 'jeff-work' })).split('\n'),
        ['jeff-work — https://jeff-work.yaks.app/', '- no apps yet'],
      )

      // Thrown away: an app made, written, deployed, then deleted whole —
      // its address stops answering, the listing forgets it, and an app made
      // at the same address afterwards starts with nothing, because the
      // store it was born naming was emptied with it (T-32562).
      let scratch = { space: 'jeff', app: 'scratch' }
      await agent.tool('app_new', {
        space: 'jeff',
        slug: 'scratch',
        title: 'Sc',
      })
      await agent.tool('app_files', {
        ...scratch,
        op: 'write',
        path: 'index.html',
        content: '<!doctype html><h1>throwaway</h1>',
      })
      await agent.tool('graph_apply', {
        ...scratch,
        entities: [{ entity: { eid: '$note' }, doc: { title: 'a secret' } }],
      })
      await agent.tool('app_deploy', scratch)
      assertEquals((await k.at('jeff.yaks.app', '/scratch/')).status, 200)
      assertMatch(
        await agent.tool('app_delete', scratch),
        /deleted jeff\/scratch: 1 file, everything it saved.*all gone/,
      )
      assertEquals((await k.at('jeff.yaks.app', '/scratch/')).status, 404)
      await assertRejects(
        () => agent.tool('app_delete', scratch),
        Error,
        'no app scratch in jeff',
      )
      assertEquals(
        (await agent.tool('app_list', { space: 'jeff' })).includes('scratch'),
        false,
      )
      await agent.tool('app_new', {
        space: 'jeff',
        slug: 'scratch',
        title: 'Sc',
      })
      assertEquals(
        await agent.tool('app_files', { ...scratch, op: 'list' }),
        '(no files)',
      )
      assertEquals(
        await agent.tool('graph_query', { ...scratch, query: '.doc!' }),
        '[]',
      )
      await agent.tool('app_delete', scratch)

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
