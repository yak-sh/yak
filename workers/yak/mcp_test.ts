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
import {
  client,
  connector,
  kernel,
  letter,
  meta,
  seed,
  signedIn,
  signIn,
} from './probe.ts'
import { monthOf } from './usage.ts'
import { PAGES, uriOf } from './guide.ts'
import { PROMPTS } from './prompts.ts'
import { VERSION } from '../../src/version.ts'

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
      // Nobody is answered anything of the person's — and the refusal says
      // so in a sentence, with where signing in happens, like every other
      // door (C-32607 item 1). What nobody IS answered is the pre-auth
      // surface, held in its own test below (T-33030).
      let shut = await k.at('yaks.app', '/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/call",' +
          '"params":{"name":"app_list"}}',
      })
      assertEquals(shut.status, 401)
      let refusal = (await shut.json()).error
      assertEquals(refusal.code, 'unauthorized')
      assertStringIncludes(refusal.message, 'sign in at https://yaks.app')
      assertEquals(refusal.signIn, 'https://yaks.app/login')
      await assertRejects(() => connector(k).call('prompts/list'), Error, '401')
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
        'app_versions',
        'app_rollback',
        'app_set',
        'app_secret_set',
        'app_secret_list',
        'app_secret_remove',
        'app_delete',
        'app_errors',
        'app_list',
        'domain_attach',
        'domain_status',
        'domain_detach',
        'app_publish',
        'app_unpublish',
        'app_published',
        'app_install',
        'app_update',
        'member_add',
        'member_remove',
        'graph_apply',
        'graph_query',
        'search',
        'feedback',
        // The one anybody may call, signed in or not (preauth.ts, T-33030).
        'about',
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
          // An entity spans apps, and the person's agent is told so before
          // it builds the second one (T-32701).
          'the same thing in every app',
          "'.book!&.loan?'",
          "store('/lending/api/')",
          // An app is a plugin: publishable, installable, pinned (T-32890).
          'app_publish',
          'app_install',
          'nothing shared but',
          'pinned to the version it took',
          // A row carries the components its filter names (T-32699), which is
          // what a page draws from — the one thing that silently emptied a
          // working page's titles (T-32953).
          "query('.recipe!&.doc?')",
        ]
      ) assertStringIncludes(init.instructions, said)
      let says = (name: string) =>
        tools.find((t: { name: string }) => t.name == name).description
      assertStringIncludes(says('app_files'), './api/client.js')
      assertStringIncludes(says('app_files'), 'never localStorage')
      assertStringIncludes(says('graph_query'), '.doc!')
      // What it ANSWERS, said before anything else: only the components the
      // filter names, and the one way to ask for another (T-32953). A
      // description that still promised every component is what taught a page
      // to read `doc.title` off a `.recipe!` row and print "(untitled)".
      assertStringIncludes(says('graph_query'), "'.recipe!&.doc?'")
      assertStringIncludes(
        says('graph_query'),
        'ONLY the components the filter names',
      )
      assertStringIncludes(says('graph_apply'), './api/client.js')

      // The guide the tool descriptions point at, offered as a resource and
      // read from the address that serves it — and the pages that go deep on
      // one subject each, beside it (T-32982).
      assert(init.capabilities.resources, 'resources are offered')
      let { resources } = await agent.call('resources/list')
      assertEquals(
        resources.map((r: { uri: string }) => r.uri),
        [GUIDE, ...PAGES.map((p) => uriOf(p.slug)), APPS, ERRORS],
      )
      // The description is the only thing an agent sees before choosing, so
      // it is what the listing must carry.
      for (let p of PAGES) {
        let listed = resources.find(
          (r: { uri: string }) => r.uri == uriOf(p.slug),
        )
        assertEquals(listed.title, p.title)
        assertEquals(listed.description, p.description)
        assertEquals(listed.mimeType, 'text/markdown')
      }
      let read = await agent.call('resources/read', { uri: GUIDE })
      assertMatch(read.contents[0].text, /api\/client\.js/)
      // The guide teaches the composition, with the person's own example: a
      // book from one app wearing a loan from another (T-32701).
      assertStringIncludes(read.contents[0].text, '## An entity spans apps')
      assertStringIncludes(read.contents[0].text, '.book!&.loan?')
      assertStringIncludes(read.contents[0].text, "store('/lending/api/')")
      // The map still names each page, so a person reading only the guide
      // knows the depth is there (T-32982).
      for (let p of PAGES) {
        assertStringIncludes(read.contents[0].text, uriOf(p.slug))
      }

      // A page is read through this door, and served at the same address to
      // whoever follows the link — one file, two ways in.
      let deep = await agent.call('resources/read', { uri: uriOf('querying') })
      assertEquals(deep.contents[0].uri, uriOf('querying'))
      assertEquals(deep.contents[0].mimeType, 'text/markdown')
      assertStringIncludes(deep.contents[0].text, '# Querying')
      assertStringIncludes(deep.contents[0].text, '.doc!')
      let got = await k.at('yaks.app', '/guide/querying.md')
      assertEquals(got.status, 200)
      assertEquals(await got.text(), deep.contents[0].text)

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

      // The doors a PERSON picks by name (T-32981): declared beside tools,
      // listed with the arguments a client asks them to fill in, and got as
      // one message written in their own voice.
      assertEquals(init.capabilities.prompts, { listChanged: true })
      let { prompts } = await agent.call('prompts/list')
      assertEquals(
        prompts.map((p: { name: string }) => p.name),
        PROMPTS.map((p) => p.name),
      )
      assertEquals(prompts.map((p: { name: string }) => p.name), [
        'make',
        'fix',
        'share',
        'publish',
      ])
      let make = prompts.find((p: { name: string }) => p.name == 'make')
      assertEquals(make.title, 'Make something new')
      assertEquals(make.arguments, [{
        name: 'what',
        description: PROMPTS[0].arguments[0].description,
        required: true,
      }])
      let picked = await agent.call('prompts/get', {
        name: 'make',
        arguments: { what: 'a chore board for the house' },
      })
      assertEquals(picked.messages.length, 1)
      assertEquals(picked.messages[0].role, 'user')
      assertEquals(picked.messages[0].content.type, 'text')
      assertStringIncludes(
        picked.messages[0].content.text,
        'a chore board for the house',
      )
      // An optional argument left out still reads as a sentence.
      assertStringIncludes(
        (await agent.call('prompts/get', { name: 'fix' }))
          .messages[0].content.text,
        'my apps',
      )
      // The spec's two -32602s: a name nobody offers, and a required
      // argument nobody filled in.
      await assertRejects(
        () => agent.call('prompts/get', { name: 'nope' }),
        Error,
        'no prompt',
      )
      await assertRejects(
        () => agent.call('prompts/get', { name: 'make' }),
        Error,
        'needs what',
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
      // But naming the APP is naming the space: someone in two spaces is not
      // asked which of them their own app sits in, the way the app's own
      // namespaced tool never asks (C-32730 item 6). app_new keeps asking —
      // it names an app nobody has yet.
      assertEquals(
        await agent.tool('app_files', { app: 'garden', op: 'list' }),
        '(no files)',
      )
      assertEquals(
        await agent.tool('graph_query', { app: 'garden', filter: '.doc!' }),
        '[]',
      )
      // Two spaces holding the slug is the one question worth asking, and
      // the refusal says which two and why.
      await agent.tool('app_new', {
        space: 'jeff-work',
        slug: 'garden',
        title: 'Work garden',
      })
      await assertRejects(
        () => agent.tool('app_files', { app: 'garden', op: 'list' }),
        Error,
        'name one of jeff, jeff-work — each has an app garden',
      )
      await agent.tool('app_delete', { space: 'jeff-work', app: 'garden' })
      assertEquals(
        await agent.tool('app_files', { app: 'garden', op: 'list' }),
        '(no files)',
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
      // (C-32624 item 5). Spelled out rather than spread, because the point
      // is what is ABSENT: no `op` at all, the way `initialize` step 2
      // teaches it, since a `files` batch IS the write (C-32730 item 1).
      assertEquals(
        await agent.tool('app_files', {
          space: 'jeff',
          app: 'recipes',
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
      // The page as written, given the app's own address to resolve its
      // relative URLs against (apps.ts `based`, T-32907).
      let html = await served.text()
      assertStringIncludes(html, '<h1>Our recipe box</h1>')
      assertStringIncludes(html, '<base href="/recipes/">')
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
      // A near miss is answered with the word and a line to copy, not with
      // "filter is required", which says nothing to whoever sent `filters`
      // (C-32730 item 3).
      let missed = await assertRejects(
        () => agent.tool('graph_query', { ...app, filters: ['.doc!'] }),
        Error,
      )
      assertStringIncludes(missed.message, 'filter: one LINE, not a list')
      assertStringIncludes(missed.message, "filter: '.doc!'")
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
      // And says what to DO about it, since the two spellings are a rename
      // half done and nobody else will finish it (C-32730 item 4).
      assertStringIncludes(renamed, 'name it in vocab.json again')
      assertStringIncludes(renamed, 'Nothing is migrated behind you.')
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
      // Renamed, so the base a page is given moves with it.
      let atNewHtml = await atNew.text()
      assertStringIncludes(atNewHtml, '<h1>Our recipe box</h1>')
      assertStringIncludes(atNewHtml, '<base href="/cookbook/">')
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
    assertEquals(init.serverInfo.name, 'yaks.app')
    assertEquals(init.capabilities.tools.listChanged, true)
    assertEquals(init.capabilities.resources.listChanged, true)
    // Not prompts, which are a person's own doors, and not logging, which is
    // a break in somebody's app: a capability this door would refuse is worse
    // than one it never claimed.
    assertEquals(init.capabilities.prompts, undefined)
    assertEquals(init.capabilities.logging, undefined)
    // What it says is the orientation, not the recipe — nobody who cannot
    // call app_new is told to call it — and it names where signing in is.
    assertStringIncludes(init.instructions, 'yourname.yaks.app')
    assertStringIncludes(init.instructions, 'https://yaks.app/guide.md')
    assertEquals(init.instructions.includes('app_new'), false)
    assertEquals(await anon.call('ping'), {})

    // One tool, and it is the one that reads nothing.
    let open = ((await anon.call('tools/list')).tools as { name: string }[])
      .map((t) => t.name)
    assertEquals(open, ['about'])
    let said = await anon.tool('about')
    for (
      let word of [
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
      assertEquals(body.error.code, 'unauthorized')
      assertEquals(body.error.signIn, 'https://yaks.app/login')
    }
    // A tool of the platform's, one of the app's own, and one nobody wrote:
    // one answer for all three, so nothing here says which apps exist.
    await shut('tools/call', { name: 'graph_query', arguments: { query: '' } })
    await shut('tools/call', { name: 'app_list' })
    await shut('tools/call', { name: 'runs__leaderboard' })
    await shut('tools/call', { name: 'nope' })
    await shut('prompts/list')
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
    // And the stream, which is a person's own: there is no public one.
    let stream = await k.at('yaks.app', '/mcp', {
      headers: { accept: 'text/event-stream' },
    })
    assertEquals(stream.status, 401)
    assertEquals(stream.headers.get('www-authenticate'), challenge)
    await stream.body?.cancel()

    // Signing in adds; it never swaps one surface for another. Every public
    // tool is in the full list, saying the same words, and every public
    // resource is still listed.
    let full = ((await agent.call('tools/list')).tools as { name: string }[])
      .map((t) => t.name)
    assert(open.every((n) => full.includes(n)), 'the public list is a subset')
    assert(full.length > open.length, 'signing in has to be worth something')
    assertEquals(await agent.tool('about'), said)
    let mine = ((await agent.call('resources/list')).resources as {
      uri: string
    }[]).map((r) => r.uri)
    assert(pages.every((p) => mine.includes(p.uri)), 'the guide is still hers')
    assert(mine.includes(APPS) && mine.includes(view))
  } finally {
    await k.stop()
  }
})

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
              query: '.jog!&.created!',
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
    type Run = {
      jog: { who: string; miles: number }
      created: { by: { eid: string; name: string } }
    }
    let rows = JSON.parse(
      await agent.tool('graph_query', { ...app, query: '.jog!&.created!' }),
    ) as Run[]
    assertEquals(rows.length, 1)
    assertEquals(rows[0].jog, { who: 'Ada', miles: 5 })
    // Who wrote it, by name: a reference to somebody the store knows answers
    // `{eid, name}`, so the leaderboard a VIEW draws from its one query says
    // who ran instead of "someone" (C-32730 item 5).
    assertEquals(rows[0].created.by, { eid: jeff.person, name: jeff.name })
    // And the read half answers the listing a page gets — the same byline,
    // through the declared tool's own query.
    let board = await agent.call('tools/call', {
      name: 'runs__leaderboard',
      arguments: {},
    })
    assertStringIncludes(board.content[0].text, 'runs__leaderboard: 1 row')
    assertEquals(
      (board.structuredContent.rows as Run[])[0].created.by,
      { eid: jeff.person, name: jeff.name },
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

// An SSE stream held open, as the text heard so far: a test asserts on what
// has arrived, forgets it, and cancels when it is done.
let hearing = (res: Response) => {
  let heard = ''
  let bytes = new TextDecoder()
  let reader = res.body!.getReader()
  let reading = (async () => {
    try {
      for (;;) {
        let { done, value } = await reader.read()
        if (done) return
        heard += bytes.decode(value, { stream: true })
      }
    } catch { /* cancelled with the test */ }
  })()
  return {
    said: () => heard,
    forget: () => heard = '',
    stop: async () => {
      await reader.cancel().catch(() => {})
      await reading
    },
  }
}

// The door LISTS what an app declared (T-32686): every app in every space the
// caller belongs to, and nobody else's — then says on the session's stream
// when a deploy moved that list.
slow("the door lists an app's tools, and says when they moved", async () => {
  let k = await kernel()
  let ear: ReturnType<typeof hearing> | undefined
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
    ear = hearing(stream)
    await until(() => ear!.said().includes(': open'), {
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
    await until(
      () => ear!.said().includes('notifications/tools/list_changed'),
      {
        timeout: 10_000,
        poll: 50,
        label: 'the tool list to be called stale',
      },
    )
    assert((await named(club.agent)).includes('runs__jogs'))
    // A deploy that moved nothing says nothing.
    ear.forget()
    await club.agent.tool('app_deploy', { space: club.space, app: 'runs' })
    assertEquals(ear.said().includes('list_changed'), false)
  } finally {
    await ear?.stop()
    await k.stop()
  }
})

// The stream is DURABLE and resumable (T-32734): it lives in a Durable Object
// of the person's own, so the request that deploys reaches the stream a
// DIFFERENT request opened — which is what makes the notification arrive at
// all outside one isolate — and a client whose connection dropped picks up
// what it missed from its `Last-Event-ID`.
slow('the stream names its session and replays a missed line', async () => {
  let k = await kernel()
  let ear: ReturnType<typeof hearing> | undefined
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    // initialize answers the transport's session id.
    let init = await k.at('yaks.app', '/mcp', {
      method: 'POST',
      headers: { cookie: jeff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    })
    let session = init.headers.get('mcp-session-id') ?? ''
    await init.json()
    assertMatch(session, /^[0-9a-f-]{36}$/)

    // An app of his own, whose tools.json is what moves.
    let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
      .exec(await agent.tool('app_new', { slug: 'walks', title: 'Walks' }))![1]
    let tools = (...names: string[]) =>
      JSON.stringify(
        Object.fromEntries(names.map((n) => [n, {
          description: `Write a ${n}`,
          input: { text: 'text' },
          apply: { walk: { text: '{{text}}' } },
        }])),
      )
    await agent.tool('app_files', {
      space,
      app: 'walks',
      files: [
        {
          path: 'vocab.json',
          content: JSON.stringify({ walk: { text: 'text' } }),
        },
        { path: 'tools.json', content: tools('log_walk') },
      ],
    })
    await agent.tool('app_deploy', { space, app: 'walks' })

    let attach = (headers: Record<string, string>) =>
      k.at('yaks.app', '/mcp', {
        headers: {
          cookie: jeff.cookie,
          accept: 'text/event-stream',
          ...headers,
        },
      })
    let moved = async (...names: string[]) => {
      await agent.tool('app_files', {
        space,
        app: 'walks',
        op: 'write',
        path: 'tools.json',
        content: tools(...names),
      })
      await agent.tool('app_deploy', { space, app: 'walks' })
    }
    // Every line heard, with the event id it carries — the cursor a
    // reconnect resumes from.
    let lines = (said: string) =>
      [...said.matchAll(/id: (\d+)\ndata: (.+)/g)]
        .map((m) => ({ id: Number(m[1]), data: m[2] }))

    ear = hearing(await attach({ 'mcp-session-id': session }))
    await until(() => ear!.said().includes(': open'), {
      timeout: 10_000,
      poll: 50,
      label: 'the stream to open',
    })
    await moved('log_walk', 'walks')
    await until(() => lines(ear!.said()).length == 1, {
      timeout: 10_000,
      poll: 50,
      label: 'the deploy to reach the stream',
    })
    let first = lines(ear.said())[0]
    assertStringIncludes(first.data, 'notifications/tools/list_changed')

    // The connection drops, and the next deploy has nobody to write to. The
    // object keeps the line anyway.
    await ear.stop()
    ear = undefined
    await moved('log_walk', 'walks', 'far')

    // Reconnecting from the last id it saw: what it missed, and not the line
    // it already had.
    ear = hearing(
      await attach({
        'mcp-session-id': session,
        'last-event-id': String(first.id),
      }),
    )
    await until(() => lines(ear!.said()).length == 1, {
      timeout: 10_000,
      poll: 50,
      label: 'the missed line, replayed',
    })
    let back = lines(ear.said())
    assertEquals(back.length, 1)
    assertEquals(back[0].id, first.id + 1)
    assertStringIncludes(back[0].data, 'notifications/tools/list_changed')
  } finally {
    await ear?.stop()
    await k.stop()
  }
})

// A release can move the view set without the tool set (T-33004): the tool
// half of tools.json is what tools/list is made of, the views are what
// resources/list is made of, and each stales its own list on the stream.
slow(
  'a release whose views moved and not its tools says resources',
  async () => {
    let k = await kernel()
    let ear: ReturnType<typeof hearing> | undefined
    try {
      let jeff = await signIn(k)
      let agent = connector(k, jeff.cookie)
      // The door promises to say so, and owns the logging door too (T-33006).
      let init = await agent.call('initialize', {})
      assertEquals(init.capabilities.resources.listChanged, true)
      assertEquals(init.capabilities.logging, {})
      let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
        .exec(
          await agent.tool('app_new', { slug: 'walks', title: 'Walks' }),
        )![1]
      let manifest = (view?: string) =>
        JSON.stringify({
          log_walk: {
            description: 'Write a walk',
            input: { text: 'text' },
            apply: { walk: { text: '{{text}}' } },
            ...(view ? { view } : {}),
          },
        })
      await agent.tool('app_files', {
        space,
        app: 'walks',
        files: [
          {
            path: 'vocab.json',
            content: JSON.stringify({ walk: { text: 'text' } }),
          },
          { path: 'walk.html', content: '<!doctype html><h1>walks</h1>' },
          { path: 'tools.json', content: manifest() },
        ],
      })
      await agent.tool('app_deploy', { space, app: 'walks' })
      let stream = await k.at('yaks.app', '/mcp', {
        headers: { cookie: jeff.cookie, accept: 'text/event-stream' },
      })
      ear = hearing(stream)
      await until(() => ear!.said().includes(': open'), {
        timeout: 10_000,
        poll: 50,
        label: 'the stream to open',
      })
      // The view appears; the tool half stands still.
      await agent.tool('app_files', {
        space,
        app: 'walks',
        op: 'write',
        path: 'tools.json',
        content: manifest('walk.html'),
      })
      await agent.tool('app_deploy', { space, app: 'walks' })
      await until(
        () => ear!.said().includes('notifications/resources/list_changed'),
        {
          timeout: 10_000,
          poll: 50,
          label: 'the resource list to be called stale',
        },
      )
      assertEquals(
        ear.said().includes('notifications/tools/list_changed'),
        false,
        'the tool list did not move',
      )
    } finally {
      await ear?.stop()
      await k.stop()
    }
  },
)

// A break is pushed to whoever is listening as it lands (T-33006, V-32361):
// `notifications/message` on the members' streams — and the push marks
// nothing, so the unseen block still carries it on the next tool reply.
slow(
  'a break is pushed as notifications/message and still rides the reply',
  async () => {
    let k = await kernel()
    let ear: ReturnType<typeof hearing> | undefined
    try {
      let { cookie } = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
      let agent = connector(k, cookie)
      let stream = await k.at('yaks.app', '/mcp', {
        headers: { cookie, accept: 'text/event-stream' },
      })
      ear = hearing(stream)
      await until(() => ear!.said().includes(': open'), {
        timeout: 10_000,
        poll: 50,
        label: 'the stream to open',
      })
      // What a page's injected reporter posts (report_test.ts).
      assertEquals(
        (await k.at('jeff.yaks.app', '/recipes/api/report', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: 'boom is not a function',
            stack: 'at /recipes/:1',
            url: 'https://jeff.yaks.app/recipes/',
          }),
        })).status,
        204,
      )
      await until(() => ear!.said().includes('notifications/message'), {
        timeout: 10_000,
        poll: 50,
        label: 'the break to reach the stream',
      })
      assertStringIncludes(ear.said(), '"level":"error"')
      assertStringIncludes(ear.said(), '"logger":"jeff/recipes"')
      assertStringIncludes(ear.said(), 'boom is not a function')
      // Unmarked by the push: served-in-a-reply stays the only mark.
      let told = await agent.tool('graph_query', {
        space: 'jeff',
        app: 'recipes',
        query: '.doc!',
      })
      assertMatch(
        told,
        /## unseen errors\n- .*exception recipes.*boom is not a function/,
      )
    } finally {
      await ear?.stop()
      await k.stop()
    }
  },
)

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
    let rows = async (filter: string, who = agent, app?: string) =>
      JSON.parse(
        await who.tool('graph_query', { filter, ...(app ? { app } : {}) }),
      ) as {
        kind: string
        entity: { eid: string }
        doc?: { title: string }
        recipe?: { serves: number }
        loan?: { to: string }
        created?: { by: string; at: string }
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
    // An answer carries the components the filter NAMES and no more, so the
    // title is asked for beside the recipe.
    assertEquals(
      (await rows('.recipe!&.doc?')).map((r) => r.doc!.title),
      ['Lemon cake', 'Pancakes'],
    )
    assertEquals((await rows('.recipe!')).map((r) => r.doc), [
      undefined,
      undefined,
    ])
    // `.recipe!&.loan?` is the composition asked for by name: every recipe,
    // wearing the lending app's loan where it has one.
    assertEquals(
      (await rows('.recipe!&.loan?')).map((r) => r.loan?.to),
      ['Maya', undefined],
    )
    // The fan-out answers what a single store answers (C-32800 items 2-4).
    // A REQUEST rides anywhere in the line, last included: it asks for a
    // component beside the filter and narrows nothing, so a store that never
    // planted the word answers the same rows without it — which is what the
    // guide's own example asks of the app the person names.
    assertEquals(await rows('.recipe!&.loan?'), await rows('.loan?&.recipe!'))
    assertEquals(
      (await rows('.recipe!&.loan?', agent, 'recipes')).map((r) =>
        r.recipe!.serves
      ),
      [4, 2],
    )
    // And the kind follows the component the filter REQUIRED, never the
    // clause the caller happened to type first: a recipe is a recipe either
    // way round, exactly as the recipes store alone calls it.
    assertEquals(
      (await rows('.loan?&.recipe!')).map((r) => r.kind),
      (await rows('.recipe!', agent, 'recipes')).map((r) => r.kind),
    )
    // A stamp NAMED in the filter comes back from the fan-out too: the
    // listing rule is cut by the caller's own line, not by the `id=` the
    // composition gathers with, which dropped every byline (item 4).
    assertEquals(
      await rows('.recipe!&.created!'),
      await rows('.recipe!&.created!', agent, 'recipes'),
    )
    assertEquals(
      (await rows('.recipe!&.created!')).map((r) => !!r.created?.at),
      [true, true],
    )
    // `.doc!` is a platform word both stores speak, so the answer is both
    // apps' rows — and the cake is one row, not two. The person row each
    // store mints for its writer wears a title too (store.ts `knows`), and
    // is the platform's bookkeeping, never a row in the person's own list.
    assertEquals(
      (await rows('.doc!')).map((r) => r.doc!.title),
      ['Lemon cake', 'Pancakes', 'Lemon zester'],
    )
    // `*` is the debugging form: every component, wherever it lives.
    let [whole] = await rows(`.doc.title~=Lemon cake&*`)
    assertEquals(whole.recipe!.serves, 4)
    assertEquals(whole.loan!.to, 'Maya')
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
    // His word is not even a WORD in her reach: the one store she can read
    // never planted `recipe`, and a line every store in reach refuses is the
    // first store's sentence (reach.ts asked). It answered an empty set while
    // the grammar's learned words were process-wide — her parse borrowed his
    // store's vocabulary, in whichever order the isolate happened to plant
    // them (T-32814).
    assertStringIncludes(
      await rows('.recipe!', hers).then(() => '', (e: Error) => e.message),
      'unknown prop: .recipe',
    )
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
        created?: { by: string | { eid: string; name: string } }
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

    // A routed write carries the same vouch a page's write does, so a store
    // it lands in — one that had never met this person — mints them with a
    // NAME and the byline reads as one: `created.by` is {eid, name} in the
    // lending store, and the fan-out says the same (C-32800 item 5).
    for (
      let by of [
        (await rows('.loan!&.created!', 'lending'))[0].created!.by,
        (await rows('.loan!&.created!'))[0].created!.by,
      ]
    ) {
      assertEquals(typeof by == 'string' ? by : by.name, jeff.name)
    }

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

// The meter as the agent reads it (T-32757): the hourly sweep's rows, seeded
// here through the one door into the meta store, come back in app_list beside
// the version. The sweep's own parse is usage_test.ts's; what this holds is
// that the word landed in the directory's store and that the answer says it.
slow('app_list answers what the month cost', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [
      { slug: 'metered', apps: ['recipes'] },
    ])
    let agent = connector(k, cookie)
    let month = monthOf(new Date())
    let at = new Date().toISOString()
    let spent = {
      month,
      requests: 1200,
      rows_read: 48358,
      rows_written: 1632,
      bytes: 252_706_816,
      at,
    }
    await meta(k, cookie).apply([
      {
        entity: { eid: eids['metered/recipes'] },
        meter: { ...spent, emails: 0 },
      },
      {
        entity: { eid: eids.metered },
        plan: { tier: 'free' },
        meter: { ...spent, emails: 4 },
      },
    ])
    // A directory write empties the kernel's 30-second read cache
    // (directory.ts), and the seeding above went in through the graph tier,
    // which is not that door. The sweep itself writes through `stamp`, which
    // clears it; a test standing in for the sweep says so here instead of
    // waiting out a TTL.
    await agent.tool('space_new', { slug: 'metered-too', title: 'Too' })
    let said = await agent.tool('app_list', { space: 'metered' })
    assertStringIncludes(said, '1200 requests')
    assertStringIncludes(said, '241 MB')

    // The one number analytics cannot answer: what a store weighs. It comes
    // off the store itself (store.ts `/graph`), which is where the sweep
    // reads it, so a planted store already weighs something.
    let graph = await k.at('metered.yaks.app', '/recipes/api/graph', {
      headers: { cookie },
    })
    assert((await graph.json()).bytes > 0, 'the store says what it weighs')

    // Where the space stands against what it is allowed (T-32758), in the
    // same answer: nothing here is near a ceiling, so it is only the numbers.
    assertStringIncludes(said, 'metered (free tier')
    assertStringIncludes(said, '1 of 5 apps')
    assertStringIncludes(said, '4 of 100 emails')
  } finally {
    await k.stop()
  }
})

