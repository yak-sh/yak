// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { Ajv } from 'ajv'
import { slow, until } from '../../src/testing.ts'
import {
  accepted,
  commandsIn,
  connector,
  kernel,
  num,
  rowsIn,
  signIn,
  txt,
  vocabFile,
} from './probe.ts'
import { hearing, HELLO } from './mcp-probe.ts'

// An app's own tools (T-32685): a tools.json beside vocab.json, planted by
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
          content: vocabFile({ jog: { who: txt, miles: num } }),
        },
        {
          path: 'tools.json',
          content: JSON.stringify({
            log_run: {
              description: 'Log a run for the club leaderboard',
              input: { who: 'text', miles: 'number' },
              apply: {
                entity: { eid: '$run' },
                jog: { who: '$who', miles: '$miles' },
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

    // What the app can be asked to do, said by the one fixed tool (T-34541):
    // the commands, the app each belongs to, and the arguments each takes.
    let commands = async (args: Record<string, unknown> = {}) =>
      commandsIn(await agent.tool('commands', args))
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
    // The app's title and address ride in the description: a slug is not what
    // the person called it, and a model choosing reads the words.
    assertStringIncludes(log.description, 'Run club')
    assertStringIncludes(log.description, `${space}.yaks.app/runs/`)
    // Its arguments as the listing writes them, required ones bare.
    assertEquals(log.args, 'who, miles')
    assert(log.writes, 'logging a run is a write')

    // The app's own MCP App view (T-32687): the command names the page, the
    // door serves it out of the app's own files under the profile, and a
    // `<base>` at the app's address keeps the stylesheet beside it working.
    let view = `ui://${space}/runs/leaderboard.html`
    let board0 = all.find((c) => c.name == 'leaderboard')!
    assert(!board0.writes, 'a leaderboard only reads')
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
    // Only the OpenAI compatibility key selects a custom sandbox origin.
    // Portable hosts use their default; CSP still permits the app's assets.
    for (let said of [listed, page]) {
      assertEquals(said._meta.ui.domain, undefined)
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
    // `{eid, name}`, so the leaderboard a view draws from its one query says
    // who ran instead of "someone" (C-32730 item 5).
    assertEquals(rows[0].created.by, { eid: jeff.person, name: jeff.name })
    // And the read half answers the listing a page gets — the same byline,
    // through the declared tool's own query.
    let board = await agent.tool('command', { name: 'leaderboard' })
    assertStringIncludes(board, 'leaderboard: 1 row')
    // The rows are said once, under the sentence, and they still carry who
    // wrote them: a command runs as the person who asked for it.
    assertEquals(rowsIn<Run>(board)[0].created.by, {
      eid: jeff.person,
      name: jeff.name,
    })
    // And the reply carries that answer as what it IS: a tool answers bundles,
    // so the words are one bundle's `content{body}` and the bundle says which
    // call it came from. An app's own declared command goes down the same path
    // as every other tool here, and this is where that shows.
    let reply = await agent.call('tools/call', {
      name: 'command',
      arguments: { name: 'leaderboard' },
    })
    let answer = reply.structuredContent.result as {
      content: { body: string }
      output: { source: string }
    }[]
    assertEquals(answer.length, 1)
    assertEquals(answer[0].content.body, reply.content[0].text)
    assert(answer[0].output.source, 'the call it answered')
    // An argument the command declared and the call left out is refused by
    // the declaration, naming the argument, and no half-written row lands.
    let short = await assertRejects(
      () => agent.tool('command', { name: 'log_run', args: { who: 'Ada' } }),
      Error,
    )
    assertStringIncludes(short.message, 'miles')
    // A command nobody declared says what there is instead of nothing: the
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
    await accepted(k, maya.email, maya.cookie)
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

    // A manifest that cannot work is refused at deploy, whole, and the tools
    // the app already had keep answering.
    await agent.tool('app_files', {
      ...app,
      op: 'write',
      path: 'tools.json',
      content: '{"bad":{"description":"x","input":{},"apply":' +
        '{"jog":{"who":"$who"}},"screen":"index.html"}}',
    })
    let why = (await assertRejects(() => agent.tool('app_deploy', app), Error))
      .message
    assertStringIncludes(why, 'bad: screen — a tool says')
    assertStringIncludes(why, 'bad: $who names no input')
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

// The commands a kind is worth (T-34513): an app that declares a `recipe` and
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
          content: vocabFile({ recipe: { serves: num, cuisine: txt } }),
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
    let listed = async () => commandsIn(await agent.tool('commands'))
    let all = await listed()
    let add = all.find((t) => t.name == 'add_recipe')!
    let find = all.find((t) => t.name == 'find_recipe')!
    assertStringIncludes(
      add.description,
      `Add a recipe to ${space}/box — Recipe box, an app at ` +
        `${space}.yaks.app/box/`,
    )
    assertStringIncludes(find.description, `Find recipes in ${space}/box.`)
    assert(add.writes, 'adding a recipe writes it')
    assert(!find.writes, 'finding them does not')
    // The kind's own properties are the arguments, and only the title is owed —
    // the optional ones wear the `?` the listing marks them with.
    assertEquals(add.args, 'title, body?, alias?, serves?, cuisine?')
    // Nothing at all is owed to the find: every argument it takes wears `?`.
    assertEquals(find.args.split(', ').filter((a) => !a.endsWith('?')), [])

    // Adding writes the row: the kind, the title, the properties given — and
    // the name it answers to afterwards.
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
      rowsIn<{ doc: { title: string } }>(
        await agent.tool('command', { name: 'find_recipe', args }),
      )
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

    // And a tools.json entry naming one of the names takes it over, whole: the
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
            doc: { title: '$title' },
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

// One roster, for everybody (T-34541). A directory snapshots `tools/list`
// when a connector is submitted and serves that snapshot forever — only
// `tools/call` reaches us — so a list that moves with whose token arrived, or
// with what somebody deployed this morning, is a list the published connector
// can never match. What an app declares is a command instead: `commands` says
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
            apply: { [comp]: { text: '$text' } },
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
              content: vocabFile({ [comp]: { text: txt } }),
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

      // What differs is the commands, which are a caller's own: his app's, and
      // nothing of hers — her app is in her space, and he is nobody there.
      let commands = async (agent: ReturnType<typeof connector>) =>
        commandsIn(await agent.tool('commands'))
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

      // The session's stream: held open, and quiet through a deploy that grew a
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
            apply: { jog: { text: '$text' } },
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

// And the schema door (T-34156). Jeff: "can we otherwise add some vocab tools?
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
      content: vocabFile({ recipe: { serves: num } }),
    })
    await agent.tool('app_deploy', { app: 'cookbook' })
    type Entry = {
      description?: string
      kind?: boolean
      before?: string[]
      properties: Record<string, { type: unknown; description?: string }>
      examples?: Record<string, unknown>[]
    }
    // Both halves of one answer: the markdown a person reads, and the
    // vocabulary document a program parses — held, as a client holds it, to
    // the output schema the tool is listed with.
    let { tools } = await agent.call('tools/list', {})
    let fits = new Ajv({ strict: false }).compile(
      tools.find((t: { name: string }) => t.name == 'graph_schema')
        .outputSchema,
    )
    let said = async (args: Record<string, unknown>) => {
      let reply = await agent.call('tools/call', {
        name: 'graph_schema',
        arguments: args,
      })
      assert(fits(reply.structuredContent), JSON.stringify(fits.errors))
      return {
        text: String(reply.content[0].text),
        defs: reply.structuredContent.$defs as Record<string, Entry>,
      }
    }

    // The index: every word the caller can reach, what it is, each property's
    // type — the app's own word among the platform's.
    let index = await said({})
    assert(index.defs.recipe, 'the app own word is in the index')
    assert(index.defs.mail)
    assertEquals(index.defs.doc.properties, {
      title: { type: 'string' },
      body: { type: 'string' },
    })
    assertEquals(index.defs.recipe.kind, true)
    assertStringIncludes(index.text, '## recipe (kind)\n\nserves')

    // One word whole: its entry as its vocab.json declares it, with an example
    // value; the markdown adds what points at it and the page that covers it.
    let mail = await said({ component: 'mail' })
    assertEquals(Object.keys(mail.defs), ['mail'])
    assertStringIncludes(mail.defs.mail.description!, 'envelope')
    assertEquals(mail.defs.mail.properties.verified.type, 'boolean')
    assertStringIncludes(
      mail.defs.mail.properties.verified.description!,
      'DKIM',
    )
    assertEquals(mail.defs.mail.before, ['doc'])
    assert('from' in mail.defs.mail.examples![0])
    assertStringIncludes(
      mail.text,
      'Documentation: https://yaks.app/docs/mail.md',
    )
    // What points at a letter, from anywhere in reach: its own `reply_to`,
    // which is how a thread hangs together.
    assertStringIncludes(mail.text, '- mail.reply_to')

    // A kind is what an entity of it is made of: the word itself, then the
    // index entry of each word it is shown with.
    let letter = await said({ kind: 'mail' })
    assertEquals(Object.keys(letter.defs), ['mail', 'doc'])

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

// The write door's schema is the caller's vocabulary (T-34153). Jeff, on an
// agent trying to send a letter with graph_apply: "how are agents supposed to
// learn our comp schema? claude was trying to send mail ... but is just
// guessing at the comp types". So the published input schema is checked here
// the way a client checks it — with a JSON Schema validator, against the
// letter bundle the guide teaches (public/docs/mail.md §Sending a letter).
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
          // What a tool list costs the agent that reads it, before it has asked
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
      // A property nobody declared is NOT refused by the schema (T-34277): a
      // client holds this copy for the whole conversation while the vocabulary
      // grows under it, so a closed schema would refuse a property that exists.
      // The schema describes; the server decides, and says which properties are
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
      assertStringIncludes(refused, 'unknown property: email.adress')
      assertStringIncludes(refused, 'email has address (string)')
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

      // A vocabulary grows mid-connection, and the schema a client is holding
      // goes stale with it — app_deploy plants the words and the next
      // `tools/list` is typed for them. The tool names did not move, so
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
        content: vocabFile({ recipe: { serves: num } }),
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
