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
import { slow, until } from '../../src/testing.ts'
import { connector, kernel, signedIn, signIn } from './probe.ts'

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
      // A whole app in one call, and one answer naming every file it wrote
      // (C-32624 item 5). The op rides along with the batch.
      assertEquals(
        await agent.tool('app_files', {
          ...app,
          files: [
            { path: 'app.js', content: 'export let go = () => {}' },
            { path: '/img/logo.svg', content: '<svg/>' },
          ],
        }),
        'wrote 2 files → https://jeff.yaks.app/recipes/: app.js, img/logo.svg',
      )
      assertEquals(
        await agent.tool('app_files', { ...app, op: 'list' }),
        'app.js\ncss/site.css\nimg/logo.svg\nindex.html',
      )
      assertEquals(
        await agent.tool('app_files', {
          ...app,
          op: 'read',
          path: 'img/logo.svg',
        }),
        '<svg/>',
      )
      // What is missing is named: the ops, and the batch that writes several.
      let lost = await assertRejects(
        () => agent.tool('app_files', { ...app }),
        Error,
      )
      assertStringIncludes(lost.message, 'op: one of list, read, write, delete')
      assertStringIncludes(lost.message, 'files: [{path, content}]')
      await assertRejects(
        () => agent.tool('app_files', { ...app, files: [{ path: 'x.js' }] }),
        Error,
        'files[0].content is required',
      )
      await agent.tool('app_files', { ...app, op: 'delete', path: 'app.js' })
      await agent.tool('app_files', {
        ...app,
        op: 'delete',
        path: 'img/logo.svg',
      })
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
      // The deploy says what it planted, and what the store still has that
      // this manifest did not name (C-32652 item 4).
      assertStringIncludes(shed, 'added: note.text')
      assertStringIncludes(
        shed,
        'kept, not in vocab.json (the rows are there): recipe.title, ' +
          'recipe.serves',
      )
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

      // A RENAMED column is two columns: the new spelling arrives, the old
      // one keeps every row already written under it, and the deploy says
      // both — the manifest reads as one word and the store answers two.
      await agent.tool('graph_apply', {
        ...app,
        entities: [{ entity: { eid: '$n' }, note: { text: 'wrote it' } }],
      })
      await manifest(
        '{"recipe":{"title":"text","serves":"number"},"note":{"body":"text"}}',
      )
      let renamed = await agent.tool('app_deploy', app)
      assertStringIncludes(renamed, 'added: note.body')
      assertStringIncludes(
        renamed,
        'kept, not in vocab.json (the rows are there): note.text',
      )
      await agent.tool('graph_apply', {
        ...app,
        entities: [{ entity: { eid: '$n2' }, note: { body: 'said it' } }],
      })
      let notes = JSON.parse(
        await agent.tool('graph_query', { ...app, query: '.note!' }),
      ) as { note: { text: string | null; body: string | null } }[]
      assertEquals(notes.map((n) => n.note), [
        { text: 'wrote it', body: null },
        { text: null, body: 'said it' },
      ])

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
      // v6: two files, a vocabulary, the word it dropped, the column it
      // renamed — every deploy above bumped it, and a break wears the version
      // it happened on.
      assert(breaks.every((b) => b.version == 6), 'the deploy it happened on')

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

