// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { Ajv } from 'ajv'
import { slow, until } from '../../src/testing.ts'
import { connector, kernel, signIn } from './probe.ts'
import { hearing, HELLO } from './mcp-probe.ts'

// An app's OWN tools (T-32685): a tools.json beside vocab.json, planted by
// the same deploy, called at the same door as `<app>__<tool>` — and doing
// through it exactly what the caller could do on the app's own page.
slow('an app declares its own commands, and command runs them', async () => {
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
    assertStringIncludes(deployed, 'commands: log_run, leaderboard')
    assertStringIncludes(deployed, 'components: jog')

    // What the app can be ASKED to do, said by the one fixed tool (T-34541):
    // the commands, the app each belongs to, and the arguments each takes.
    let commands = async (args: Record<string, unknown> = {}) =>
      (await agent.call('tools/call', { name: 'commands', arguments: args }))
        .structuredContent.commands as {
          at: string
          name: string
          description: string
          readOnly: boolean
          input: { required: string[] }
          view?: string
        }[]
    let all = await commands()
    // The two it declared, and the two its `jog` is worth (kinds.ts).
    assertEquals(all.map((c) => c.name), [
      'log_run',
      'leaderboard',
      'add_jog',
      'find_jog',
    ])
    assertEquals(new Set(all.map((c) => c.at)), new Set([`${space}/runs`]))
    let log = all.find((c) => c.name == 'log_run')!
    // The app's TITLE and address ride in the description: a slug is not what
    // the person called it, and a model choosing reads the words.
    assertStringIncludes(log.description, 'Run club')
    assertStringIncludes(log.description, `${space}.yaks.app/runs/`)
    assertEquals(log.input.required, ['who', 'miles'])
    assertEquals(log.readOnly, false)

    // The app's own MCP App view (T-32687): the command names the page, the
    // door serves it out of the app's own files under the profile, and a
    // `<base>` at the app's address keeps the stylesheet beside it working.
    let view = `ui://${space}/runs/leaderboard.html`
    let board0 = all.find((c) => c.name == 'leaderboard')!
    assertEquals(board0.view, view)
    assertEquals(board0.readOnly, true)
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
    let wrote = await agent.tool('command', {
      name: 'log_run',
      args: { who: 'Ada', miles: 5 },
    })
    assertStringIncludes(wrote, 'log_run: wrote 1 entity')
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
      name: 'command',
      arguments: { name: 'leaderboard' },
    })
    assertStringIncludes(board.content[0].text, 'leaderboard: 1 row')
    assertEquals(
      (board.structuredContent.rows as Run[])[0].created.by,
      { eid: jeff.person, name: jeff.name },
    )
    // An argument the command declared and the call left out is refused by
    // the declaration, naming the argument, and no half-written row lands.
    let short = await assertRejects(
      () => agent.tool('command', { name: 'log_run', args: { who: 'Ada' } }),
      Error,
    )
    assertStringIncludes(short.message, 'miles')
    // A command nobody declared says what there IS instead of nothing: the
    // list is this person's own, so a model cannot have known it.
    let nope = await assertRejects(
      () => agent.tool('command', { name: 'nope' }),
      Error,
    )
    assertStringIncludes(nope.message, 'no command nope')
    assertStringIncludes(nope.message, `${space}/runs: log_run, leaderboard`)
    assertStringIncludes(nope.message, 'commands lists them')
    // And an app nobody has, named on the call.
    assertStringIncludes(
      (await assertRejects(
        () => agent.tool('command', { app: 'gone', name: 'log_run' }),
        Error,
      )).message,
      'no app gone',
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
      await hers.tool('command', { name: 'leaderboard' }),
      'leaderboard: 1 row',
    )
    await assertRejects(
      () =>
        hers.tool('command', {
          name: 'log_run',
          args: { who: 'Maya', miles: 3 },
        }),
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
      await agent.tool('command', {
        name: 'log_run',
        args: { who: 'Bo', miles: 2 },
      }),
      'wrote 1 entity',
    )
  } finally {
    await k.stop()
  }
})