// The ceilings the agent sees coming (T-32758): a line at 80%, said once; the
// sixth app refused and the fifth not; data past 1 GB refused at the door.
slow('the free tier: a warning once, then the refusals', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [
      { slug: 'brim', apps: ['one'] },
      { slug: 'heavy', apps: ['big'] },
    ])
    let agent = connector(k, cookie)
    let month = monthOf(new Date())
    let at = new Date().toISOString()
    let row = {
      month,
      rows_read: 0,
      rows_written: 0,
      emails: 0,
      at,
    }
    await meta(k, cookie).apply([
      // 81% of the request ceiling, and nothing else near one.
      {
        entity: { eid: eids.brim },
        plan: { tier: 'free' },
        meter: { ...row, requests: 40_500, bytes: 0 },
      },
      // A gigabyte held: the byte ceiling, exactly at it.
      {
        entity: { eid: eids.heavy },
        plan: { tier: 'free' },
        meter: { ...row, requests: 0, bytes: 1024 ** 3 },
      },
    ])
    // The seeding went in through the graph tier, which is not the door that
    // empties the directory's read cache; a directory write is.
    await agent.tool('space_new', { slug: 'brim-too', title: 'Too' })

    // The line rides the unseen channel, once — the reply after is quiet.
    let said = await agent.tool('app_list', { space: 'brim' })
    assertStringIncludes(said, '## ceiling')
    assertStringIncludes(said, '40,500 of 50,000 requests')
    assertStringIncludes(said, 'Requests are never refused')
    let again = await agent.tool('app_list', { space: 'brim' })
    assert(!again.includes('## ceiling'), 'the ceiling line is said once')

    // Four more apps make five, which is the tier. The fifth is fine.
    for (let n of [2, 3, 4, 5]) {
      await agent.tool('app_new', {
        space: 'brim',
        slug: `a${n}`,
        title: `A${n}`,
      })
    }
    await assertRejects(
      () => agent.tool('app_new', { space: 'brim', slug: 'a6', title: 'A6' }),
      Error,
      'which is 5 apps',
    )
    await assertRejects(
      () => agent.tool('app_new', { space: 'brim', slug: 'a6', title: 'A6' }),
      Error,
      'A paid tier is coming',
    )

    // Data past the ceiling is refused at the app's own door, in the
    // platform's sentence, the way every other refusal is (unseen.ts
    // `refusal`: a no is not a break).
    let heavy = client(k, 'heavy.yaks.app', 'big', cookie)
    let stopped = await heavy.post([{
      entity: { eid: crypto.randomUUID() },
      doc: { title: 'one more' },
    }])
    assertEquals(stopped.status, 413)
    let why = (await stopped.json()).error
    assertEquals(why.code, 'space_full')
    assertStringIncludes(why.message, 'of app data')
  } finally {
    await k.stop()
  }
})