// An app's OWN tools (T-32685): a tools.json beside vocab.json, planted by
// the same deploy, called at the same door as `<app>__<tool>` — and doing
// through it exactly what the caller could do on the app's own page.
slow('an app declares its own tools, and the door calls them', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
      .exec(await agent.tool('app_new', { slug: 'runs', title: 'Run club' }))![
        1
      ]
    let app = { space, app: 'runs' }
    await agent.tool('app_files', {
      ...app,
      files: [
        {
          path: 'vocab.json',
          content: '{"jog":{"who":"text","miles":"number"}}',
        },
        {
          path: 'tools.json',
          content: JSON.stringify({
            log_run: {
              description: 'Log a run for the club leaderboard',
              input: { who: 'text', miles: 'number' },
              apply: {
                entity: { eid: '$run' },
                jog: { who: '{{who}}', miles: '{{miles}}' },
              },
            },
            leaderboard: {
              description: 'Every run so far',
              input: {},
              query: '.jog!',
              // The page the answer draws itself in (T-32687).
              view: 'leaderboard.html',
            },
          }),
        },
        {
          path: 'leaderboard.html',
          content: '<!doctype html><html><head>' +
            '<link rel="stylesheet" href="./style.css" /></head>' +
            '<body><ol id=board></ol></body></html>',
        },
        // A page in the same app that no tool names: this door is not a way
        // to read an app's files.
        { path: 'secret.html', content: '<!doctype html><p>not a view' },
      ],
    })
    let deployed = await agent.tool('app_deploy', app)
    assertStringIncludes(deployed, 'tools: runs__log_run, runs__leaderboard')
    assertStringIncludes(deployed, 'components: jog')

    // The app's own MCP App view (T-32687): the tool links the page, the door
    // serves it out of the app's own files under the profile, and a `<base>`
    // at the app's address keeps the stylesheet beside it working.
    let view = `ui://${space}/runs/leaderboard.html`
    let drawn = (await agent.call('tools/list')).tools
      .find((t: { name: string }) => t.name == 'runs__leaderboard')
    assertEquals(drawn._meta.ui.resourceUri, view)
    assertEquals(drawn._meta.ui.visibility, ['model', 'app'])
    let listed = (await agent.call('resources/list')).resources
      .find((r: { uri: string }) => r.uri == view)
    assertEquals(listed.mimeType, 'text/html;profile=mcp-app')
    assertEquals(listed._meta.ui.csp.baseUriDomains, [
      `https://${space}.yaks.app`,
    ])
    let page = (await agent.call('resources/read', { uri: view })).contents[0]
    assertEquals(page.mimeType, 'text/html;profile=mcp-app')
    assertStringIncludes(
      page.text,
      `<head><base href="https://${space}.yaks.app/runs/">`,
    )
    assertStringIncludes(page.text, './style.css')
    assertEquals(page._meta.ui.csp.resourceDomains, [
      `https://${space}.yaks.app`,
    ])
    // A page nobody declared, and an app nobody has: the same answer.
    for (
      let missing of [`ui://${space}/runs/secret.html`, 'ui://no/runs/x.html']
    ) {
      await assertRejects(
        () => agent.call('resources/read', { uri: missing }),
        Error,
        'no resource',
      )
    }

    // The call is a page's gesture: the row lands in the app's own store,
    // typed by the declared input, and says who wrote it.
    let wrote = await agent.tool('runs__log_run', { who: 'Ada', miles: '5' })
    assertStringIncludes(wrote, 'runs__log_run: wrote 1 entity')
    let rows = JSON.parse(
      await agent.tool('graph_query', { ...app, query: '.jog!&.created!' }),
    ) as { jog: { who: string; miles: number }; created: { by: string } }[]
    assertEquals(rows.length, 1)
    assertEquals(rows[0].jog, { who: 'Ada', miles: 5 })
    assertEquals(rows[0].created.by, jeff.person)
    // And the read half answers the listing a page gets.
    assertStringIncludes(
      await agent.tool('runs__leaderboard', {}),
      'runs__leaderboard: 1 row',
    )
    // An argument the input declared and the call left out is the tool's own
    // refusal, not a half-written row.
    await assertRejects(
      () => agent.tool('runs__log_run', { who: 'Ada' }),
      Error,
      'miles is required',
    )
    // A tool nobody declared is a tool nobody has.
    await assertRejects(
      () => agent.tool('runs__nope', {}),
      Error,
      'no tool runs__nope',
    )

    // Someone who may read this app and not write it: the write tool refuses
    // with the sentence a page would show them, and the read tool answers.
    let maya = await signIn(k)
    await agent.tool('member_add', {
      space,
      email: maya.email,
      role: 'viewer',
    })
    let hers = connector(k, maya.cookie)
    assertStringIncludes(
      await hers.tool('runs__leaderboard', {}),
      'runs__leaderboard: 1 row',
    )
    await assertRejects(
      () => hers.tool('runs__log_run', { who: 'Maya', miles: 3 }),
      Error,
      'you can read this app but not change it',
    )

    // A manifest that cannot work is refused at DEPLOY, whole, and the tools
    // the app already had keep answering.
    await agent.tool('app_files', {
      ...app,
      op: 'write',
      path: 'tools.json',
      content: '{"bad":{"description":"x","input":{},"apply":' +
        '{"jog":{"who":"{{who}}"}},"screen":"index.html"}}',
    })
    let why = (await assertRejects(() => agent.tool('app_deploy', app), Error))
      .message
    assertStringIncludes(why, 'bad: screen — a tool says')
    assertStringIncludes(why, 'bad: {{who}} names no input')
    // And a view naming a page nobody deployed: the store holds the words,
    // the app's files hold the pages, so the deploy is where that is caught.
    await agent.tool('app_files', {
      ...app,
      op: 'write',
      path: 'tools.json',
      content: '{"board":{"description":"x","input":{},"query":".jog!",' +
        '"view":"gone.html"}}',
    })
    assertStringIncludes(
      (await assertRejects(() => agent.tool('app_deploy', app), Error)).message,
      "gone.html — a view names a page in this app's own files",
    )
    assertStringIncludes(
      await agent.tool('runs__log_run', { who: 'Bo', miles: 2 }),
      'wrote 1 entity',
    )
  } finally {
    await k.stop()
  }
})

