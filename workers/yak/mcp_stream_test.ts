// MCP workerd probes, split by subject so Deno can run the modules in parallel.
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'
import { slow, until } from '../../src/testing.ts'
import { connector, kernel, seed, signIn } from './probe.ts'
import { hearing, HELLO } from './mcp-probe.ts'

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

    // An app of his own, whose VIEWS are what move — the one list an app's
    // deploy still moves, now that its commands are not tools (T-34541).
    let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/
      .exec(await agent.tool('app_new', { slug: 'walks', title: 'Walks' }))![1]
    let tools = (view: string) =>
      JSON.stringify({
        log_walk: {
          description: 'Every walk so far',
          input: {},
          query: '.walk!',
          view,
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
        { path: 'walks.html', content: '<!doctype html><ol id=board>' },
        { path: 'tools.json', content: tools('walks.html') },
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
    let moved = async (view: string) => {
      await agent.tool('app_files', {
        space,
        app: 'walks',
        files: [
          { path: view, content: '<!doctype html><ol id=board>' },
          { path: 'tools.json', content: tools(view) },
        ],
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
    await moved('board.html')
    await until(() => lines(ear!.said()).length == 1, {
      timeout: 10_000,
      poll: 50,
      label: 'the deploy to reach the stream',
    })
    let first = lines(ear.said())[0]
    assertStringIncludes(first.data, 'notifications/resources/list_changed')

    // The connection drops, and the next deploy has nobody to write to. The
    // object keeps the line anyway.
    await ear.stop()
    ear = undefined
    await moved('far.html')

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
    assertStringIncludes(back[0].data, 'notifications/resources/list_changed')
  } finally {
    await ear?.stop()
    await k.stop()
  }
})

// The ROSTER (T-34277, T-34541). Jeff: "is there anything else we can do about
// claude having stale mcp tools?" The answer arrived at is that the list does
// not move: a person's apps, their words and their commands all travel inside
// tools that are always there, so a client's cached list stays right. `about`
// still says what is here right now — the tools, the version naming them, and
// the apps in reach with their commands.
slow(
  'a deploy leaves the roster where it was, and about says what is here',
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
      assertStringIncludes(first, 'commands, command')

      // An app of his own declares a command, and the deploy plants it —
      // beside the two the `jog` it declares is worth (kinds.ts, T-34513).
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

      // And the next reply is one block: nothing moved, so nothing is said.
      // The client's cached list is still the list, which is what a directory
      // serving a snapshot of it needs to be true.
      let told = await agent.call('tools/call', {
        name: 'app_list',
        arguments: {},
      })
      assertEquals((told.content as unknown[]).length, 1)

      // `about` still settles what is here without reconnecting: the same
      // version, and the apps in reach with the commands they grew.
      let now = await agent.tool('about')
      assertStringIncludes(now, `roster ${version}`)
      assertStringIncludes(now, 'Commands: log_run, add_jog, find_jog')
    } finally {
      await k.stop()
    }
  },
)

// A release that moved a VIEW says so (T-33004): the pages an app's commands
// draw their answers in are what resources/list is made of, and a client
// holding that list is told on the stream. The tool list is not told about,
// because it did not move — an app's commands are not tools (T-34541).
slow(
  'a release whose views moved says resources, and never tools',
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
      // The view appears; the tool list stands still.
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