// One word, one home (T-32728): a second app in the space naming a word the
// space already has uses it there — nothing is planted twice, the writes land
// in the home store, a new column grows the home's table, and a shape
// conflict is the only refusal.
slow('a word the space already has is used where it lives', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let manifest = async (slug: string, vocab: unknown) => {
      await agent.tool('app_files', {
        app: slug,
        op: 'write',
        path: 'vocab.json',
        content: JSON.stringify(vocab),
      })
      return await agent.tool('app_deploy', { app: slug })
    }
    let made = async (slug: string, vocab: unknown) => {
      await agent.tool('app_new', { slug, title: slug })
      return await manifest(slug, vocab)
    }
    // The reading list says `book` first, so `book` is the reading list's.
    await made('reading-list', { book: { title: 'text', pages: 'number' } })
    // The lending app says it second: the deploy plants its own word and
    // names where the shared one lives.
    let second = await made('lending', {
      book: { title: 'text' },
      loan: { to: 'text' },
    })
    assertStringIncludes(
      second,
      'book lives in reading-list; this app reads and writes it there',
    )
    assertStringIncludes(second, 'components: loan')
    assertEquals(second.includes('components: book'), false)

    // A book written through the lending app lands in the reading list's
    // store, because that is where the word lives.
    let said = await agent.tool('graph_apply', {
      app: 'lending',
      entities: [{ entity: { eid: '$b' }, book: { title: 'Piranesi' } }],
    })
    assertMatch(said, /reading-list/)
    let piranesi = /\$b=([0-9a-f-]{36})/.exec(said)![1]
    let rows = async (filter: string, app?: string) =>
      JSON.parse(
        await agent.tool('graph_query', { filter, ...(app ? { app } : {}) }),
      ) as {
        entity: { eid: string }
        book?: { title?: string } & Record<string, unknown>
      }[]
    assertEquals(
      (await rows('.book!', 'reading-list')).map((r) => r.entity.eid),
      [piranesi],
    )
    // And there is no second copy: the fan-out answers one bundle, while each
    // store REFUSES the word it never planted. Two stores live in one isolate,
    // so this used to depend on which of them parsed first — the grammar's
    // learned words were process-wide, and the answer was an empty row set
    // where a refusal is owed (T-32814). The vocabulary now rides the parse,
    // per store handle, so both refusals are the store's own, every run.
    assertEquals((await rows(`id=${piranesi}`))[0].book!.title, 'Piranesi')
    let refused = (filter: string, app: string) =>
      agent.tool('graph_query', { filter, app }).then(
        () => '',
        (e: Error) => e.message,
      )
    assertStringIncludes(
      await refused('.book!', 'lending'),
      'unknown prop: .book',
    )
    assertStringIncludes(
      await refused('.loan!', 'reading-list'),
      'unknown prop: .loan',
    )

    // A column the lending app adds to the shared word grows the HOME's
    // table, additively — and is then writable from either app.
    let grew = await manifest('lending', {
      book: { title: 'text', isbn: 'text' },
      loan: { to: 'text' },
    })
    assertStringIncludes(grew, 'added: book.isbn')
    await agent.tool('graph_apply', {
      app: 'lending',
      entities: [{ entity: { eid: piranesi }, book: { isbn: '978' } }],
    })
    assertEquals(
      (await rows(`id=${piranesi}`, 'reading-list'))[0].book!.isbn,
      '978',
    )

    // A TOOL of the lending app may name the borrowed word — the word is
    // this app's to write either way — and the call goes where it lives.
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'tools.json',
      content: JSON.stringify({
        shelve: {
          description: 'Add a book to the shelf',
          input: { title: 'text' },
          apply: { book: { title: '{{title}}' } },
        },
        shelf: { description: 'Every book', input: {}, query: '.book!' },
      }),
    })
    let tooled = await agent.tool('app_deploy', { app: 'lending' })
    assertStringIncludes(tooled, 'tools: lending__shelve, lending__shelf')
    await agent.tool('lending__shelve', { title: 'Solenoid' })
    // One store holds both books: the reading list's, where `book` lives.
    assertEquals(
      (await rows('.book!', 'reading-list')).map((r) => r.book!.title).sort(),
      ['Piranesi', 'Solenoid'],
    )
    // And the lending app's own read tool answers from there too.
    let shelf = await agent.call('tools/call', {
      name: 'lending__shelf',
      arguments: {},
    })
    assertStringIncludes(shelf.content[0].text, 'lending__shelf: 2 rows')

    // The one refusal: the same column with two types, named with both and
    // with the app the word lives in.
    await agent.tool('app_files', {
      app: 'lending',
      op: 'write',
      path: 'vocab.json',
      content: JSON.stringify({
        book: { pages: 'text' },
        loan: { to: 'text' },
      }),
    })
    let why = (await assertRejects(
      () => agent.tool('app_deploy', { app: 'lending' }),
      Error,
    )).message
    assertStringIncludes(why, 'book.pages is text here and number in')
    assertStringIncludes(why, 'reading-list, where book lives')
    // Refused whole: the home's column keeps the type its rows were written
    // under, and nothing about it moved.
    assertEquals(
      (await rows(`id=${piranesi}`, 'reading-list'))[0].book!.pages,
      null,
    )
  } finally {
    await k.stop()
  }
})