// The door LISTS what an app declared (T-32686): every app in every space the
// caller belongs to, and nobody else's — then says on the session's stream
// when a deploy moved that list.
slow("the door lists an app's tools, and says when they moved", async () => {
  let k = await kernel()
  let reading: Promise<void> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    let tools = (comp: string, name: string) =>
      JSON.stringify({
        [name]: {
          description: `Write a ${comp}`,
          input: { text: 'text' },
          apply: { [comp]: { text: '{{text}}' } },
        },
      })
    let made = async (
      who: { cookie: string },
      slug: string,
      title: string,
      comp: string,
      name: string,
      access?: string,
    ) => {
      let agent = connector(k, who.cookie)
      let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
        .exec(
          await agent.tool('app_new', {
            slug,
            title,
            ...(access ? { access } : {}),
          }),
        )![1]
      await agent.tool('app_files', {
        space,
        app: slug,
        files: [
          {
            path: 'vocab.json',
            content: JSON.stringify({ [comp]: { text: 'text' } }),
          },
          { path: 'tools.json', content: tools(comp, name) },
        ],
      })
      await agent.tool('app_deploy', { space, app: slug })
      return { agent, space }
    }
    let jeff = await signIn(k)
    let club = await made(jeff, 'runs', 'Run club', 'jog', 'log_run')
    let maya = await signIn(k)
    await made(maya, 'diary', 'Diary', 'entryline', 'note', 'private')

    // Jeff sees his own app's tool beside the platform's, and nothing of
    // hers: her app is in her space, and he is nobody there.
    let named = async (agent: ReturnType<typeof connector>) =>
      ((await agent.call('tools/list')).tools as { name: string }[])
        .map((t) => t.name)
    let his = await named(club.agent)
    assert(his.includes('app_deploy'), 'the platform tools are still listed')
    assert(his.includes('runs__log_run'), 'his own app tool is listed')
    assertEquals(his.includes('diary__note'), false)
    let hers = await named(connector(k, maya.cookie))
    assert(hers.includes('diary__note'))
    assertEquals(hers.includes('runs__log_run'), false)
    // The app's TITLE rides in the description: a slug is not what the
    // person called it.
    let one = ((await club.agent.call('tools/list')).tools as {
      name: string
      description: string
      inputSchema: { required: string[] }
    }[]).find((t) => t.name == 'runs__log_run')!
    assertStringIncludes(one.description, 'Run club')
    assertStringIncludes(one.description, `${club.space}.yaks.app/runs/`)
    assertEquals(one.inputSchema.required, ['text'])

    // The door says it will announce a moved list, and the instructions say
    // an app can carry tools at all.
    let init = await club.agent.call('initialize', { capabilities: {} })
    assertEquals(init.capabilities.tools.listChanged, true)
    assertStringIncludes(init.instructions, 'tools.json')
    assertStringIncludes(init.instructions, '<app>__<tool>')

    // The session's stream: held open, and told when a deploy moved the list.
    let stream = await k.at('yaks.app', '/mcp', {
      headers: { cookie: jeff.cookie, accept: 'text/event-stream' },
    })
    assertEquals(stream.headers.get('content-type'), 'text/event-stream')
    let heard = ''
    reader = stream.body!.getReader()
    let bytes = new TextDecoder()
    reading = (async () => {
      try {
        while (true) {
          let { done, value } = await reader!.read()
          if (done) return
          heard += bytes.decode(value, { stream: true })
        }
      } catch { /* cancelled with the test */ }
    })()
    await until(() => heard.includes(': open'), {
      timeout: 10_000,
      poll: 50,
      label: 'the stream to open',
    })
    await club.agent.tool('app_files', {
      space: club.space,
      app: 'runs',
      op: 'write',
      path: 'tools.json',
      content: JSON.stringify({
        log_run: {
          description: 'Write a jog',
          input: { text: 'text' },
          apply: { jog: { text: '{{text}}' } },
        },
        jogs: { description: 'Every jog', input: {}, query: '.jog!' },
      }),
    })
    await club.agent.tool('app_deploy', { space: club.space, app: 'runs' })
    await until(() => heard.includes('notifications/tools/list_changed'), {
      timeout: 10_000,
      poll: 50,
      label: 'the tool list to be called stale',
    })
    assert((await named(club.agent)).includes('runs__jogs'))
    // A deploy that moved nothing says nothing.
    heard = ''
    await club.agent.tool('app_deploy', { space: club.space, app: 'runs' })
    assertEquals(heard.includes('list_changed'), false)
  } finally {
    await reader?.cancel().catch(() => {})
    await reading
    await k.stop()
  }
})

