// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow } from '../../src/testing.ts'

import { connector, kernel, signedIn } from './probe.ts'
import { PAGES, uriOf } from './guide.ts'
import { PROMPTS } from './prompts.ts'
import { sha256 } from './versions.ts'
import { APPS, ERRORS, facing, GUIDE, minted } from './mcp-probe.ts'

slow(
  'the connector: tools, a space made, an app served, errors seen',
  async () => {
    let k = await kernel()
    try {
      let jeff = crypto.randomUUID()
      let agent = connector(k, await signedIn(k, jeff))
      // Nobody is answered anything of the person's — and the refusal says
      // so in a sentence, with where signing in happens, like every other
      // door (C-32607 item 1), and carries the challenge a host reads to
      // offer signing in (T-34349). What nobody IS answered is the pre-auth
      // surface, held in its own test below (T-33030).
      let shut = await k.at('yaks.app', '/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/call",' +
          '"params":{"name":"app_list"}}',
      })
      assertEquals(shut.status, 401)
      let refusal = (await shut.json()).result
      assertEquals(refusal.isError, true)
      assertStringIncludes(
        refusal.content[0].text,
        'sign in at https://yaks.app',
      )
      assertStringIncludes(
        refusal._meta['mcp/www_authenticate'][0],
        'resource_metadata=',
      )
      await assertRejects(
        () => connector(k).call('prompts/get', { name: 'make' }),
        Error,
        '401',
      )
      let init = await agent.call('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'probe', version: '0' },
      })
      assertEquals(init.protocolVersion, '2025-03-26')
      facing(init.serverInfo)
      let { tools } = await agent.call('tools/list')
      assertEquals(tools.map((t: { name: string }) => t.name), [
        // The generic tier, whole, from @yaks/mcp (T-33812) — bundles in and
        // out over the caller's reach, each with an output schema derived from
        // the vocabulary those apps declare.
        'graph_apply',
        'graph_query',
        'graph_show',
        'graph_schema',
        'search',
        // And the platform's own verbs beside them, one plugin's tools.
        'space_new',
        // Moving a space's address, and letting one it left go (T-34658,
        // T-34659).
        'space_set',
        'space_delete',
        'space_restore',
        // Connecting the space's own Stripe account, so its apps can take
        // money (sell.ts, T-34524).
        'space_sell',
        'app_new',
        'app_files',
        // The builder's workbench, offered to a person's own agent on the
        // same terms it is offered to ours (sandbox.ts, T-34264).
        'sandbox_exec',
        'sandbox_write',
        'sandbox_read',
        'sandbox_ship',
        'app_deploy',
        'store_load',
        'app_versions',
        'app_rollback',
        // The data half of the same word (recover.ts, T-34507): a rollback
        // puts the files back, this puts the store back.
        'store_restore',
        'app_set',
        'app_secret_set',
        'app_secret_list',
        'app_secret_remove',
        'app_delete',
        'app_restore',
        'app_errors',
        'app_list',
        // The apps' own verbs, carried by two fixed tools (declared.ts,
        // T-34541): what they can do, and running one.
        'commands',
        'command',
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
        // The token that signs a terminal in (grants.ts, T-34385).
        'grant',
        'feedback',
        // The guide itself, so nothing has to be fetched off the web
        // (T-34284).
        'guide',
        // The two anybody may call, signed in or not (preauth.ts, T-33030) —
        // what this place is, and the gallery, which is a public page either
        // way (gallery.ts, T-34478).
        'about',
        'gallery_search',
        // Then what the PLUGINS bring, after the platform's own rows and in
        // list order (plugin.ts, T-34601): what the person said, in their own
        // words (memory.ts, T-34473), then who visited, in counts and never in
        // names (views.ts, T-34498).
        'memory_save',
        'memory_recall',
        'app_stats',
        // And the post room's own two (letters.ts, T-34149), a plugin of
        // their own because they answer bundles rather than a sentence.
        'mail_list',
        'mail_send',
      ])
      assert(tools.every((t: { inputSchema: unknown }) => t.inputSchema))
      // Every one arrives with a title and the four hints (T-34345, T-34346),
      // because a host decides what it may call without asking from these and
      // both directories check them mechanically. hints_test.ts pins which
      // tool is which; here is the proof they survive the wire — the audit
      // found `about` reaching a client as a bare name and nothing else.
      // And every destructive one arrives having said its way back (T-34509).
      // hints_test.ts pins the words; what is proved here is that they reach a
      // client — including graph_apply's, which the generic package cannot
      // know and this door supplies (@yaks/mcp `CoreOpts.undo`).
      type Said = { name: string; description?: string }
      for (let t of tools as (Said & { annotations?: { d?: boolean } })[]) {
        let hints = (t as { annotations?: Record<string, boolean> }).annotations
        if (!hints?.destructiveHint) continue
        assertStringIncludes(
          t.description ?? '',
          'way back',
          `${t.name} reached the client naming no way back`,
        )
      }
      assertStringIncludes(
        (tools as Said[]).find((t) => t.name == 'graph_apply')!.description!,
        'store_restore',
      )
      type Listed = { title?: string; annotations?: Record<string, boolean> }
      for (let t of tools as (Listed & { name: string })[]) {
        assert(t.title, `${t.name} arrived with no title`)
        assertEquals(Object.keys(t.annotations ?? {}).sort(), [
          'destructiveHint',
          'idempotentHint',
          'openWorldHint',
          'readOnlyHint',
        ], t.name)
      }
      let hints = (name: string) =>
        (tools as (Listed & { name: string })[]).find((t) => t.name == name)
          ?.annotations
      // Listing a person's own apps is not a thing to stop and ask about;
      // throwing one away is.
      assertEquals(hints('app_list'), {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      })
      assertEquals(hints('app_delete'), {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      })
      // A create only adds; a letter leaves the platform for good. And an
      // app coming back out of the trash destroys nothing, however many times
      // it is asked (T-34430).
      assertEquals(hints('app_new')?.destructiveHint, false)
      assertEquals(hints('app_restore'), {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      })
      assertEquals(hints('mail_send')?.openWorldHint, true)
      // The generic tier promises the shape of its answer, so a caller reads a
      // described value instead of parsing prose (@yaks/mcp `outputSchema`).
      // The mail tools answer bundles too, so they promise the same.
      for (
        let name of [
          'graph_apply',
          'graph_query',
          'graph_show',
          'search',
          'mail_list',
          'mail_send',
        ]
      ) {
        let one = tools.find((t: { name: string }) => t.name == name)
        assert(one.outputSchema, `${name} says what it answers`)
      }

      // What a model reads before anything else: the address, the four
      // steps, and the store a page writes to — enough to build the first
      // app WITH its data without opening anything (T-32481).
      for (
        let said of [
          // The platform's NAME, said before anything else: an agent that
          // only ever read the address called the place "Yaks" (T-34302).
          'This is yaks.app',
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
      // The generic tier says its own grammar (@yaks/mcp): a query LINE in,
      // whole bundles out, and a batch of bundles to write.
      assertStringIncludes(says('graph_query'), 'query LINE')
      assertStringIncludes(says('graph_apply'), 'BUNDLES')
      // Both mail tools say WHICH mailbox they are, because the tool list is
      // where a model with a mail connector beside this one decides what
      // "check my email" meant (T-34149).
      for (let name of ['mail_list', 'mail_send']) {
        assertStringIncludes(says(name), '<space>.<app>@yaks.app')
        assertStringIncludes(says(name), "not a person's own mailbox")
      }
      // And the instructions say the same thing once more, where an agent
      // reads it before it has chosen any tool at all.
      assertStringIncludes(init.instructions, 'mail_list and mail_send')
      assertStringIncludes(init.instructions, 'check my email')

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

      // And the same words as a TOOL (T-34284), because an agent that cannot
      // fetch yaks.app cannot follow a link and a resource is a thing only
      // some clients read. No page is the map, which opens with its own
      // heading; the description names every page, so the choice is made from
      // the tool list.
      let guide = tools.find((t: { name: string }) => t.name == 'guide')
      assertEquals(guide.annotations.readOnlyHint, true)
      assertEquals(
        guide.outputSchema.required.sort(),
        ['markdown', 'page'],
      )
      for (let p of PAGES) assertStringIncludes(guide.description, p.slug)
      let map = await agent.tool('guide')
      assertEquals(map, await (await k.at('yaks.app', '/guide.md')).text())
      assertStringIncludes(map, '# ')
      // A page, byte for byte what the web serves at its own address.
      assertEquals(
        await agent.tool('guide', { page: 'mail' }),
        await (await k
          .at('yaks.app', '/guide/mail.md')).text(),
      )
      // The structured answer says which page it is, beside the words.
      let answered = await agent.call('tools/call', {
        name: 'guide',
        arguments: { page: 'mail' },
      })
      assertEquals(answered.structuredContent.page, 'mail')
      assertEquals(
        answered.structuredContent.markdown,
        answered.content[0].text,
      )
      // A name that is no page is a typo, not a refusal: the map, with one
      // line above it naming what there is.
      let missed = await agent.tool('guide', { page: 'nope' })
      assertStringIncludes(missed, 'There is no guide page `nope`')
      assertStringIncludes(missed, 'querying')
      assertStringIncludes(missed, map)

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
      // What a host is told ABOUT the page, on the listing and on the bytes
      // both (T-34350): the sandbox origin the plugin gets, and an empty
      // allowlist, since this page is one file that fetches nothing. Missing,
      // ChatGPT stamps it "CSP off" and the widget fails to load (T-34433).
      for (let said of [view, drawn]) {
        assertEquals(said._meta.ui.domain, 'https://yaks.app')
        assertEquals(said._meta.ui.csp, {})
        assertEquals(said._meta['openai/widgetDomain'], 'https://yaks.app')
        assertEquals(said._meta['openai/widgetCSP'], {
          connect_domains: [],
          resource_domains: [],
        })
      }
      // And a page a host merely READS carries none of it.
      assertEquals(
        (resources.find((r: { uri: string }) => r.uri == GUIDE))._meta,
        undefined,
      )
      await assertRejects(
        () => agent.call('resources/read', { uri: 'https://yaks.app/nope' }),
        Error,
        'not found',
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
      assertEquals(cards._meta.ui.domain, 'https://yaks.app')
      assertEquals(cards._meta.ui.csp, {})
      // Both views accept the host's alternate result bridge.
      for (let page of [drawn.text, cards.text]) {
        assertStringIncludes(page, 'window.openai')
      }

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
        'app-ideas',
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
      // The ideas door (T-34557), asked by somebody who has made nothing
      // here yet: the question, the guidance, and no sign-in line — they are
      // signed in, so an idea is one tool call from being an app.
      let ideas = (await agent.call('prompts/get', { name: 'app-ideas' }))
        .messages[0].content.text
      assertStringIncludes(ideas, "Any yaks.app ideas you think I'd like")
      assertStringIncludes(ideas, 'I have not made anything there yet')
      assertStringIncludes(ideas, 'https://yaks.app/guide.md')
      assertEquals(ideas.includes('https://yaks.app/login'), false)
      // The spec's two -32602s: a name nobody offers, and a required
      // argument nobody filled in.
      await assertRejects(
        () => agent.call('prompts/get', { name: 'nope' }),
        Error,
        'not found',
      )
      await assertRejects(
        () => agent.call('prompts/get', { name: 'make' }),
        Error,
        'Invalid arguments for prompt make',
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
      // The generic tier reads the caller's whole reach and names no app, so
      // a person with nothing saved anywhere reads nothing (T-33812).
      assertEquals(
        JSON.parse(await agent.tool('graph_query', { q: '.doc!' })),
        [],
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
      // first app answers the space's bare hostname. A write says what it
      // stored — bytes and sha256 — so a transcription is checked in the
      // call that made it (T-34337).
      let page = '<!doctype html><h1>Our recipe box</h1>'
      let app = { space: 'jeff', app: 'recipes' }
      assertEquals(
        await agent.tool('app_files', {
          ...app,
          op: 'write',
          path: 'index.html',
          content: page,
        }),
        'wrote index.html → https://jeff.yaks.app/recipes/index.html — ' +
          `${page.length} bytes, sha256 ${await sha256(
            new TextEncoder().encode(page),
          )}`,
      )
      // And `op` is not needed to say so: path and content ARE the write,
      // which is what the description always promised (T-34337).
      await agent.tool('app_files', {
        ...app,
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
        'wrote 2 files → https://jeff.yaks.app/recipes/:\n' +
          `app.js — 24 bytes, sha256 ${await sha256(
            new TextEncoder().encode('export let go = () => {}'),
          )}\nimg/logo.svg — 6 bytes, sha256 ${await sha256(
            new TextEncoder().encode('<svg/>'),
          )}`,
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
      assertStringIncludes(
        lost.message,
        'op: one of list, read, write, patch, fetch, delete',
      )
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
      // A .json write is parsed in the same breath, so a miscounted bracket
      // is caught in the call that made it rather than once the app serves
      // broken (T-34337). Both files land — the verdict is a sentence, not a
      // refusal, since a half-written file is a thing agents write on purpose.
      assertStringIncludes(
        await agent.tool('app_files', {
          ...app,
          path: 'vocab.json',
          content: '{"recipe": {"serves": "number"}}',
        }),
        '32 bytes, sha256 ',
      )
      assertStringIncludes(
        await agent.tool('app_files', {
          ...app,
          path: 'vocab.json',
          content: '{"recipe": {"serves": "number"}',
        }),
        'NOT valid JSON — ',
      )
      await agent.tool('app_files', {
        ...app,
        op: 'delete',
        path: 'vocab.json',
      })
      // A patch is the read-modify-write loop in one call: exact, and once.
      assertStringIncludes(
        await agent.tool('app_files', {
          ...app,
          op: 'patch',
          path: 'index.html',
          find: 'Our recipe box',
          replace: 'The recipe box',
        }),
        'patched index.html → https://jeff.yaks.app/recipes/index.html — ',
      )
      assertEquals(
        await agent.tool('app_files', {
          ...app,
          op: 'read',
          path: 'index.html',
        }),
        '<!doctype html><h1>The recipe box</h1>',
      )
      await assertRejects(
        () =>
          agent.tool('app_files', {
            ...app,
            op: 'patch',
            path: 'index.html',
            find: 'Our recipe box',
            replace: 'x',
          }),
        Error,
        'find matched 0 times in index.html',
      )
      await agent.tool('app_files', {
        ...app,
        op: 'patch',
        path: 'index.html',
        find: 'The recipe box',
        replace: 'Our recipe box',
      })
      // A file that is NOT text goes as base64 (T-34263): the `.wasm` an
      // app's worker imports cannot be `content: string`, and a deploy that
      // cannot carry it is a worker compiled from another language that can
      // never be uploaded. The bytes come back byte for byte, typed as wasm.
      let wasm = Deno.readFileSync(
        new URL('./fixtures/add.wasm', import.meta.url),
      )
      await agent.tool('app_files', {
        ...app,
        op: 'write',
        path: 'add.wasm',
        base64: btoa(String.fromCharCode(...wasm)),
      })
      let back = await k.at('jeff.yaks.app', '/recipes/add.wasm')
      assertEquals(back.headers.get('content-type'), 'application/wasm')
      assertEquals(new Uint8Array(await back.arrayBuffer()), wasm)
      await assertRejects(
        () =>
          agent.tool('app_files', {
            ...app,
            op: 'write',
            path: 'x.wasm',
            base64: 'not base64!',
          }),
        Error,
        'base64: not base64',
      )
      await agent.tool('app_files', { ...app, op: 'delete', path: 'add.wasm' })
      assertMatch(await agent.tool('app_deploy', app), /v1/)
      assertMatch(await agent.tool('app_deploy', app), /v2/)
      let served = await k.at('jeff.yaks.app', '/recipes/')
      assertEquals(served.status, 200)
      // The page as written, given the app's own address to resolve its
      // relative URLs against (apps.ts `based`, T-32907).
      let html = await served.text()
      assertStringIncludes(html, '<h1>Our recipe box</h1>')
      assertStringIncludes(html, '<base href="/recipes/">')
      // No app is the space's front page unless somebody says so, so the
      // bare hostname lists what is here (T-33040, home_test.ts).
      let bare = await k.at('jeff.yaks.app', '/', { redirect: 'manual' })
      assertEquals(bare.status, 200)
      assertStringIncludes(await bare.text(), 'href="/recipes/"')

      // The graph tier, which is @yaks/mcp's (T-33812): bundles in, the batch
      // AS APPLIED out — every entity it touched, wearing what moved, and the
      // `$alias` the batch called a minted one by, so a second batch can use
      // the eids the first minted without reading a sentence.
      let cake = minted(
        await agent.tool('graph_apply', {
          change: [{
            entity: { eid: '$cake' },
            // A brand-new entity wearing nothing but shared words has no home
            // to go to, and this person has two apps: `$app` says which
            // (T-33812), where the tool's own argument used to.
            $app: 'recipes',
            doc: { title: "Grandma's lemon cake" },
          }],
        }),
        '$cake',
      )
      assert(cake, 'the batch says what it named its new entity')
      let [hit] = JSON.parse(
        await agent.tool('graph_query', { q: `id=${cake}` }),
      )
      assertEquals(hit.entity.eid, cake)
      assertEquals(hit.doc.title, "Grandma's lemon cake")
      // A listing is what the person saved: the store's stamps about saving
      // it are not in the answer unless the filter names one.
      assert(!('created' in hit), 'no stamp rides an unasked-for listing')
      let stamped = JSON.parse(
        await agent.tool('graph_query', { q: '.doc!&.created!' }),
      )
      assertEquals(stamped.length, 1)
      assert(stamped[0].created, 'naming a stamp asks for it back')

      // A seed that tried to date itself: `created.at` is the store's own
      // record of when it first saw a row and cannot be given a past moment,
      // so it is dropped and the row reads as written now (T-33147).
      let old = minted(
        await agent.tool('graph_apply', {
          change: [{
            entity: { eid: '$old' },
            $app: 'recipes',
            doc: { title: 'Written in April' },
            created: { at: '2026-04-11T12:00:00Z' },
          }],
        }),
        '$old',
      )
      let [aged] = JSON.parse(
        await agent.tool('graph_query', { q: `id=${old}&.created!` }),
      ) as { created: { at: string } }[]
      assertEquals(
        aged.created.at.slice(0, 4),
        String(new Date().getFullYear()),
      )
      await agent.tool('graph_apply', {
        change: [{ entity: { eid: old }, tombstone: {} }],
      })
      let found = JSON.parse(await agent.tool('search', { words: 'lemon' }))
      assertEquals(
        found.map((r: { entity: { eid: string } }) => r.entity.eid),
        [cake],
      )

      // A NAME outlives the batch (T-34390, @yaks/key + @yaks/alias): the same
      // seed written again patches the entity that already holds the name
      // instead of writing a second one, and the name stands where an eid
      // does.
      let seeding = (title: string) =>
        agent.tool('graph_apply', {
          change: [{
            entity: { eid: '$r' },
            $app: 'recipes',
            alias: { name: 'recipe:lemon-cakes' },
            doc: { title },
          }],
        })
      let once = minted(await seeding('Lemon cakes'), '$r')
      assertEquals(minted(await seeding('Lemon cakes, better'), '$r'), once)
      let cakes = JSON.parse(
        await agent.tool('graph_query', { q: '.doc.title~="Lemon cakes"' }),
      ) as { entity: { eid: string } }[]
      assertEquals(cakes.map((b) => b.entity.eid), [once])
      // and the name stands where an eid does, on the line and at the door
      let byName = JSON.parse(
        await agent.tool('graph_query', { q: 'id=recipe:lemon-cakes' }),
      ) as { entity: { eid: string } }[]
      assertEquals(byName.map((b) => b.entity.eid), [once])
      let shown = JSON.parse(
        await agent.tool('graph_show', {
          ids: ['recipe:lemon-cakes'],
          backrefs: false,
        }),
      ) as { bundles: { entity: { eid: string } }[] }
      assertEquals(shown.bundles.map((b) => b.entity.eid), [once])
      // and it goes when the entity does — the name is released, not
      // tombstoned, so it could be claimed again (what the rest of this test
      // counts is the app's own rows, and this one was ours).
      await agent.tool('graph_apply', {
        change: [{ entity: { eid: once }, tombstone: {} }],
      })
      assertEquals(
        JSON.parse(
          await agent.tool('graph_query', { q: 'id=recipe:lemon-cakes' }),
        ),
        [],
      )
      // The app's OWN components: vocab.json declares them, app_deploy plants
      // them in this app's store, and nothing about them exists in any other.
      // Both doors teach the same missing act, with no other graph's ids in
      // the sentence.
      for (
        let ask of [
          () =>
            agent.tool('graph_apply', {
              change: [{
                entity: { eid: '$r' },
                $app: 'recipes',
                recipe: { serves: 4 },
              }],
            }),
          () => agent.tool('graph_query', { q: '.recipe!' }),
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
      let box = minted(
        await agent.tool('graph_apply', {
          change: [{
            entity: { eid: '$pancakes' },
            doc: { title: 'Pancakes' },
            recipe: { title: 'Pancakes', serves: 4 },
          }],
        }),
        '$pancakes',
      )
      let [own] = JSON.parse(
        await agent.tool('graph_query', { q: '.recipe.serves=4' }),
      )
      assertEquals(own.entity.eid, box)
      assertEquals(own.recipe, { title: 'Pancakes', serves: 4 })
      // A column the manifest never named is still a typo, not a new word.
      // The write schema DESCRIBES the vocabulary (T-34153) and stays open, so
      // a client's cached copy cannot refuse a word deployed since it
      // connected (T-34277) — the SERVER refuses this, naming the column, the
      // columns that do exist, and where to read them.
      let typo = (await assertRejects(
        () =>
          agent.tool('graph_apply', {
            change: [{ entity: { eid: box }, recipe: { calories: 500 } }],
          }),
        Error,
      )).message
      assertStringIncludes(typo, 'unknown column: recipe.calories')
      assertStringIncludes(typo, 'recipe declares title, serves')
      assertStringIncludes(typo, 'graph_schema')

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
            change: [{
              entity: { eid: '$d' },
              $app: 'recipes',
              dayline: { on: 'today' },
            }],
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
            change: [{
              entity: { eid: '$j' },
              $app: 'recipes',
              jot: { text: 'hi' },
            }],
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
            q: '.recipe.serves=4',
          }),
        ).length,
        1,
      )

      // A RENAMED column is two columns: the new spelling arrives, the old
      // one keeps every row already written under it, and the deploy says
      // both — the manifest reads as one word and the store answers two.
      await agent.tool('graph_apply', {
        change: [{ entity: { eid: '$n' }, note: { text: 'wrote it' } }],
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
        change: [{ entity: { eid: '$n2' }, note: { body: 'said it' } }],
      })
      let notes = JSON.parse(
        await agent.tool('graph_query', { q: '.note!' }),
      ) as { note: { text: string | null; body: string | null } }[]
      assertEquals(notes.map((n) => n.note), [
        { text: 'wrote it', body: null },
        { text: null, body: 'said it' },
      ])

      // And the same manifest written the OTHER way (M-34605): a `vocab.yml`
      // beside index.html is the app's words in the warm spelling, read
      // through the one loader (@yaks/yaml) and preferred over the `.json`
      // when an app has both, so the two files are never both in force.
      await agent.tool('app_files', {
        ...app,
        op: 'write',
        path: 'vocab.yml',
        content: 'recipe:\n  title: text\n  serves: number\nsticker:\n' +
          '  colour: text\n',
      })
      let inYaml = await agent.tool('app_deploy', app)
      assertStringIncludes(inYaml, 'components: recipe, note, sticker')
      assertStringIncludes(inYaml, 'added: sticker.colour')
      // And every sentence about the manifest names the file the app wrote,
      // not the spelling this platform happens to have started with.
      assertStringIncludes(inYaml, 'kept, not in vocab.yml')
      await agent.tool('graph_apply', {
        change: [{ entity: { eid: '$s' }, sticker: { colour: 'red' } }],
      })
      assertEquals(
        JSON.parse(
          await agent.tool('graph_query', { q: '.sticker.colour=red' }),
        )
          .length,
        1,
      )

      // A refused store answer is the tool's error, not a 500.
      await assertRejects(
        () => agent.tool('graph_query', { q: 'work=build' }),
        Error,
        'work lanes',
      )

      // A break in the app reaches the agent on its next reply, once; after
      // that only app_errors lists it, and a fresh break rides again. It is a
      // PAGE's break because that is what an app's break is: the platform's
      // own failures are the platform's, whatever app the URL named
      // (T-33234, report_test.ts).
      let dies = (said: string) =>
        k.at('jeff.yaks.app', '/recipes/api/report', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: said,
            url: 'https://jeff.yaks.app/recipes/',
          }),
        })
      assertEquals((await dies('sift is not a function')).status, 204)
      // It rides on a PLATFORM tool's answer, which is prose a person's agent
      // reads; the generic tier answers a described value, and a section of
      // words appended to it would be something else (T-33812).
      let told = await agent.tool('app_files', { ...app, op: 'list' })
      assertMatch(
        told,
        /## unseen errors\n- \S+ \S+ exception recipes v\d+: page \/recipes\/ — sift is not a function/,
      )
      // A crash is the platform's row, not the person's: `.doc!` — the query
      // the instructions teach as everything they saved — has only the cake
      // (T-32533, C-32531 item 1).
      assertEquals(
        JSON.parse(await agent.tool('graph_query', { q: '.doc!' }))
          .map((r: { doc: { title: string } }) => r.doc.title),
        ["Grandma's lemon cake", 'Pancakes'],
      )
      let quiet = await agent.tool('app_files', { ...app, op: 'list' })
      assert(!quiet.includes('unseen'), 'served once')
      assertEquals((await dies('knead is not a function')).status, 204)
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
        await agent.tool('graph_query', { q: '.created!' }),
      ) as { exception?: unknown }[]
      assert(stamps.length > 0, 'the person has rows')
      assert(stamps.every((r) => !r.exception), 'no break rides a stamps list')
      assertEquals(
        JSON.parse(
          await agent.tool('graph_query', { q: '.exception!' }),
        ).length,
        2,
      )
      assert(
        !(await agent.tool('app_files', { ...app, op: 'list' }))
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
      // times. A break whose report carried no stack has no address to open,
      // so it wears its request instead.
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
          'fold is not a function @ /recipes/cook.js:7 x1',
          'knead is not a function @ page /recipes/ x1',
          'sift is not a function @ page /recipes/ x1',
          'whisk is not a function @ /recipes/index.html:42 x1',
        ],
      )
      // v7: two files, a vocabulary, the word it dropped, the column it
      // renamed, the same words written again as YAML — every deploy above
      // bumped it, and a break wears the version it happened on.
      assert(breaks.every((b) => b.version == 7), 'the deploy it happened on')

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
        'css/site.css\nindex.html\nvocab.json\nvocab.yml',
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
      // Its garden went to the trash a moment ago, so the space has no apps
      // and one thing in the trash — with the days it has to change its mind
      // (erase.ts, T-34430).
      assertEquals(
        (await agent.tool('app_list', { space: 'jeff-work' })).split('\n'),
        [
          'jeff-work — https://jeff-work.yaks.app/',
          '- no apps yet',
          'Trash — app_restore brings one back; erased for good when its ' +
          'days run out',
          '- Work garden (garden), 30 days left',
        ],
      )

      // Thrown away for good: an app made, written, deployed, then erased
      // whole — its address stops answering, the listing forgets it, and an
      // app made at the same address afterwards starts with nothing, because
      // the store it was born naming was emptied with it (T-32562). `forever`
      // is what skips the trash; the trash itself is its own test below
      // (T-34430).
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
        await agent.tool('app_delete', { ...scratch, forever: true }),
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
      // The generic tier reads every app at once, so what proves the store
      // was emptied is that what it held is gone — not that the reach is.
      assertEquals(
        JSON.parse(
          await agent.tool('graph_query', { q: '.doc.title~=secret' }),
        ),
        [],
      )
      await agent.tool('app_delete', { ...scratch, forever: true })

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
      // And the generic tier is HIS reach and nobody else's: jeff's rows are
      // not in it, whatever he asks for.
      assertEquals(
        JSON.parse(await stranger.tool('graph_query', { q: '.doc!' })),
        [],
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