// Across spaces a word means what its space says (T-32728): one name, two
// vocabularies. A bundle merges by name only where the shapes agree, and
// otherwise the rows stay apart with the space named beside `kind`.
slow('a word two spaces spell differently stays two words', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let made = async (space: string, slug: string, vocab: unknown) => {
      await agent.tool('space_new', { slug: space, title: space })
      await agent.tool('app_new', { space, slug, title: slug })
      await agent.tool('app_files', {
        space,
        app: slug,
        op: 'write',
        path: 'vocab.json',
        content: JSON.stringify(vocab),
      })
      await agent.tool('app_deploy', { space, app: slug })
    }
    let shelf = `shelf-${crypto.randomUUID().slice(0, 8)}`
    let stall = `stall-${crypto.randomUUID().slice(0, 8)}`
    // `book` agrees where both declare — `pages` is one space's alone, and a
    // vocabulary only ever grows. `note.body` does not: text here, number
    // there, so the name is two words.
    await made(shelf, 'reading', {
      book: { title: 'text', pages: 'number' },
      note: { body: 'text' },
    })
    await made(stall, 'catalog', {
      book: { title: 'text' },
      note: { body: 'number' },
    })
    let piranesi = crypto.randomUUID()
    await agent.tool('graph_apply', {
      space: shelf,
      app: 'reading',
      entities: [{
        entity: { eid: piranesi },
        book: { title: 'Piranesi', pages: 245 },
        note: { body: 'lovely' },
      }],
    })
    await agent.tool('graph_apply', {
      space: stall,
      app: 'catalog',
      entities: [{
        entity: { eid: piranesi },
        book: { title: 'Piranesi' },
        note: { body: 3 },
      }],
    })
    let rows = async (filter: string) =>
      JSON.parse(await agent.tool('graph_query', { filter })) as {
        kind: string
        space?: string
        book?: { title?: string; pages?: number }
        note?: { body?: unknown }
      }[]
    // The shapes agree, so the name is one word and the answer is one bundle.
    let agreed = await rows('.book!')
    assertEquals(agreed.length, 1)
    assertEquals(agreed[0].space, undefined)
    assertEquals(agreed[0].book!.pages, 245)
    // They do not agree, so the rows stay apart, each saying which space it
    // is answering for.
    let apart = await rows('.note!')
    assertEquals(apart.length, 2)
    assertEquals(apart.map((r) => r.space!).sort(), [shelf, stall].sort())
    assertEquals(
      apart.map((r) => r.note!.body).sort(),
      ['lovely', 3].sort(),
    )
  } finally {
    await k.stop()
  }
})