// An entity spans apps (T-32699): a read that names no app asks every store
// the caller can reach and answers one bundle per eid — and only the stores
// they can reach.
slow('a read with no app composes every app the caller can reach', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    // Two apps of his own, each with a word of its own.
    let made = async (
      who: ReturnType<typeof connector>,
      slug: string,
      comp: string,
      cols: Record<string, string>,
      access?: string,
    ) => {
      await who.tool('app_new', {
        slug,
        title: slug,
        ...(access ? { access } : {}),
      })
      await who.tool('app_files', {
        app: slug,
        files: [{
          path: 'vocab.json',
          content: JSON.stringify({ [comp]: cols }),
        }],
      })
      await who.tool('app_deploy', { app: slug })
    }
    await made(agent, 'recipes', 'recipe', { serves: 'number' })
    await made(agent, 'lending', 'loan', { to: 'text' })

    // ONE entity, its title and recipe in one app, its loan in the other:
    // the eid is minted by the caller, so it names the same thing in both.
    let cake = crypto.randomUUID()
    await agent.tool('graph_apply', {
      app: 'recipes',
      entities: [{
        entity: { eid: cake },
        doc: { title: 'Lemon cake' },
        recipe: { serves: 4 },
      }],
    })
    await agent.tool('graph_apply', {
      app: 'recipes',
      entities: [{ doc: { title: 'Pancakes' }, recipe: { serves: 2 } }],
    })
    await agent.tool('graph_apply', {
      app: 'lending',
      entities: [
        { entity: { eid: cake }, loan: { to: 'Maya' } },
        { doc: { title: 'Lemon zester' }, loan: { to: 'Bo' } },
      ],
    })

    // `id=` with no app answers everything known about it, in one bundle,
    // saying which app holds which component.
    let rows = async (filter: string, who = agent) =>
      JSON.parse(await who.tool('graph_query', { filter })) as {
        kind: string
        entity: { eid: string }
        doc?: { title: string }
        recipe?: { serves: number }
        loan?: { to: string }
        _stores?: Record<string, string>
      }[]
    let [bundle] = await rows(`id=${cake}`)
    assertEquals(bundle.doc!.title, 'Lemon cake')
    assertEquals(bundle.recipe!.serves, 4)
    assertEquals(bundle.loan!.to, 'Maya')
    // An app's own word is what the entity IS, and the composition says where
    // each component lives.
    assertEquals(bundle.kind, 'recipe')
    assertMatch(bundle._stores!.recipe, /\/recipes$/)
    assertMatch(bundle._stores!.loan, /\/lending$/)

    // A filter naming two apps' words is intersected at the door: the cake
    // wears both, the pancakes and the zester wear one each.
    assertEquals(
      (await rows('.recipe!&.loan!')).map((r) => r.entity.eid),
      [cake],
    )
    assertEquals(
      (await rows('.recipe!')).map((r) => r.doc!.title),
      ['Lemon cake', 'Pancakes'],
    )
    // `.doc!` is a platform word both stores speak, so the answer is both
    // apps' rows — and the cake is one row, not two.
    assertEquals(
      (await rows('.doc!')).map((r) => r.doc!.title),
      ['Lemon cake', 'Pancakes', 'Lemon zester'],
    )
    // A word nobody planted is nobody's, and the store's own sentence says so
    // rather than an empty answer.
    await assertRejects(
      () => agent.tool('graph_query', { filter: '.sandwich!' }),
      Error,
      'unknown prop',
    )
    // Search with no app merges the ranked hits of every app.
    let found = JSON.parse(
      await agent.tool('search', { text: 'lemon' }),
    ) as { doc: { title: string } }[]
    assertEquals(
      found.map((r) => r.doc.title).sort(),
      ['Lemon cake', 'Lemon zester'],
    )

    // What another person keeps in their own space is not in reach: her app
    // is private, he is nobody there, and her component never appears on the
    // bundle he reads — even though it is written on the same eid.
    let maya = await signIn(k)
    let hers = connector(k, maya.cookie)
    await made(hers, 'diary', 'entryline', { note: 'text' }, 'private')
    await hers.tool('graph_apply', {
      app: 'diary',
      entities: [{ entity: { eid: cake }, entryline: { note: 'he baked it' } }],
    })
    assertEquals('entryline' in (await rows(`id=${cake}`))[0], false)
    assertEquals((await rows('.recipe!', hers)).length, 0)
    assertEquals((await rows(`id=${cake}`, hers))[0].entity.eid, cake)
  } finally {
    await k.stop()
  }
})

