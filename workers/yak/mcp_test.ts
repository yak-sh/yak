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
// A client's own reading of the published schema: the tool list is JSON
// Schema, so what proves it describes a batch is a JSON Schema validator.
import { Ajv } from 'ajv'
import { slow, until } from '../../src/testing.ts'
import { COOKIE, sign } from '../../src/token.ts'
import {
  arrives,
  client,
  connector,
  kernel,
  letter,
  letters,
  meta,
  rfc822,
  seed,
  signedIn,
  signIn,
} from './probe.ts'
import { monthOf } from './meter.ts'
import { PAGES, uriOf } from './guide.ts'
import { PROMPTS } from './prompts.ts'
import { sha256 } from './versions.ts'
import { VERSION } from '../../src/version.ts'

// The connector's face, on BOTH doors (T-34415): the same name, line and
// square picture whether the caller has signed in or not, because a directory
// reviewer and a connector form both read it before any grant exists. Pinned
// as literals here rather than compared against seo.ts CONNECTOR — a test that
// reads the constant it is checking proves only that the constant is itself.
let facing = (info: Record<string, unknown>) => {
  assertEquals(info.name, 'yaks.app')
  assertEquals(info.title, 'yaks.app')
  assertEquals(
    info.description,
    'Apps your assistant builds for you, at your own address.',
  )
  assertEquals(info.websiteUrl, 'https://yaks.app')
  assertEquals(info.icons, [
    {
      src: 'https://yaks.app/connector.svg',
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
    {
      src: 'https://yaks.app/connector-512.png',
      mimeType: 'image/png',
      sizes: ['512x512'],
    },
  ])
}

// The eid a batch minted under an alias, read off the batch AS APPLIED
// (T-33812): graph_apply answers every entity the write touched, each carrying
// the `$alias` the batch called it by.
let minted = (applied: string, alias: string) =>
  (JSON.parse(applied) as { entity: { eid: string }; $alias?: string }[])
    .find((b) => b.$alias == alias)!.entity.eid

// What a client says when it opens the connection. The protocol machine is the
// SDK's now (T-33812) and it holds a client to the spec's own shape, which
// every client sends and only a test would leave out.
let HELLO = {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'probe', version: '0' },
}

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
      await assertRejects(() => connector(k).call('prompts/list'), Error, '401')
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
        'space_delete',
        'space_restore',
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
        'app_set',
        'app_secret_set',
        'app_secret_list',
        'app_secret_remove',
        'app_delete',
        'app_restore',
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
        // The token that signs a terminal in (grants.ts, T-34385).
        'grant',
        'feedback',
        // The guide itself, so nothing has to be fetched off the web
        // (T-34284).
        'guide',
        // The one anybody may call, signed in or not (preauth.ts, T-33030).
        'about',
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
      // Neither view sits on "Looking…" when no answer ever arrives: the
      // tool's own sentence is the whole answer, and the view says so.
      for (let page of [drawn.text, cards.text]) {
        assertStringIncludes(page, 'The answer is in the reply.')
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
    assertEquals(listed.map((t) => t.name), ['about'])
    // It wears the same title and hints signed in and out (tools.ts lifts it
    // from preauth.ts): this is the list a directory reviewer sees first, and
    // a bare entry here reads as a door with no annotations at all.
    assertEquals(listed[0].title, 'What yaks.app is')
    assertEquals(listed[0].annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
    // And it says out loud that it needs nobody to sign in (T-34349): a host
    // reads a mixed-auth server one tool at a time, so an open tool that
    // declares no scheme is a tool it will not offer.
    assertEquals(listed[0]._meta?.securitySchemes, [{ type: 'noauth' }])
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

    // Signing in adds; it never swaps one surface for another. Every public
    // tool is in the full list, saying the same words, and every public
    // resource is still listed.
    let fullSchemes = await schemes(agent)
    let full = Object.keys(fullSchemes)
    let open = listed.map((t) => t.name)
    // Every tool says how it is reached, and `about` says the same thing on
    // both lists — one tool cannot need signing in on one and not the other.
    // The scope is the one our resource metadata names (identity.ts).
    assertEquals(fullSchemes.about, [{ type: 'noauth' }])
    for (let name of full.filter((n) => n != 'about')) {
      assertEquals(fullSchemes[name], [{
        type: 'oauth2',
        scopes: ['graph'],
      }], name)
    }
    // An app's own tool is listed by the same rule, view and all.
    assert(full.includes('runs__leaderboard'))
    assert(open.every((n) => full.includes(n)), 'the public list is a subset')
    assert(full.length > open.length, 'signing in has to be worth something')
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
    // The other half a plugin shipping UI owes a host (T-34350): the sandbox
    // origin, which is the SPACE's own site — so one person's app view never
    // shares an origin with another's — said in both spellings, on the
    // listing and on the bytes.
    for (let said of [listed, page]) {
      assertEquals(said._meta.ui.domain, `https://${space}.yaks.app`)
      assertEquals(
        said._meta['openai/widgetDomain'],
        `https://${space}.yaks.app`,
      )
      assertEquals(said._meta['openai/widgetCSP'].resource_domains, [
        `https://${space}.yaks.app`,
      ])
    }
    // A page nobody declared, and an app nobody has: the same answer.
    for (
      let missing of [`ui://${space}/runs/secret.html`, 'ui://no/runs/x.html']
    ) {
      await assertRejects(
        () => agent.call('resources/read', { uri: missing }),
        Error,
        'not found',
      )
    }

    // The call is a page's gesture: the row lands in the app's own store,
    // typed by the declared input, and says who wrote it.
    let wrote = await agent.tool('runs__log_run', { who: 'Ada', miles: 5 })
    assertStringIncludes(wrote, 'runs__log_run: wrote 1 entity')
    type Run = {
      jog: { who: string; miles: number }
      created: { by: { eid: string; name: string } }
    }
    let rows = JSON.parse(
      await agent.tool('graph_query', { q: '.jog!&.created!' }),
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
    // An argument the input declared and the call left out is refused by the
    // input itself, naming the argument, and no half-written row lands: the
    // declared schema is the door's now (T-33812).
    let short = await assertRejects(
      () => agent.tool('runs__log_run', { who: 'Ada' }),
      Error,
    )
    assertStringIncludes(short.message, 'runs__log_run')
    assertStringIncludes(short.message, 'miles')
    // A tool nobody declared is a tool nobody has.
    await assertRejects(
      () => agent.tool('runs__nope', {}),
      Error,
      'runs__nope not found',
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
    let init = await club.agent.call('initialize', HELLO)
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

// And the schema DOOR (T-34156). Jeff: "can we otherwise add some vocab tools?
// for getting specific parts and also the full thing probably? should come
// with docs, i expect, to explain the meaning". Three sizes over the caller's
// own words: the index, one component whole, and a kind.
slow('graph_schema answers the index, a word whole, and a kind', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    await agent.tool('app_new', { slug: 'cookbook', title: 'Cookbook' })
    await agent.tool('app_files', {
      app: 'cookbook',
      op: 'write',
      path: 'vocab.json',
      content: JSON.stringify({ recipe: { serves: 'number' } }),
    })
    await agent.tool('app_deploy', { app: 'cookbook' })
    type Word = {
      name: string
      description?: string
      kind: boolean
      columns: (string | { prop: string; type: string; description?: string })[]
      worn_with?: string[]
      references?: { out: unknown[]; in: { comp: string; prop: string }[] }
      example?: Record<string, Record<string, unknown>>
      guide?: string
    }
    let said = async (args: Record<string, unknown>) =>
      JSON.parse(await agent.tool('graph_schema', args)) as {
        comps: Word[]
        kinds?: string[]
        kind?: string
      }

    // The index: every word the caller can reach, its line, its columns — the
    // app's own word among the platform's.
    let index = await said({})
    let names = index.comps.map((c) => c.name)
    assert(names.includes('recipe'), 'the app own word is in the index')
    assert(names.includes('mail'))
    assertEquals(
      index.comps.find((c) => c.name == 'doc')!.columns,
      ['title', 'body'],
    )
    assert(index.kinds!.includes('recipe'))

    // One word whole: the meaning its vocab.json carries, every column typed
    // and described, what points at it, a bundle that writes it, and the page
    // that covers it.
    let [mail] = (await said({ component: 'mail' })).comps
    assertStringIncludes(mail.description!, 'envelope')
    let verified = mail.columns.find((c) =>
      typeof c != 'string' && c.prop == 'verified'
    ) as { type: string; description: string }
    assertEquals(verified.type, 'bool')
    assertStringIncludes(verified.description, 'DKIM')
    assertEquals(mail.guide, 'https://yaks.app/guide/mail.md')
    assertEquals(mail.worn_with, ['doc'])
    assertEquals(Object.keys(mail.example!.mail).includes('from'), true)
    // What points AT a letter, from anywhere in reach: its own `reply_to`,
    // which is how a thread hangs together.
    assertEquals(
      mail.references!.in.some((r) => r.comp == 'mail' && r.prop == 'reply_to'),
      true,
      JSON.stringify(mail.references),
    )

    // A kind is what an entity of it is made of: the word itself, then a line
    // for each word it is worn with.
    let letter = await said({ kind: 'mail' })
    assertEquals(letter.kind, 'mail')
    assertEquals(letter.comps.map((c) => c.name), ['mail', 'doc'])

    // And a word nobody declared is a refusal that says where to look.
    let missing = (await assertRejects(
      () => agent.tool('graph_schema', { component: 'recipy' }),
      Error,
    )).message
    assertStringIncludes(missing, "no component 'recipy'")
    assertStringIncludes(missing, 'index')
  } finally {
    await k.stop()
  }
})

// The WRITE door's schema is the caller's vocabulary (T-34153). Jeff, on an
// agent trying to send a letter with graph_apply: "how are agents supposed to
// learn our comp schema? claude was trying to send mail ... but is just
// guessing at the comp types". So the published input schema is checked here
// the way a client checks it — with a JSON Schema validator, against the
// letter bundle the guide teaches (public/guide/mail.md §Sending a letter).
slow(
  "graph_apply's input schema is the vocabulary a client can write",
  async () => {
    let k = await kernel()
    let ear: ReturnType<typeof hearing> | undefined
    try {
      let jeff = await signIn(k)
      let agent = connector(k, jeff.cookie)
      let apps = ['cookbook', 'lending', 'runs']
      for (let slug of apps) {
        await agent.tool('app_new', { slug, title: slug })
      }
      let schema = async () => {
        let { tools } = await agent.call('tools/list')
        let one = (tools as { name: string; inputSchema: object }[])
          .find((t) => t.name == 'graph_apply')!
        return {
          input: one.inputSchema,
          // What a tool list COSTS the agent that reads it, before it has asked
          // anything: the number worth watching when the schema grows.
          bytes: JSON.stringify(tools).length,
        }
      }
      let first = await schema()
      let ajv = new Ajv({ strict: false })
      let takes = (input: object, change: unknown) =>
        ajv.compile(input)({ change })

      // The guide's own letter: a recipient wearing `email{address}`, the letter
      // as `doc` + `mail`, and the ask, `deliver{to}`.
      let sending = [
        { entity: { eid: '$ana' }, email: { address: 'ana@example.com' } },
        {
          entity: { eid: '$note' },
          doc: { title: 'Your order is on its way', body: 'Two jars.' },
          mail: {},
          deliver: { to: '$ana' },
        },
      ]
      assert(takes(first.input, sending), JSON.stringify(ajv.errors))
      // A column nobody declared is NOT refused by the schema (T-34277): a
      // client holds this copy for the whole conversation while the vocabulary
      // grows under it, so a closed schema would refuse a column that exists.
      // The schema describes; the server decides, and says which columns are
      // declared and where to read them.
      let misspelt = [{
        entity: { eid: '$ana' },
        $app: 'cookbook',
        email: { adress: 'ana@example.com' },
      }]
      assertEquals(takes(first.input, misspelt), true)
      let refused = (await assertRejects(
        () => agent.tool('graph_apply', { change: misspelt }),
        Error,
      )).message
      assertStringIncludes(refused, 'unknown column: email.adress')
      assertStringIncludes(refused, 'email declares address')
      assertStringIncludes(refused, 'graph_schema')
      // And the type is there to be read: `mail.verified` is a boolean, and the
      // vocabulary's own sentence about it rides along.
      let mail = JSON.stringify(
        (first.input as { properties: Record<string, unknown> }).properties,
      )
      assertStringIncludes(mail, 'the address it came from')
      assertEquals(
        takes(first.input, [{
          entity: { eid: 'e1' },
          mail: { verified: 'yes' },
        }]),
        false,
      )

      // A vocabulary GROWS mid-connection, and the schema a client is holding
      // goes stale with it: app_deploy plants the words, so the door says the
      // tool list moved and a client re-reads it.
      let stream = await k.at('yaks.app', '/mcp', {
        headers: { cookie: jeff.cookie, accept: 'text/event-stream' },
      })
      ear = hearing(stream)
      await until(() => ear!.said().includes(': open'), {
        timeout: 10_000,
        poll: 50,
        label: 'the stream to open',
      })
      await agent.tool('app_files', {
        app: 'cookbook',
        op: 'write',
        path: 'vocab.json',
        content: JSON.stringify({ recipe: { serves: 'number' } }),
      })
      await agent.tool('app_deploy', { app: 'cookbook' })
      await until(
        () => ear!.said().includes('notifications/tools/list_changed'),
        {
          timeout: 10_000,
          poll: 50,
          label: 'the tool list to be called stale',
        },
      )
      let grown = await schema()
      assert(
        takes(grown.input, [{ entity: { eid: 'r1' }, recipe: { serves: 4 } }]),
      )
      assertEquals(
        takes(grown.input, [{
          entity: { eid: 'r1' },
          recipe: { serves: 'four' },
        }]),
        false,
      )
      // The stale schema is why the announcement matters: it typed nothing
      // about a word nobody had declared yet, so a client holding it would have
      // sent `serves` as anything at all and learned from a refusal instead.
      assertEquals(
        takes(first.input, [{
          entity: { eid: 'r1' },
          recipe: { serves: 'four' },
        }]),
        true,
      )
      console.log(
        `tools/list: ${first.bytes} bytes over ${apps.length} apps, ` +
          `${grown.bytes} with a component of their own`,
      )
    } finally {
      await ear?.stop()
      await k.stop()
    }
  },
)

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

// The ROSTER (T-34277). Jeff: "is there anything else we can do about claude
// having stale mcp tools?" A client lists the tools once and holds that list;
// `notifications/tools/list_changed` reaches one holding a stream and willing
// to act on it, and nobody else. So the server says it again where the agent
// is certainly reading — on the next result, naming what moved — and `about`
// is the one call that says what is here right now.
slow(
  'a stale tool list is named on the next result, and about says it',
  async () => {
    let k = await kernel()
    try {
      let jeff = await signIn(k)
      let agent = connector(k, jeff.cookie)
      // The list this client caches, recorded against the session id the
      // transport just minted for it (probe.ts sends it back from here on).
      await agent.call('initialize', HELLO)
      let first = await agent.tool('about')
      let version = /roster ([0-9a-f]{8})/.exec(first)![1]
      assertStringIncludes(first, 'graph_apply')
      assertEquals(first.includes('runs__log_run'), false)

      // An app of his own declares a tool, and the deploy plants it: the roster
      // moved under a client that listed a minute ago.
      let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
        .exec(
          await agent.tool('app_new', { slug: 'runs', title: 'Run club' }),
        )![1]
      await agent.tool('app_files', {
        space,
        app: 'runs',
        files: [
          { path: 'vocab.json', content: '{"jog":{"miles":"number"}}' },
          {
            path: 'tools.json',
            content: JSON.stringify({
              log_run: {
                description: 'Log a run',
                input: { miles: 'number' },
                apply: { jog: { miles: '{{miles}}' } },
              },
            }),
          },
        ],
      })
      await agent.tool('app_deploy', { space, app: 'runs' })

      // The very next reply says so, naming the tool — as its own block, so the
      // answer above it is still the answer.
      let told = await agent.call('tools/call', {
        name: 'app_list',
        arguments: {},
      })
      let blocks = told.content as { text: string }[]
      assertEquals(blocks.length, 2)
      assertEquals(
        blocks[1].text,
        'The tool list changed since you connected (new: runs__log_run). ' +
          'Reconnect to see them, or ask `about`.',
      )
      // Once per changed set: the next reply is quiet again.
      let quiet = await agent.call('tools/call', {
        name: 'app_list',
        arguments: {},
      })
      assertEquals((quiet.content as unknown[]).length, 1)

      // And `about` is the call that settles it without reconnecting: the new
      // tool, and a version that moved with it.
      let now = await agent.tool('about')
      assertStringIncludes(now, 'runs__log_run')
      assert(
        !now.includes(`roster ${version}`),
        'the version moved with the list',
      )
    } finally {
      await k.stop()
    }
  },
)

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
      let init = await agent.call('initialize', HELLO)
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
      let told = await agent.tool('app_files', {
        space: 'jeff',
        app: 'recipes',
        op: 'list',
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
      entities: [{
        entity: { eid: '$pancakes' },
        doc: { title: 'Pancakes' },
        recipe: { serves: 2 },
      }],
    })
    await agent.tool('graph_apply', {
      app: 'lending',
      entities: [
        { entity: { eid: cake }, loan: { to: 'Maya' } },
        {
          entity: { eid: '$zester' },
          doc: { title: 'Lemon zester' },
          loan: { to: 'Bo' },
        },
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
    // store mints for its writer wears a title too (graph.ts `#vouching`), and
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
    ) as { doc: { title: string }; recipe?: { serves: number } }[]
    assertEquals(
      found.map((r) => r.doc.title).sort(),
      ['Lemon cake', 'Lemon zester'],
    )
    // And a hit carries the app's OWN components, not a doc and a rank
    // alone: a word names nothing to leave out, so a page drawing cards from
    // a search has what to draw (T-33144).
    assertEquals(
      found.find((r) => r.doc.title == 'Lemon cake')?.recipe?.serves,
      4,
    )
    // A bare word is a text pred in the query grammar, so narrowing a search
    // is graph_query with the words in the line — and the ordinary rule about
    // which components an answer carries is back with it.
    let narrowed = JSON.parse(
      await agent.tool('graph_query', { q: 'lemon&.recipe!' }),
    ) as { doc?: { title: string }; recipe: { serves: number } }[]
    assertEquals(narrowed.map((r) => r.recipe.serves), [4])
    assertEquals(narrowed.map((r) => r.doc), [undefined])

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
    let cake = minted(said, '$cake')
    assertEquals((await rows('.doc!', 'recipes')).map((r) => r.entity.eid), [
      cake,
    ])
    assertEquals((await rows('.doc!', 'lending')).length, 0)

    // ONE bundle wearing two apps' words: the loan is the lending app's row,
    // the retitle lands where the title already lives, and the call is one.
    let spans = JSON.parse(
      await agent.tool('graph_apply', {
        entities: [{
          entity: { eid: cake },
          doc: { title: 'Lemon drizzle' },
          loan: { to: 'Maya' },
        }],
      }),
    ) as {
      entity: { eid: string }
      doc?: { title: string }
      loan?: { to: string }
      $actor?: unknown
    }[]
    // And ONE bundle back, though two stores each answered their own half
    // (T-34294) — with none of the `$` words the pipeline speaks in.
    assertEquals(spans.length, 1)
    assertEquals(spans[0].entity.eid, cake)
    assertEquals(spans[0].doc!.title, 'Lemon drizzle')
    assertEquals(spans[0].loan!.to, 'Maya')
    assertEquals(spans[0].$actor, undefined)
    // Where each half landed is what the stores themselves say.
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
            entity: { eid: '$zester' },
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
        meter: spent,
      },
      {
        entity: { eid: eids.metered },
        plan: { tier: 'free' },
        meter: spent,
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
    // off the store itself (graph.ts `/graph`), which is where the sweep
    // reads it, so a planted store already weighs something.
    let graph = await k.at('metered.yaks.app', '/recipes/api/graph', {
      headers: { cookie },
    })
    assert((await graph.json()).bytes > 0, 'the store says what it weighs')

    // Where the space stands against what it is allowed (T-32758), in the
    // same answer: nothing here is near a ceiling, so it is only the numbers.
    assertStringIncludes(said, 'metered (free tier')
    assertStringIncludes(said, '1 of 5 apps')

    // And the other address every app has (T-34149), in the words and in the
    // rows: nobody should have to derive a mailbox from a slug.
    assertStringIncludes(said, 'metered.recipes@yaks.app')
    let listing = await agent.call('tools/call', {
      name: 'app_list',
      arguments: { space: 'metered' },
    })
    assertEquals(
      listing.structuredContent.spaces[0].apps[0].mail,
      'metered.recipes@yaks.app',
    )
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
    // And where the ceiling lifts: the pricing page, never a checkout link
    // (usage.ts `atCeiling`).
    await assertRejects(
      () => agent.tool('app_new', { space: 'brim', slug: 'a6', title: 'A6' }),
      Error,
      'Plus lifts it: https://yaks.app/pricing',
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
    let piranesi = minted(said, '$b')
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

    // A deploy does NOT move the offer: publishing is the owner's act and
    // pins what strangers install. Silence about that is what left the
    // guestbook offering v1 while v2 served (T-33146), so the deploy that
    // leaves the offer trailing says so at the door.
    let bumped = await agent.tool('app_deploy', { space: mine, app: 'recipes' })
    assertStringIncludes(bumped, 'offered as recipes is still v1')
    assertStringIncludes(bumped, 'app_publish again to offer this one')
    assertStringIncludes(await agent.tool('app_published'), '- recipes v1')
    // And app_versions marks which one is on offer beside which is live.
    let marks = await agent.tool('app_versions', {
      space: mine,
      app: 'recipes',
    })
    assertStringIncludes(marks, '- v2 (live)')
    assertStringIncludes(marks, '- v1 (offered)')

    // Publishing the same app again is not a second offer: it moves the
    // version on the one that stands, and keeps the line already said.
    assertStringIncludes(
      await agent.tool('app_publish', { space: mine, app: 'recipes' }),
      'published recipes v2',
    )
    assertStringIncludes(
      await agent.tool('app_versions', { space: mine, app: 'recipes' }),
      '- v2 (live) (offered)',
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
          entity: { eid: '$deploy' },
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
      return r.status == 200 ? (await r.json()).db : r.status
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
      return r.status == 200 ? (await r.json()).db : r.status
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
    let listed = async () =>
      ((await agent.call('tools/list')).tools as { name: string }[])
        .map((t) => t.name)
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
    assert((await listed()).includes('notes__log_note'))

    // In. Everything that names the app stops naming it: the web, the tool
    // list, and the listing — where it is under Trash instead, with its days.
    assertStringIncludes(
      await agent.tool('app_delete', at),
      'binlab/notes is in the trash',
    )
    assertEquals((await page()).status, 404)
    assertEquals((await listed()).includes('notes__log_note'), false)
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
    assert((await listed()).includes('notes__log_note'))
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
        ((await agent.call('tools/list')).tools as { name: string }[])
          .map((t) => t.name)
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
      assert((await listed()).includes('notes__log_note'))
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
      assertEquals((await listed()).includes('notes__log_note'), false)
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
      assert((await listed()).includes('notes__log_note'))
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
    // The SAME letter is addressed to the fleet's graph inbox as well, so it
    // lands in `task inbox` instead of waiting on a person to relay it. One
    // send, two readers: the graph copy is the letter, not a summary of it.
    assertEquals(sent.to, ['hello@yaks.app', 'task@bot.yak.sh'])
    assertEquals(await letter(k, 'task@bot.yak.sh', 'app_rename'), sent)

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

// The funnel (T-33142): somebody invited into a space before they have ever
// signed in still gets a space of their OWN, and every tool that defaults to
// "theirs" aims at it. Belonging to the inviter's space is not having one —
// while it was, an invited person's first app_install aimed at the
// PUBLISHER's space and was refused there by the publisher's own app ceiling.
slow('an invited person gets a space of their own', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let his = connector(k, jeff.cookie)
    let mine = jeff.email.split('@')[0]
    await his.tool('app_new', { slug: 'recipes', title: 'Recipes' })
    await his.tool('app_files', {
      app: 'recipes',
      op: 'write',
      path: 'index.html',
      content: '<h1>Recipes</h1>',
    })
    await his.tool('app_deploy', { app: 'recipes' })
    await his.tool('app_publish', { app: 'recipes', name: 'recipe-box' })

    // Invited FIRST, signed in after: the order a new person arrives in.
    let ana = `ana-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    let hers = ana.split('@')[0]
    await his.tool('member_add', { email: ana, role: 'editor' })
    let agent = connector(k, (await signIn(k, ana)).cookie)

    // She belongs to his and owns hers.
    let listed = await agent.tool('app_list')
    assertStringIncludes(listed, `${hers}.yaks.app`)
    assertStringIncludes(listed, `${mine}.yaks.app`)

    // Naming the app is still naming the space, so the app she was invited
    // to needs no address.
    assertStringIncludes(
      await agent.tool('app_files', { app: 'recipes', op: 'list' }),
      'index.html',
    )

    // And what she makes lands in HERS.
    assertStringIncludes(
      await agent.tool('app_install', { name: 'recipe-box', as: 'cooking' }),
      `as ${hers}/cooking`,
    )
    assertStringIncludes(
      await agent.tool('app_new', { slug: 'notes', title: 'Notes' }),
      `${hers}.yaks.app/notes/`,
    )
  } finally {
    await k.stop()
  }
})

// The five things four separate builders each had to guess at (T-33145), each
// held here as well as written in the guide, so a guide sentence that stops
// being true fails rather than misleads: what a `time` column takes, filtering
// a column that holds an eid, what an unwritten column reads back as, and
// `task.status` before either mark.
slow('the answers four builders had to guess at', async () => {
  let k = await kernel()
  try {
    let them = await signIn(k)
    let agent = connector(k, them.cookie)
    await agent.tool('app_new', { slug: 'diary', title: 'Diary' })
    await agent.tool('app_files', {
      app: 'diary',
      op: 'write',
      path: 'vocab.json',
      content: '{"dayline":{"written":"time","mood":"text",' +
        '"pages":"number","aloud":"bool"}}',
    })
    await agent.tool('app_deploy', { app: 'diary' })
    let rows = async (filter: string) =>
      JSON.parse(
        await agent.tool('graph_query', { app: 'diary', filter }),
      ) as {
        entity: { eid: string }
        doc?: { title: string; body: string | null }
        dayline?: {
          written: string
          mood: string
          pages: number
          aloud: boolean
        }
        task?: { status: string; priority: number }
      }[]

    // A `time` column takes an ISO 8601 string with a zone, and gives it back
    // byte for byte. Noon UTC for a plain DATE is the trap: midnight renders
    // as the day before for anyone west of Greenwich.
    let written = await agent.tool('graph_apply', {
      app: 'diary',
      entities: [{
        entity: { eid: '$e' },
        doc: { title: 'Beans in' },
        dayline: { written: '2026-04-11T12:00:00Z' },
      }],
    })
    let entry = minted(written, '$e')
    let [one] = await rows('.dayline!')
    assertEquals(one.dayline!.written, '2026-04-11T12:00:00Z')
    assertEquals(
      new Date(one.dayline!.written).toISOString().slice(0, 10),
      '2026-04-11',
    )
    // Filtering on it is the ordinary comparison.
    assertEquals((await rows('.dayline.written>=2026-04-01')).length, 1)
    assertEquals((await rows('.dayline.written>=2026-05-01')).length, 0)

    // A column nobody wrote is PRESENT and null, not absent, so `in` is the
    // wrong test for "was this written" and the value is the right one.
    assertEquals(
      [one.dayline!.mood, one.dayline!.pages, one.dayline!.aloud],
      [null, null, null],
    )
    assert('mood' in one.dayline!, 'an unwritten column is present, and null')
    assertEquals(one.doc, undefined) // not named by the filter
    // And the platform's own columns are no exception: a doc nobody titled
    // answers null, the same as any column nobody wrote.
    await agent.tool('graph_apply', {
      app: 'diary',
      entities: [{
        entity: { eid: '$grey' },
        dayline: { mood: 'grey' },
        doc: { body: 'Rain again.' },
      }],
    })
    let [untitled] = await rows('.dayline.mood=grey&.doc?')
    assertEquals(untitled.doc!.title, null)
    assertEquals(untitled.dayline!.written, null)

    // A column that holds an eid is filtered by the eid, like any value —
    // `id=` addresses the row itself, which is a different question.
    await agent.tool('graph_apply', {
      app: 'diary',
      entities: [{
        entity: { eid: '$said' },
        comment: { target: entry },
        doc: { body: 'It rained.' },
      }],
    })
    let [said] = await rows(`.comment.target=${entry}`)
    assertEquals(said.entity.eid != entry, true)
    assertEquals((await rows(`.comment.target=${said.entity.eid}`)).length, 0)

    // `task.status` before either mark is `open` — the default, which the
    // two-marks sentence never named.
    await agent.tool('graph_apply', {
      app: 'diary',
      entities: [{ entity: { eid: entry }, task: { priority: 2 } }],
    })
    let [chore] = await rows('.task!')
    assertEquals(chore.task!.status, 'open')
    assertEquals((await rows('.task.status=open')).length, 1)
  } finally {
    await k.stop()
  }
})

// An app's own mailbox at the agent door (T-34149). Mail already rode the
// generic tier — a letter is `doc` + `mail` + `deliver` and `.mail!` reads one
// back — so what is held here is the two things the tools add: the SCOPE, said
// where a model chooses (the block above), and the two verbs answering bundles
// through the doors graph_apply and graph_query already use, guard and all.
type Letter = {
  entity: { eid: string }
  doc: { title: string; body: string }
  mail: { from?: string; to?: string }
  deliver?: { to: string }
  delivered?: { at: string; via: string }
  bounced?: { at: string; reason: string }
}

slow("an app's letters, listed and sent through the connector", async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
    let agent = connector(k, them.cookie)
    // Two letters arrive at the app's address, the way a stranger's does.
    for (
      let [subject, body] of [
        ['Bring a dish', 'Potluck Friday.'],
        ['And a pudding', 'If you have one.'],
      ]
    ) {
      assertEquals(
        (await arrives(k, {
          from: 'ana@books.example',
          to: 'jeff.recipes@yaks.app',
          raw: rfc822({
            From: 'Ana <ana@books.example>',
            To: 'jeff.recipes@yaks.app',
            Subject: subject,
            'Content-Type': 'text/plain; charset="utf-8"',
          }, body),
        })).status,
        200,
      )
    }

    // And the app writes one of its own. The answer is the letter as applied,
    // leaving from the app's own address whatever the tool was handed, and
    // addressed to an ENTITY rather than to a string.
    let sent = JSON.parse(
      await agent.tool('mail_send', {
        app: 'recipes',
        to: 'ana@books.example',
        title: 'Thanks for the pudding',
        body: 'It went in **one** sitting.',
      }),
    ) as Letter
    assertEquals(sent.mail.from, 'jeff.recipes@yaks.app')
    assertEquals(sent.doc.title, 'Thanks for the pudding')
    assert(sent.deliver!.to, 'the letter names a recipient entity')

    // The mailbox, newest first: what it wrote, then the two that arrived.
    let titles = async (args: Record<string, unknown> = {}) =>
      (JSON.parse(
        await agent.tool('mail_list', { app: 'recipes', ...args }),
      ) as Letter[]).map((b) => b.doc.title)
    assertEquals(await titles(), [
      'Thanks for the pudding',
      'And a pudding',
      'Bring a dish',
    ])
    // Each side on its own: the ask to send is the whole distinction.
    assertEquals(await titles({ direction: 'received' }), [
      'And a pudding',
      'Bring a dish',
    ])
    assertEquals(await titles({ direction: 'sent' }), [
      'Thanks for the pudding',
    ])
    let inbox = JSON.parse(
      await agent.tool('mail_list', { app: 'recipes', direction: 'received' }),
    ) as Letter[]
    assertEquals(inbox[0].mail.from, 'ana@books.example')
    assertEquals(inbox[0].mail.to, 'jeff.recipes@yaks.app')
    assert(!inbox[0].deliver, 'an arrival asked nobody to send it')

    // What became of the one that went is a row on that same letter, written
    // back a moment after the tool answered — which is what makes mail_list
    // the way to read it, rather than the send's own reply. What the letter
    // came to rest AS is mail_test.ts's; what is held here is that the tool's
    // own answer names the letter that settled.
    let settled = await until(async () => {
      let [one] = JSON.parse(
        await agent.tool('mail_list', { app: 'recipes', direction: 'sent' }),
      ) as Letter[]
      return one.delivered || one.bounced ? one : null
    }, { timeout: 30_000, poll: 250, label: 'the letter to come to rest' })
    assertEquals(settled!.entity.eid, sent.entity.eid)

    // A DRAFT — a letter kept and never asked for — is neither side: it did
    // not arrive and it has not gone. It is in the whole mailbox and in
    // neither half, which is what the two words mean.
    await agent.tool('graph_apply', {
      app: 'recipes',
      entities: [{
        entity: { eid: '$draft' },
        doc: { title: 'Next month', body: 'Not yet.' },
        mail: {},
      }],
    })
    assert((await titles()).includes('Next month'))
    assert(!(await titles({ direction: 'received' })).includes('Next month'))
    assert(!(await titles({ direction: 'sent' })).includes('Next month'))

    // A second letter to the same address hangs off the recipient the app
    // already has, rather than a second row for one person.
    let again = JSON.parse(
      await agent.tool('mail_send', {
        app: 'recipes',
        to: 'ana@books.example',
        title: 'One more thing',
        body: 'Bring the tin back.',
      }),
    ) as Letter
    assertEquals(again.deliver!.to, sent.deliver!.to)

    // Only a member sends: the platform tier is the space's, and an app that
    // anyone with the link may WRITE is still not an open relay (the letter
    // leaves DKIM-signed as ours). A stranger's own agent is refused, and so
    // is an anonymous batch through the app's own page door — 403, whole, so
    // the letter is not written either.
    await agent.tool('app_set', { app: 'recipes', access: 'open' })
    let stranger = connector(k, (await signIn(k)).cookie)
    await assertRejects(
      () =>
        stranger.tool('mail_send', {
          app: 'recipes',
          space: 'jeff',
          to: 'ana@books.example',
          title: 'Not mine to send',
          body: 'From nobody here.',
        }),
      Error,
      'not a member of jeff',
    )
    let anybody = client(k, 'jeff.yaks.app', 'recipes')
    let relay = await anybody.post({
      entities: [
        { entity: { eid: '$them' }, email: { address: 'ana@books.example' } },
        {
          entity: { eid: '$note' },
          doc: { title: 'Open relay', body: 'Anyone at all.' },
          mail: {},
          deliver: { to: '$them' },
        },
      ],
    })
    // The store answers 403 `Denied`; the page door hands a visitor the
    // refusal and its reason (apps.ts), which is what says the rule held.
    assert(!relay.ok, 'an open app is not an open relay')
    assertStringIncludes(await relay.text(), 'Denied')
    assertEquals(await titles({ direction: 'sent' }), [
      'One more thing',
      'Thanks for the pudding',
    ])
  } finally {
    await k.stop()
  }
})

// The data an app comes with (seed.ts, T-34327). Owner, 2026-09-05: "so when
// the app is first launced or installed, it comes with some initial data."
// The whole of it: one batch out of a file and a folder, an alias resolving
// across them, the app's OWN component seeded because the vocabulary is
// planted first, a redeploy that writes nothing more, and files the web never
// sees.
slow(
  'a deploy seeds the store once, and the seed is not on the web',
  async () => {
    let k = await kernel()
    try {
      let jeff = await signIn(k)
      let agent = connector(k, jeff.cookie)
      let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
        .exec(
          await agent.tool('app_new', { slug: 'cookbook', title: 'Cookbook' }),
        )![1]
      let app = { space, app: 'cookbook' }
      await agent.tool('app_files', {
        ...app,
        files: [
          { path: 'index.html', content: '<!doctype html><h1>Cookbook' },
          { path: 'vocab.json', content: '{"recipe":{"serves":"number"}}' },
          {
            path: 'seed.json',
            content: JSON.stringify([{
              entity: { eid: '$soup' },
              doc: { title: 'Lentil soup' },
              recipe: { serves: 4 },
            }]),
          },
          // A folder as well, because the data can be large and an agent writes
          // it a call at a time — and the alias `seed.json` minted resolves
          // here, which is what says the two are ONE batch.
          {
            path: 'seed/01-notes.json',
            content: JSON.stringify([{
              entity: { eid: '$note' },
              doc: { body: 'double the cumin' },
              comment: { target: '$soup' },
            }]),
          },
        ],
      })
      let out = await agent.tool('app_deploy', app)
      assertStringIncludes(out, 'components: recipe')
      assertStringIncludes(
        out,
        'seeded 2 entities from seed.json, seed/01-notes.json',
      )
      // The rows are there, wearing the app's own word — so the seed ran AFTER
      // the vocabulary was planted — and the comment points at the entity the
      // other file minted.
      let [soup] = JSON.parse(
        await agent.tool('graph_query', { q: '.recipe!&.doc?' }),
      ) as { entity: { eid: string }; doc: { title: string } }[]
      assertEquals(soup.doc.title, 'Lentil soup')
      let [note] = JSON.parse(
        await agent.tool('graph_query', { q: '.comment!' }),
      ) as { comment: { target: { eid: string } | string } }[]
      let target = note.comment.target
      assertEquals(
        typeof target == 'string' ? target : target.eid,
        soup.entity.eid,
      )

      // Once per store: the person renames the recipe, deploys again, and the
      // seed does not put the old title back.
      await agent.tool('graph_apply', {
        change: [{ entity: { eid: soup.entity.eid }, doc: { title: 'Dal' } }],
      })
      let again = await agent.tool('app_deploy', app)
      assertEquals(again.includes('seeded'), false)
      let all = JSON.parse(
        await agent.tool('graph_query', { q: '.recipe!&.doc?' }),
      ) as { doc: { title: string } }[]
      assertEquals(all.map((r) => r.doc.title), ['Dal'])

      // And the seed is the app's INSIDE, like vocab.json: deployed, never
      // served (apps.ts MANIFEST).
      for (
        let path of ['/cookbook/seed.json', '/cookbook/seed/01-notes.json']
      ) {
        let r = await k.at(`${space}.yaks.app`, path)
        assertEquals(r.status, 404, path)
        await r.body?.cancel()
      }
      // A member still reads them back.
      assertStringIncludes(
        await agent.tool('app_files', {
          ...app,
          op: 'read',
          path: 'seed.json',
        }),
        'Lentil soup',
      )

      // And a SECOND person taking the app gets their own store seeded — which
      // is the other half of the ask: an app arrives furnished wherever it is
      // installed, and what he renamed to `Dal` is his and travels with neither.
      await agent.tool('app_publish', {
        ...app,
        about: 'Recipes to start from',
      })
      let ann = await signIn(
        k,
        `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`,
      )
      let hers = connector(k, ann.cookie)
      assertStringIncludes(
        await hers.tool('app_install', { name: 'cookbook' }),
        'seeded 2 entities',
      )
      let theirs = JSON.parse(
        await hers.tool('graph_query', { q: '.recipe!&.doc?' }),
      ) as { doc: { title: string } }[]
      assertEquals(theirs.map((r) => r.doc.title), ['Lentil soup'])
    } finally {
      await k.stop()
    }
  },
)

// And a bundle the store refuses refuses the DEPLOY, naming the file and the
// entry: an agent that wrote ten seed files needs to know which one it
// mistyped, and the refusal itself only ever names the word.
slow('a refused seed bundle names its file and index', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    await agent.tool('app_new', { slug: 'cellar', title: 'Cellar' })
    let app = { app: 'cellar' }
    await agent.tool('app_files', {
      ...app,
      files: [
        { path: 'index.html', content: '<!doctype html><h1>Cellar' },
        { path: 'vocab.json', content: '{"bottle":{"year":"number"}}' },
        {
          path: 'seed/01-bottles.json',
          content: JSON.stringify([
            { entity: { eid: '$a' }, bottle: { year: 2019 } },
            { entity: { eid: '$b' }, bottle: { vintage: 2020 } },
          ]),
        },
      ],
    })
    let why = (await assertRejects(() => agent.tool('app_deploy', app), Error))
      .message
    assertStringIncludes(why, 'seed/01-bottles.json[1] was refused')
    assertStringIncludes(why, 'bottle.vintage')
    // Nothing was written: the batch is atomic and the mark is only made when
    // it lands, so fixing the file and deploying again seeds the whole thing.
    assertEquals(await agent.tool('graph_query', { q: '.bottle!' }), '[]')
    await agent.tool('app_files', {
      ...app,
      op: 'write',
      path: 'seed/01-bottles.json',
      content: JSON.stringify([
        { entity: { eid: '$a' }, bottle: { year: 2019 } },
        { entity: { eid: '$b' }, bottle: { year: 2020 } },
      ]),
    })
    assertStringIncludes(
      await agent.tool('app_deploy', app),
      'seeded 2 entities',
    )
  } finally {
    await k.stop()
  }
})

// Bulk data that is not seed data (T-34392). Owner, 2026-09-05: "any other
// improvements we can make for bulk data that isn't seed data?" The same
// reading as the seed, asked for on purpose: a folder of files as one batch,
// aliases across them, only the *.json among them, and no once-only mark — so
// a second call loads the same file again.
slow('store_load writes a file already in the app into its store', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    await agent.tool('app_new', { slug: 'atlas', title: 'Atlas' })
    let app = { app: 'atlas' }
    await agent.tool('app_files', {
      ...app,
      files: [
        { path: 'index.html', content: '<!doctype html><h1>Atlas' },
        // A folder, written a call at a time the way a large dataset is — and
        // a file beside them that is not JSON, which is never read and so
        // never refuses anything.
        {
          path: 'data/01-places.json',
          content: JSON.stringify([{
            entity: { eid: '$here' },
            doc: { title: 'Reykjavik' },
          }]),
        },
        {
          path: 'data/02-notes.json',
          content: JSON.stringify([{
            entity: { eid: '$note' },
            doc: { body: 'the pool opens at six' },
            comment: { target: '$here' },
          }]),
        },
        { path: 'data/README.md', content: '# where the cities came from' },
        {
          path: 'more.json',
          content: JSON.stringify([{
            entity: { eid: '$one' },
            doc: { title: 'Akureyri' },
          }]),
        },
      ],
    })
    // The folder: both files, one batch, so the comment in the second points
    // at the entity the first minted.
    assertStringIncludes(
      await agent.tool('store_load', { ...app, path: 'data' }),
      'loaded 2 entities into',
    )
    let [place] = JSON.parse(
      await agent.tool('graph_query', { q: '.doc.title=Reykjavik' }),
    ) as { entity: { eid: string } }[]
    let [note] = JSON.parse(
      await agent.tool('graph_query', { q: '.comment!' }),
    ) as { comment: { target: { eid: string } | string } }[]
    let target = note.comment.target
    assertEquals(
      typeof target == 'string' ? target : target.eid,
      place.entity.eid,
    )
    // One file by name, too.
    assertStringIncludes(
      await agent.tool('store_load', { ...app, path: 'more.json' }),
      'loaded 1 entity into',
    )
    let titles = async () =>
      (JSON.parse(await agent.tool('graph_query', { q: '.doc.title!' })) as {
        doc: { title: string }
      }[]).map((r) => r.doc.title).sort()
    assertEquals(await titles(), ['Akureyri', 'Reykjavik'])

    // And no once-only mark: it is a call anyone can make again, which is what
    // separates it from the seed.
    assertStringIncludes(
      await agent.tool('store_load', { ...app, path: 'data' }),
      'loaded 2 entities into',
    )
    assertEquals(await titles(), ['Akureyri', 'Reykjavik', 'Reykjavik'])

    // A path that names nothing says so, and says where to look.
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('store_load', { ...app, path: 'nowhere' }),
        Error,
      )).message,
      'no file nowhere in atlas',
    )
  } finally {
    await k.stop()
  }
})

// The token that signs a terminal in (grants.ts, T-34385): the connector mints
// it, the same door takes it as the same person, `about` says who is holding
// it and until when, a grant cannot mint another, and revoking it shuts the
// door that bearer was walking through — the 401 every credential that did not
// verify gets (T-34344), rather than the surface a stranger sees.
slow(
  'a grant signs a terminal in, and revoking it shuts the door',
  async () => {
    let k = await kernel()
    try {
      let them = await seed(k, [
        { slug: `one-${crypto.randomUUID().slice(0, 6)}`, apps: ['notes'] },
        { slug: `two-${crypto.randomUUID().slice(0, 6)}`, apps: ['lists'] },
      ])
      let [one, two] = Object.keys(them.eids).filter((s) => !s.includes('/'))
      let agent = connector(k, them.cookie)
      await agent.call('initialize', HELLO)
      let said = await agent.tool('grant', {})
      // The answer is the line to paste, and what the token is worth beside it.
      let token = /^yaks login (\S+)$/m.exec(said)![1]
      assertStringIncludes(said, 'shown once')
      assertStringIncludes(said, 'exactly the access they have here')
      let id = /revoke (\w+)\./.exec(said)![1]

      // The terminal: the same door, the same tools, the same person — carrying
      // no cookie at all.
      let cli = connector(k, undefined, token)
      let listed = await cli.call('tools/list')
      assert(listed.tools.some((t: { name: string }) => t.name == 'app_new'))
      let me = await cli.tool('about')
      assertStringIncludes(me, `<${them.email}>`)
      assertStringIncludes(me, 'with a CLI grant')
      assertStringIncludes(me, id)
      assertStringIncludes(await cli.tool('app_list'), 'notes')

      // A grant cannot mint another: a short life that renews itself is not one.
      assertStringIncludes(
        (await assertRejects(() => cli.tool('grant'), Error)).message,
        'cannot mint another',
      )

      // Narrowed to one space it reaches that space and no other — and cannot
      // make a third to escape into.
      let narrow = await agent.tool('grant', { space: two, hours: 6 })
      assertStringIncludes(narrow, `It reaches ${two} and no other space`)
      let only = connector(k, undefined, /^yaks login (\S+)$/m.exec(narrow)![1])
      assertStringIncludes(await only.tool('app_list'), 'lists')
      assertStringIncludes(
        (await assertRejects(
          () => only.tool('app_list', { space: one }),
          Error,
        ))
          .message,
        `no space ${one}`,
      )
      assertStringIncludes(
        (await assertRejects(
          () => only.tool('space_new', { slug: 'three', title: 'three' }),
          Error,
        )).message,
        'and no other space',
      )

      // Revoked, that bearer is refused — and the narrowed one still works,
      // since only the grant named went.
      assertStringIncludes(await agent.tool('grant', { revoke: id }), id)
      assertStringIncludes(
        (await assertRejects(() => cli.call('tools/list'), Error)).message,
        'mcp 401',
      )
      assert(await only.call('tools/list'))
    } finally {
      await k.stop()
    }
  },
)

// The spreadsheet half (csv.ts, T-34393): `as` is what a row IS, the headers
// are its columns, and the id column is what makes the SECOND load patch the
// same two rows rather than mint two more.
slow('store_load reads a CSV as rows of one component', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    await agent.tool('app_new', { slug: 'kitchen', title: 'Kitchen' })
    let app = { app: 'kitchen' }
    await agent.tool('app_files', {
      ...app,
      files: [
        { path: 'index.html', content: '<!doctype html><h1>Kitchen' },
        {
          path: 'vocab.json',
          content: '{"recipe":{"name":"text","serves":"number",' +
            '"vegan":"bool"}}',
        },
        // As a spreadsheet writes one: a BOM, CRLF, a quoted comma, and a
        // header nothing matches until `map` renames it.
        {
          path: 'data/menu.csv',
          content: '﻿id,name,Serves how many,vegan,title\r\n' +
            'lentil,"Lentil, soup",4,yes,Lentil soup\r\n' +
            'fig,Fig tart,8,no,Fig tart\r\n',
        },
      ],
    })
    await agent.tool('app_deploy', app)
    let load = (args: Record<string, unknown> = {}) =>
      agent.tool('store_load', {
        ...app,
        path: 'data/menu.csv',
        as: 'recipe',
        map: { 'Serves how many': 'serves' },
        ...args,
      })
    assertStringIncludes(await load(), 'loaded 2 entities into')
    let recipes = async () =>
      (JSON.parse(await agent.tool('graph_query', { q: '.recipe!' })) as {
        entity: { eid: string }
        recipe: { name: string; serves: number; vegan: number }
      }[]).sort((a, b) => a.recipe.serves - b.recipe.serves)
    let [soup, tart] = await recipes()
    // `yes` coerced to a boolean, which a store keeps in an integer column and
    // reads back as one — the same 1 a JSON load's `true` writes.
    assertEquals(soup.recipe, { name: 'Lentil, soup', serves: 4, vegan: 1 })
    assertEquals(tart.recipe.vegan, 0)
    // The `title` header is the row's doc, not the recipe's own word.
    assertEquals(
      (JSON.parse(await agent.tool('graph_query', { q: '.doc.title!' })) as {
        doc: { title: string }
      }[]).map((r) => r.doc.title).sort(),
      ['Fig tart', 'Lentil soup'],
    )
    // Again: the id column named these two entities, so the second load
    // patches them where a `$alias` would have minted two more.
    assertStringIncludes(await load(), 'loaded 2 entities into')
    let again = await recipes()
    assertEquals(again.length, 2)
    assertEquals(again[0].entity.eid, soup.entity.eid)

    // A header the component has no column for names itself, and says the
    // two ways out.
    let why = (await assertRejects(() => load({ map: {} }), Error)).message
    assertStringIncludes(why, '"Serves how many" is not a column of recipe')
    assertStringIncludes(why, 'recipe takes name, serves, vegan')
    // And a word no store says is refused before a byte is read.
    assertStringIncludes(
      (await assertRejects(() => load({ as: 'dish' }), Error)).message,
      'as: dish is not a component',
    )
  } finally {
    await k.stop()
  }
})

// AGENTS.md beside an app (standing.ts, T-34425): the standing rules its
// person left, and — for every app, rules or not — the heading that makes it
// discoverable. Owner, 2026-09-05: "if i later say, 'add this recipe', i want
// them to know there's a recipe app to add it to".
slow('an app says what it holds, and what it asks of an agent', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
      .exec(
        await agent.tool('app_new', { slug: 'recipes', title: 'Recipes' }),
      )![1]
    let RULES = '# Recipes\n\nWeights in grams, never cups.\n' +
      'One photo per recipe, of the finished dish.'
    await agent.tool('app_files', {
      space,
      app: 'recipes',
      files: [
        { path: 'index.html', content: '<h1>Recipes</h1>' },
        {
          path: 'vocab.json',
          content: JSON.stringify({ recipe: { serves: 'number' } }),
        },
        {
          path: 'tools.json',
          content: JSON.stringify({
            add: {
              description: 'Write a recipe down',
              input: { title: 'text' },
              apply: { doc: { title: '{{title}}' }, recipe: {} },
            },
          }),
        },
        { path: 'AGENTS.md', content: RULES },
      ],
    })
    await agent.tool('app_deploy', { space, app: 'recipes' })
    // A second app with words of its own and NO rules beside it: it is still
    // named, because being found is the point.
    await agent.tool('app_new', { slug: 'chores', title: 'Chores' })
    await agent.tool('app_files', {
      space,
      app: 'chores',
      files: [{
        path: 'vocab.json',
        content: JSON.stringify({ chore: { who: 'text' } }),
      }],
    })
    await agent.tool('app_deploy', { space, app: 'chores' })

    // What a model reads before it reads anything else.
    let init = await agent.call('initialize', HELLO)
    assertStringIncludes(init.instructions, `## ${space}/recipes`)
    assertStringIncludes(
      init.instructions,
      `https://${space}.yaks.app/recipes/`,
    )
    assertStringIncludes(init.instructions, 'holds recipes')
    assertStringIncludes(init.instructions, 'Tools: recipes__add')
    assertStringIncludes(init.instructions, 'Weights in grams, never cups.')
    assertStringIncludes(init.instructions, `## ${space}/chores`)
    assertStringIncludes(init.instructions, 'holds chores')
    // And `about` says it again, for a conversation the apps moved under.
    let about = await agent.tool('about')
    assertStringIncludes(about, 'Weights in grams, never cups.')
    assertStringIncludes(about, `## ${space}/chores`)

    // The person's own door onto the same words: a prompt named after the
    // app, whose description is the file's first line.
    let listed = async (
      c: ReturnType<typeof connector>,
    ) => ((await c.call('prompts/list')).prompts as {
      name: string
      description: string
    }[])
    let prompts = await listed(agent)
    let mine = prompts.find((p) => p.name == 'recipes')
    assert(mine, `no recipes prompt in ${prompts.map((p) => p.name)}`)
    assertEquals(mine.description, 'Recipes')
    assertEquals(prompts.some((p) => p.name == 'chores'), false)
    let got = await agent.call('prompts/get', { name: 'recipes' })
    assertEquals(got.messages.length, 1)
    assertEquals(got.messages[0].role, 'user')
    assertEquals(got.messages[0].content.text, RULES)

    // It is the app's INSIDE: deployed, never served, whichever way the path
    // is spelled (apps.ts MANIFEST).
    assertEquals(
      (await k.at(`${space}.yaks.app`, '/recipes/AGENTS.md')).status,
      404,
    )
    assertEquals(
      (await k.at(`${space}.yaks.app`, '/recipes/%41GENTS.md')).status,
      404,
    )

    // Too long is refused at the write, with the number, rather than
    // truncated at the read: every agent in the space pays for it on every
    // connection.
    assertStringIncludes(
      (await assertRejects(
        () =>
          agent.tool('app_files', {
            space,
            app: 'recipes',
            path: 'AGENTS.md',
            content: 'x'.repeat(4097),
          }),
        Error,
      )).message,
      '4097 bytes — 4096 at most',
    )

    // A member of another space is told nothing about any of it: reach is
    // membership, the same question the tool list asks (declared.ts).
    let maya = connector(k, (await signIn(k)).cookie)
    let hers = await maya.call('initialize', HELLO)
    assertEquals(hers.instructions.includes('Weights in grams'), false)
    assertEquals(hers.instructions.includes(`${space}/recipes`), false)
    assertEquals((await listed(maya)).some((p) => p.name == 'recipes'), false)

    // Until she installs it. The rules are one of the app's files, so a copy
    // carries them — the publisher's rules, in her own copy, hers to rewrite.
    await agent.tool('app_publish', { space, app: 'recipes' })
    assertStringIncludes(
      await maya.tool('app_install', { name: 'recipes' }),
      'installed recipes',
    )
    assertStringIncludes(
      await maya.tool('app_files', {
        app: 'recipes',
        op: 'read',
        path: 'AGENTS.md',
      }),
      'Weights in grams, never cups.',
    )
    assertStringIncludes(
      (await maya.call('initialize', HELLO)).instructions,
      'Weights in grams, never cups.',
    )
  } finally {
    await k.stop()
  }
})