// The commands a KIND is worth (T-34513): an app that declares a `recipe` and
// no tools.json at all still has a verb for adding one and a verb for finding
// it, so the next agent the person talks to discovers the app the way it
// discovers anything else here — by asking what the apps in reach can do.
slow('a kind an app declares is two commands, with no tools.json', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
      .exec(await agent.tool('app_new', { slug: 'box', title: 'Recipe box' }))![
        1
      ]
    let app = { space, app: 'box' }
    await agent.tool('app_files', {
      ...app,
      files: [
        { path: 'index.html', content: '<!doctype html><p>recipes' },
        {
          path: 'vocab.json',
          content: '{"recipe":{"serves":"number","cuisine":"text"}}',
        },
      ],
    })
    // The deploy says them in the same line it says a declared command's name.
    assertStringIncludes(
      await agent.tool('app_deploy', app),
      'commands: add_recipe, find_recipe',
    )

    // They are ordinary declared commands: the app's title and address on the
    // sentence, and the read half marked read-only.
    let listed = async () =>
      (await agent.call('tools/call', { name: 'commands', arguments: {} }))
        .structuredContent.commands as {
          name: string
          description: string
          readOnly: boolean
          input: { properties: Record<string, unknown>; required?: string[] }
        }[]
    let all = await listed()
    let add = all.find((t) => t.name == 'add_recipe')!
    let find = all.find((t) => t.name == 'find_recipe')!
    assertStringIncludes(
      add.description,
      `Add a recipe to ${space}/box — Recipe box, an app at ` +
        `${space}.yaks.app/box/`,
    )
    assertStringIncludes(find.description, `Find recipes in ${space}/box.`)
    assertEquals(add.readOnly, false)
    assertEquals(find.readOnly, true)
    // The kind's own columns are the arguments, and only the title is owed.
    assertEquals(Object.keys(add.input.properties), [
      'title',
      'body',
      'alias',
      'serves',
      'cuisine',
    ])
    assertEquals(add.input.required, ['title'])
    // Nothing at all is owed to the find.
    assertEquals(find.input.required ?? [], [])

    // Adding writes the row: the kind, the title, the columns given — and the
    // name it answers to afterwards.
    assertStringIncludes(
      await agent.tool('command', {
        name: 'add_recipe',
        args: {
          title: 'Lemon cake',
          body: '3 lemons',
          alias: 'lemon-cake',
          serves: 8,
        },
      }),
      // Two: the recipe, and the name it answers to — a key is an entity of
      // its own (@yaks/key).
      'add_recipe: wrote 2 entities',
    )
    // A second one with nothing but a title still wears the kind, so the find
    // answers it — and writes no nameless alias.
    await agent.tool('command', {
      name: 'add_recipe',
      args: { title: 'Toast' },
    })
    let found = async (args: Record<string, unknown>) =>
      (await agent.call('tools/call', {
        name: 'command',
        arguments: { name: 'find_recipe', args },
      }))
        .structuredContent.rows as { doc: { title: string } }[]
    assertEquals((await found({})).map((r) => r.doc.title), [
      'Lemon cake',
      'Toast',
    ])
    // A clause whose argument is left out drops out of the filter line.
    assertEquals((await found({ words: 'lemons' })).map((r) => r.doc.title), [
      'Lemon cake',
    ])
    assertEquals((await found({ serves: 8 })).map((r) => r.doc.title), [
      'Lemon cake',
    ])

    // And a tools.json spelling one of the names takes it over, whole: the
    // app's own sentence and the app's own template, beside the other half
    // still generated for it.
    await agent.tool('app_files', {
      ...app,
      op: 'write',
      path: 'tools.json',
      content: JSON.stringify({
        add_recipe: {
          description: 'Add a recipe the way this box means it',
          input: { title: 'text' },
          apply: {
            entity: { eid: '$r' },
            doc: { title: '{{title}}' },
            recipe: { cuisine: 'house' },
          },
        },
      }),
    })
    assertStringIncludes(
      await agent.tool('app_deploy', app),
      'commands: add_recipe, find_recipe',
    )
    assertEquals((await listed()).map((t) => t.name), [
      'add_recipe',
      'find_recipe',
    ])
    await agent.tool('command', {
      name: 'add_recipe',
      args: { title: 'Fried rice' },
    })
    assertEquals(
      (await found({ cuisine: 'house' })).map((r) => r.doc.title),
      ['Fried rice'],
    )
  } finally {
    await k.stop()
  }
})