// An app is a plugin (D-32318 §Nouns, T-32888): a deployed app is OFFERED to
// every other space under a platform-wide name, that name is one app's — a
// second claim on it is refused in a sentence — and withdrawing the offer
// leaves the app, and everyone who took it, exactly as they were.
slow('an app is published by name, and the name is one app', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let mine = jeff.email.split('@')[0]
    let agent = connector(k, jeff.cookie)
    let made = async (space: string, slug: string) => {
      await agent.tool('app_new', { space, slug, title: slug })
      await agent.tool('app_files', {
        space,
        app: slug,
        op: 'write',
        path: 'index.html',
        content: `<h1>${slug}</h1>`,
      })
    }
    assertEquals(await agent.tool('app_published'), 'nothing is published yet')

    // An app that has never deployed serves nothing an installer could copy.
    await made(mine, 'recipes')
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_publish', { space: mine, app: 'recipes' }),
        Error,
      )).message,
      'has never been deployed',
    )
    await agent.tool('app_deploy', { space: mine, app: 'recipes' })

    // Published under its own slug, at the version that is serving.
    let said = await agent.tool('app_publish', {
      space: mine,
      app: 'recipes',
      about: 'Somewhere to keep recipes',
    })
    assertStringIncludes(said, 'published recipes v1')
    assertStringIncludes(said, 'Somewhere to keep recipes')
    assertStringIncludes(said, "app_install(name: 'recipes')")
    let listed = await agent.tool('app_published')
    assertStringIncludes(listed, '- recipes v1')
    assertStringIncludes(listed, 'Somewhere to keep recipes')

    // A SECOND space claiming the same name is refused, named with the app
    // that has it — and its own slug is free, so it offers under another.
    await agent.tool('space_new', { slug: 'kitchen', title: 'kitchen' })
    await made('kitchen', 'recipes')
    await agent.tool('app_deploy', { space: 'kitchen', app: 'recipes' })
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_publish', { space: 'kitchen', app: 'recipes' }),
        Error,
      )).message,
      'recipes is published by',
    )
    await agent.tool('app_publish', {
      space: 'kitchen',
      app: 'recipes',
      name: 'recipe-box',
    })
    assertEquals((await agent.tool('app_published')).split('\n').length, 2)

    // Publishing the same app again is not a second offer: it moves the
    // version on the one that stands, and keeps the line already said.
    await agent.tool('app_deploy', { space: mine, app: 'recipes' })
    assertStringIncludes(
      await agent.tool('app_publish', { space: mine, app: 'recipes' }),
      'published recipes v2',
    )
    let again = await agent.tool('app_published')
    assertStringIncludes(again, '- recipes v2')
    assertStringIncludes(again, 'Somewhere to keep recipes')
    assertEquals(again.split('\n').length, 2)

    // A name is claimed ONCE (T-32908, C-32905 item 4). The kitchen app is
    // offered as `recipe-box`, which is not its slug: republishing it with no
    // name keeps that name and says so. Before this it silently renamed the
    // offer to the app's slug, and everyone told to install `recipe-box`
    // found nothing.
    await agent.tool('app_deploy', { space: 'kitchen', app: 'recipes' })
    assertStringIncludes(
      await agent.tool('app_publish', { space: 'kitchen', app: 'recipes' }),
      'published recipe-box v2',
    )
    let kept = await agent.tool('app_published')
    assertStringIncludes(kept, '- recipe-box v2')
    assertEquals(kept.split('\n').length, 2)

    // Moving it takes an explicit name, and the answer says what the old one
    // is worth now.
    let renamed = await agent.tool('app_publish', {
      space: 'kitchen',
      app: 'recipes',
      name: 'recipe-cards',
    })
    assertStringIncludes(renamed, 'published recipe-cards v2')
    assertStringIncludes(renamed, 'it was offered as recipe-box')
    assertStringIncludes(renamed, 'no longer resolves')
    let moved = await agent.tool('app_published')
    assertStringIncludes(moved, '- recipe-cards v2')
    assertEquals(moved.includes('recipe-box'), false)
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_install', { space: mine, name: 'recipe-box' }),
        Error,
      )).message,
      'nothing is published as recipe-box',
    )

    // Only an owner may: an editor writes the app's files and does not hand
    // its code to strangers.
    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    await agent.tool('member_add', {
      space: mine,
      email: ann.email,
      role: 'editor',
    })
    assertStringIncludes(
      (await assertRejects(
        () =>
          connector(k, ann.cookie).tool('app_publish', {
            space: mine,
            app: 'recipes',
          }),
        Error,
      )).message,
      'not the owner of',
    )

    // Withdrawn: the app stands, the name is free again, the offer is gone.
    assertStringIncludes(
      await agent.tool('app_unpublish', { space: mine, app: 'recipes' }),
      'no longer offered',
    )
    let left = await agent.tool('app_published')
    assertEquals(left.split('\n').length, 1)
    assertStringIncludes(left, 'recipe-cards')
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('app_unpublish', { space: mine, app: 'recipes' }),
        Error,
      )).message,
      'is not published',
    )
    // And the app itself is untouched: it serves what it always did.
    assertStringIncludes(
      await agent.tool('app_files', {
        space: mine,
        app: 'recipes',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>recipes</h1>',
    )
  } finally {
    await k.stop()
  }
})