// A write is routed by component (T-32700): each one goes to the app that
// declares it, a shared one to the app named or the app the entity already
// lives in, and the parts are admitted everywhere before any of them commits.
slow('a write with no app routes each component to its own app', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let made = async (
      slug: string,
      comp: string,
      cols: Record<string, string>,
    ) => {
      await agent.tool('app_new', { slug, title: slug })
      await agent.tool('app_files', {
        app: slug,
        files: [{
          path: 'vocab.json',
          content: JSON.stringify({ [comp]: cols }),
        }],
      })
      await agent.tool('app_deploy', { app: slug })
    }
    await made('recipes', 'recipe', { serves: 'number' })
    await made('lending', 'loan', { to: 'text' })
    let rows = async (filter: string, app?: string) =>
      JSON.parse(
        await agent.tool('graph_query', { filter, ...(app ? { app } : {}) }),
      ) as {
        entity: { eid: string }
        doc?: { title: string }
        recipe?: { serves: number }
        loan?: { to: string }
        _stores?: Record<string, string>
      }[]

    // A new entity with one app's word: the title rides with it, because a
    // shared word with nowhere else to go belongs to the app whose own words
    // are in the same bundle.
    let said = await agent.tool('graph_apply', {
      entities: [{
        entity: { eid: '$cake' },
        doc: { title: 'Lemon cake' },
        recipe: { serves: 4 },
      }],
    })
    assertMatch(said, /in \S+\/recipes:/)
    let cake = /\$cake=([0-9a-f-]{36})/.exec(said)![1]
    assertEquals((await rows('.doc!', 'lending')).length, 0)

    // ONE bundle wearing two apps' words: the loan is the lending app's row,
    // the retitle lands where the title already lives, and the call is one.
    let both = await agent.tool('graph_apply', {
      entities: [{
        entity: { eid: cake },
        doc: { title: 'Lemon drizzle' },
        loan: { to: 'Maya' },
      }],
    })
    assertMatch(both, /recipes/)
    assertMatch(both, /lending/)
    assertEquals(
      (await rows(`id=${cake}`, 'recipes'))[0].doc!.title,
      'Lemon drizzle',
    )
    assertEquals((await rows(`id=${cake}`, 'lending'))[0].loan!.to, 'Maya')
    let [bundle] = await rows(`id=${cake}`)
    assertEquals(bundle.recipe!.serves, 4)
    assertEquals(bundle.loan!.to, 'Maya')
    assertMatch(bundle._stores!.doc, /\/recipes$/)
    assertMatch(bundle._stores!.loan, /\/lending$/)

    // A refusal in one store leaves the other unwritten: every part is
    // admitted before any of them commits.
    await assertRejects(
      () =>
        agent.tool('graph_apply', {
          entities: [{
            entity: { eid: cake },
            recipe: { serves: 12 },
            loan: { to: 'Bo' },
            was: { loan: { to: 'f'.repeat(64) } },
          }],
        }),
      Error,
      'lending',
    )
    assertEquals((await rows(`id=${cake}`))[0].recipe!.serves, 4)
    assertEquals((await rows(`id=${cake}`))[0].loan!.to, 'Maya')

    // A shared word on a new entity that two apps could equally claim is a
    // question, not a guess.
    await assertRejects(
      () =>
        agent.tool('graph_apply', {
          entities: [{
            doc: { title: 'Zester' },
            recipe: { serves: 1 },
            loan: { to: 'Bo' },
          }],
        }),
      Error,
      'which app should doc go in?',
    )

    // Death is the whole entity's: it clears every store holding a piece.
    await agent.tool('graph_apply', {
      entities: [{ entity: { eid: cake }, tombstone: {} }],
    })
    assertEquals((await rows(`id=${cake}`)).length, 0)
    assertEquals((await rows(`id=${cake}`, 'recipes')).length, 0)
    assertEquals((await rows(`id=${cake}`, 'lending')).length, 0)
  } finally {
    await k.stop()
  }
})