// ONE ROSTER, for everybody (T-34541). A directory snapshots `tools/list`
// when a connector is submitted and serves that snapshot forever — only
// `tools/call` reaches us — so a list that moves with whose token arrived, or
// with what somebody deployed this morning, is a list the published connector
// can never match. What an app declares is a COMMAND instead: `commands` says
// which there are, `command` runs one, and neither name ever moves.
slow(
  'the roster is one list for everybody, and apps carry commands',
  async () => {
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
      // And somebody with no apps at all, whose list is the same list.
      let nobody = await signIn(k)

      let named = async (agent: ReturnType<typeof connector>) =>
        ((await agent.call('tools/list')).tools as { name: string }[])
          .map((t) => t.name)
      let his = await named(club.agent)
      // An app owner, a member of another space, a person with nothing, and
      // nobody at all: one list, in one order.
      assertEquals(await named(connector(k, maya.cookie)), his)
      assertEquals(await named(connector(k, nobody.cookie)), his)
      assertEquals(await named(connector(k)), his)
      assert(his.includes('app_deploy'), 'the platform tools are listed')
      assert(his.includes('graph_apply'), 'so is the write, signed out and in')
      assert(his.includes('mail_send'), 'and the mailbox')
      assertEquals(his.filter((n) => n.includes('__')), [], 'no per-app name')
      assertEquals(
        his.some((n) => n.includes('log_run') || n.includes('note')),
        false,
        "no app's own verb is a tool",
      )

      // What differs is the COMMANDS, which are a caller's own: his app's, and
      // nothing of hers — her app is in her space, and he is nobody there.
      let commands = async (
        agent: ReturnType<typeof connector>,
      ) => ((await agent.call('tools/call', {
        name: 'commands',
        arguments: {},
      }))
        .structuredContent.commands as { at: string; name: string }[])
      // Each app's own, and the two every word it declares is worth beside
      // them (kinds.ts).
      assertEquals((await commands(club.agent)).map((c) => c.name), [
        'log_run',
        'add_jog',
        'find_jog',
      ])
      assertEquals(
        (await commands(connector(k, maya.cookie))).map((c) => c.name),
        ['note', 'add_entryline', 'find_entryline'],
      )
      // And a person with no apps is told so in a sentence rather than nothing.
      assertStringIncludes(
        await connector(k, nobody.cookie).tool('commands'),
        'no app you can reach declares a command yet',
      )

      // The door says it will announce a moved list, and the instructions name
      // the apps in reach with their commands and how to run one.
      let init = await club.agent.call('initialize', HELLO)
      assertEquals(init.capabilities.tools.listChanged, true)
      assertStringIncludes(init.instructions, `${club.space}/runs`)
      assertStringIncludes(init.instructions, 'Commands: log_run')
      assertStringIncludes(init.instructions, 'command')

      // The session's stream: held open, and QUIET through a deploy that grew a
      // command. The tool list did not move, so nothing is said about it — the
      // one thing that moves it now is a release (stream.ts `crossed`).
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
      let grew = await club.agent.tool('app_deploy', {
        space: club.space,
        app: 'runs',
      })
      assertStringIncludes(grew, 'commands: log_run, jogs, add_jog, find_jog')
      // The new command answers straight away, with no list to re-read first.
      assertEquals(
        (await commands(club.agent)).map((c) => c.name),
        ['log_run', 'jogs', 'add_jog', 'find_jog'],
      )
      assertEquals(await named(club.agent), his, 'the roster did not move')
      assertEquals(ear.said().includes('list_changed'), false)
    } finally {
      await ear?.stop()
      await k.stop()
    }
  },
)

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
      // goes stale with it — app_deploy plants the words and the next
      // `tools/list` is typed for them. The tool NAMES did not move, so
      // nothing is said on the stream (T-34541): a client is told its list
      // moved only when it did, and the open write door is what makes a
      // client holding the older schema work anyway.
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
      assertEquals(ear.said().includes('list_changed'), false)
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
      // The older schema typed nothing about a word nobody had declared yet,
      // so a client holding it sends `serves` as anything at all and the
      // server decides — which is the whole reason the write door is open.
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