// The whole of T-32889: an installed app is an ORDINARY app in the
// installer's space — its own store, its own address, its own data from the
// first byte — pinned to the version it took, so the publisher's next version
// arrives only when the installer asks for it. An update keeps their data: a
// vocabulary that only grew is grafted, one that conflicts is refused with
// the deploy's own sentence (T-32728) and nothing moves.
slow('an installed app is the installer own copy, data and all', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let his = connector(k, jeff.cookie)
    let write =
      (agent: ReturnType<typeof connector>, app: string) =>
      (path: string, content: string) =>
        agent.tool('app_files', { app, op: 'write', path, content })
    let mine = write(his, 'tally')
    await his.tool('app_new', { slug: 'tally', title: 'Tally' })
    await mine('index.html', '<h1>Tally v1</h1>')
    await mine('vocab.json', '{"vote": {"who": "text", "pick": "text"}}')
    await his.tool('app_deploy', { app: 'tally' })
    await his.tool('app_publish', { app: 'tally', about: 'Count the votes' })
    let votes = (agent: ReturnType<typeof connector>) => async () =>
      (JSON.parse(
        await agent.tool('graph_query', { app: 'tally', filter: '.vote!' }),
      ) as { vote: { who: string; pick?: string } }[])
        .map((r) => r.vote.who).sort()
    let cast = (agent: ReturnType<typeof connector>, who: string) =>
      agent.tool('graph_apply', {
        app: 'tally',
        entities: [{ entity: { eid: '$v' }, vote: { who, pick: 'blue' } }],
      })
    await cast(his, 'jeff')

    // A SECOND person, in their own space, takes it.
    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    let hers = connector(k, ann.cookie)
    let space = ann.email.split('@')[0]
    assertStringIncludes(await hers.tool('app_published'), '- tally v1')
    let took = await hers.tool('app_install', { name: 'tally' })
    assertStringIncludes(took, 'installed tally v1 as ' + space + '/tally')
    assertStringIncludes(took, `https://${space}.yaks.app/tally/`)
    assertStringIncludes(took, '2 files')
    assertStringIncludes(took, 'components: vote')

    // The code came; the data did not. Her store is empty and her page is
    // the one that was published.
    assertEquals(await votes(hers)(), [])
    assertStringIncludes(
      await hers.tool('app_files', {
        app: 'tally',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>Tally v1</h1>',
    )
    // And it serves at HER address, out of her own app.
    let page = await k.at(`${space}.yaks.app`, '/tally/')
    assertEquals(page.status, 200)
    assertStringIncludes(await page.text(), '<h1>Tally v1</h1>')

    // Both write, and neither sees the other: two stores, one code.
    await cast(hers, 'ann')
    assertEquals(await votes(his)(), ['jeff'])
    assertEquals(await votes(hers)(), ['ann'])

    // A SECOND version, published. Nothing of hers moves until she asks.
    await mine('index.html', '<h1>Tally v2</h1>')
    await mine(
      'vocab.json',
      '{"vote": {"who": "text", "pick": "text", "at": "text"}}',
    )
    await his.tool('app_deploy', { app: 'tally' })
    await his.tool('app_publish', { app: 'tally' })
    assertStringIncludes(
      await hers.tool('app_files', {
        app: 'tally',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>Tally v1</h1>',
    )

    // Asked for: the code moves, the data stays, the word grows.
    let moved = await hers.tool('app_update', { app: 'tally' })
    assertStringIncludes(moved, 'updated ' + space + '/tally from v1 to v2')
    assertStringIncludes(moved, 'everything it had saved is still there')
    assertStringIncludes(moved, 'added: vote.at')
    assertEquals(await votes(hers)(), ['ann'])
    assertStringIncludes(
      await hers.tool('app_files', {
        app: 'tally',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>Tally v2</h1>',
    )
    // The grown column is writable in HER store, on the row she already had.
    await hers.tool('graph_apply', {
      app: 'tally',
      entities: [{
        entity: { eid: '$v' },
        vote: { who: 'ann2', pick: 'red', at: 'today' },
      }],
    })
    assertEquals(await votes(hers)(), ['ann', 'ann2'])
    // Twice is not twice: the pin is already there.
    assertStringIncludes(
      await hers.tool('app_update', { app: 'tally' }),
      'is already at v2',
    )

    // A CONFLICT: her copy declared a column of its own, and the publisher's
    // next version spells the same one differently. The update is refused
    // with the deploy's own sentence, and not a byte of her app moves.
    await write(hers, 'tally')(
      'vocab.json',
      '{"vote": {"who": "text", "pick": "text", "at": "text", ' +
        '"count": "number"}}',
    )
    await hers.tool('app_deploy', { app: 'tally' })
    await mine(
      'vocab.json',
      '{"vote": {"who": "text", "pick": "text", "at": "text", ' +
        '"count": "text"}}',
    )
    await mine('index.html', '<h1>Tally v3</h1>')
    await his.tool('app_deploy', { app: 'tally' })
    await his.tool('app_publish', { app: 'tally' })
    assertStringIncludes(
      (await assertRejects(
        () => hers.tool('app_update', { app: 'tally' }),
        Error,
      )).message,
      'vote.count is already number',
    )
    assertStringIncludes(
      await hers.tool('app_files', {
        app: 'tally',
        op: 'read',
        path: 'index.html',
      }),
      '<h1>Tally v2</h1>',
    )
    assertEquals(await votes(hers)(), ['ann', 'ann2'])

    // An app that was never installed has nothing to update to.
    assertStringIncludes(
      (await assertRejects(
        () => his.tool('app_update', { app: 'tally' }),
        Error,
      )).message,
      'was not installed from anywhere',
    )
  } finally {
    await k.stop()
  }
})

// The whole of T-32907 (C-32905 items 1 and 3): an app's own files never name
// the app. Its pages say `./api/client.js` and `./style.css`, the kernel gives
// every page it serves a `<base href>` at the app's OWN address, and the copy
// someone installs works at whatever address it took — including from a pretty
// path, where a relative URL would otherwise resolve against the page's depth.
// Before this, an install under another name served bare HTML: no stylesheet,
// no script, and nothing said so.
slow('an app names no app, and the copy works at its own address', async () => {
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

    // With no address asked for, a copy lands at the app's OWN slug — the one
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
// one — as a NEW version, since history is never rewritten.
slow('a deploy is a version, and one word puts it back', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: 'undo', apps: ['recipes'] }])
    let agent = connector(k, cookie)
    let app = { space: 'undo', app: 'recipes' }
    let served = async (path: string) => {
      let r = await k.at('undo.yaks.app', `/recipes/${path}`)
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
    assertStringIncludes(list, 'undo/recipes: 2 versions')
    // When it went out, off the row's own created stamp.
    assertMatch(list, /- v2 \(live\) 20\d\d-\d\d-\d\dT/)
    assertStringIncludes(list, 'added broken.js, changed index.html')

    // One word. It names what came back and where, and goes out as v3.
    let back = await agent.tool('app_rollback', app)
    assertStringIncludes(back, 'put undo/recipes back to v1, live now as v3')
    assertStringIncludes(back, 'https://undo.yaks.app/recipes/')
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
    assertStringIncludes(after, 'undo/recipes: 3 versions')
    assertStringIncludes(after, 'v3 (live)')
    assertMatch(
      await agent.tool('app_rollback', { ...app, version: 2 }),
      /put undo\/recipes back to v2, live now as v4/,
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
      'no v9 of undo/recipes — it keeps v4, v3, v2, v1',
    )
    assertEquals(
      (await agent.tool('app_files', { ...app, op: 'list' })).split('\n')
        .sort(),
      ['broken.js', 'index.html'],
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
slow(
  'after a rollback, the list says what is live and what came back',
  async () => {
    let k = await kernel()
    try {
      let { cookie, eids } = await seed(k, [{
        slug: 'back',
        apps: ['recipes'],
      }])
      let agent = connector(k, cookie)
      let app = { space: 'back', app: 'recipes' }
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
      await (await k.at('back.yaks.app', '/recipes/')).body?.cancel()
      await meta(k, cookie).apply([
        { entity: { eid: eids['back/recipes'] }, app: { version: 4 } },
        {
          deploy: {
            app: eids['back/recipes'],
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

// D-32318 §Errors, verbatim: "One is open until a later deploy stops
// producing it or the agent marks it fixed." So the deploy that carries the
// fix closes it, with nobody archiving by hand (T-32910, C-32905 item 7).
slow('the deploy that fixes a break closes it', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: 'mend', apps: ['weather'] }])
    let agent = connector(k, cookie)
    let app = { space: 'mend', app: 'weather' }
    let report = (message: string) =>
      k.at('mend.yaks.app', '/weather/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          url: 'https://mend.yaks.app/weather/',
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
      await agent.tool('app_list', { space: 'mend' }),
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
      !(await agent.tool('app_list', { space: 'mend' })).includes('open'),
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

// A space's front page is a choice (T-32947). The first app made in a space
// claims its bare hostname and nothing used to move it, so a throwaway first
// app was the space's face forever. app_set(home) moves it; home false leaves
// the space with none, answering the soft 404 a space with no app answers.
// Where the space's own address points is the owner's, like publishing and
// membership — an editor is refused.
slow('the front page moves, and only the owner moves it', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'front', apps: ['first', 'second'] }])
    let agent = connector(k, them.cookie)
    let bare = () => k.at('front.yaks.app', '/', { redirect: 'manual' })
    let was = await bare()
    assertEquals(was.headers.get('location'), '/first/')
    await was.body?.cancel()

    let said = await agent.tool('app_set', {
      space: 'front',
      app: 'second',
      home: true,
    })
    assertStringIncludes(said, 'the front page now')
    assertStringIncludes(said, 'https://front.yaks.app/')
    let moved = await bare()
    assertEquals(moved.status, 302)
    assertEquals(moved.headers.get('location'), '/second/')
    await moved.body?.cancel()

    // Said where the person reads what they have: in the sentence, and in the
    // data the view beside it draws.
    let listing = await agent.call('tools/call', {
      name: 'app_list',
      arguments: { space: 'front' },
    })
    assertStringIncludes(listing.content[0].text, 'second/ — the front page')
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
    assertEquals(none.status, 404)
    assertMatch(await none.text(), /Nothing here yet/)
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
    assertEquals(still.status, 404)
    await still.body?.cancel()
  } finally {
    await k.stop()
  }
})

// The other direction (T-32950): an app's breaks reach the person's agent,
// and this is how the person reaches US. The tool writes a `report` row in
// the meta store, attributed to whoever's agent called it, and mails the same
// words to the platform's own address — the letter leading with what was
// said, since a person reads it at a glance.
slow('feedback reaches the platform, in the words it was said in', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'kitchen', apps: ['recipes'] }])
    let agent = connector(k, them.cookie)
    let app = { space: 'kitchen', app: 'recipes' }
    await agent.tool('app_files', {
      ...app,
      files: [{ path: 'index.html', content: '<h1>Recipes</h1>' }],
    })
    await agent.tool('app_deploy', app)

    let words = 'She said renaming an app is impossible to find. I looked ' +
      'for app_rename and there is no such tool.'
    let said = await agent.tool('feedback', { app: 'recipes', text: words })
    // One sentence the agent can repeat: it arrived, and they can answer.
    assertStringIncludes(said, 'people who run yaks.app')
    assertStringIncludes(said, 'kitchen/recipes v1')
    assertStringIncludes(said, them.email)

    // The letter: the words first, the context under a rule beneath them.
    let sent = await letter(k, 'hello@yaks.app', 'app_rename')
    assertStringIncludes(sent.subject, 'feedback: She said renaming')
    assert(sent.body.startsWith(words), sent.body)
    assertStringIncludes(sent.body, `${them.name} <${them.email}>`)
    assertStringIncludes(sent.body, 'kitchen/recipes v1')
    assertStringIncludes(sent.body, 'https://kitchen.yaks.app/recipes/')
    assertStringIncludes(sent.body, `yaks.app ${VERSION}`)

    // The row, in the meta store: the words, who said them, and where they
    // were standing — the app, the deploy it was serving, and the platform's
    // own release, none of which anyone was asked for.
    let rows = await meta(k, them.cookie).query('.report!&.doc?&.created?')
    assertEquals(rows.length, 1)
    let one = rows[0] as unknown as {
      doc: { title: string; body: string }
      report: {
        app: unknown
        space: unknown
        version: number
        release: string
        at: string
      }
      created: { by: { name: string } }
    }
    assertEquals(one.doc.body, words)
    assertStringIncludes(one.doc.title, 'She said renaming')
    assertEquals(one.created.by.name, them.name)
    assertEquals(one.report.version, 1)
    assertEquals(one.report.release, VERSION)
    assertStringIncludes(
      JSON.stringify(one.report.app),
      them.eids['kitchen/recipes'],
    )
    assertStringIncludes(JSON.stringify(one.report.space), them.eids.kitchen)

    // And with no app: the space still rides along, and the letter carries no
    // link to a page nobody named.
    let plain = await agent.tool('feedback', {
      text: 'The sign-in code took four minutes to arrive.',
    })
    assertStringIncludes(plain, 'people who run yaks.app')
    let second = await letter(k, 'hello@yaks.app', 'four minutes')
    assertEquals(second.body.includes('/recipes/'), false)
    let [, noApp] = await meta(k, them.cookie).query(
      '.report!&.doc?',
    ) as unknown as { report: { app: unknown; version: unknown } }[]
    assertEquals(noApp.report.app, null)
    assertEquals(noApp.report.version, null)

    // A few an hour is plenty. The fourth is a pause, not a no: it says the
    // ones already sent are kept, and where to write if it cannot wait.
    await agent.tool('feedback', { text: 'The board scrolls sideways.' })
    let stopped = await assertRejects(
      () => agent.tool('feedback', { text: 'And again.' }),
      Error,
    )
    assertStringIncludes(stopped.message, 'kept and will be read')
    assertStringIncludes(stopped.message, 'hello@yaks.app')
    // Nothing was written for the one that was held.
    assertEquals((await meta(k, them.cookie).query('.report!')).length, 3)
  } finally {
    await k.stop()
  }
})
