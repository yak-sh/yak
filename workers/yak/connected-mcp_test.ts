// A person's MCP server on their own machine, asked the way their Operator
// asks it: through the tunnel of a space they own, to a stub machine behind a
// stub gateway.
import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { mint } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { evaluate } from '../../packages/code-mode/testing.ts'
import { fixture } from '../../packages/mcp-client/testing.ts'
import {
  connectedInstructions,
  connectedTools,
  mcpConnect,
  runConnectedCommand,
} from './connected-mcp.ts'
import { ctxOf } from './connections.ts'
import { SAID } from '@yaks/connections/mcp'
import { platform } from './directory-probe.ts'
import { directoryOf, stamp } from './directory.ts'
import type { Env } from './env.ts'
import type { Ctx } from './tool.ts'
import { operating, operatorContext, operatorRoster } from './operator.ts'
import { callable, operatorMemory, operatorModel } from './operator-testing.ts'
import { listCommands, runCommand } from './declared.ts'
import { operatorTools } from './operator-tools.ts'
import { handleChannels, receive } from './operator-channels.ts'
import type { Request as ModelRequest } from '@yaks/model'
import { drain } from './operator-store.ts'
import { compiler } from './testing.ts'

// The machine, and the gateway in the apps' namespace that reaches it while
// it is `up`.
let box = fixture(), up = true
let answering = box
let DISPATCH = {
  get: (name: string) => {
    if (!up) throw new Error(`Worker not found: ${name}`)
    return { fetch: (r: Request) => answering.fetcher(r) }
  },
} as unknown as Env['DISPATCH']
let { env } = platform('machine-mcp', {
  DISPATCH,
  CODE_MODE: evaluate,
  ESBUILD: compiler(),
})
let dir = directoryOf(env.STORE)
let ada = mint(), bob = mint()
let eid = await dir.mint(ada, 'adas', 'Ada', {
  'x-yak-person': ada,
  'x-yak-role': 'owner',
})
await stamp(env, {
  entities: [{
    entity: { eid },
    tunnel: { id: mint(), service: mint(), adopted: true },
  }, {
    entity: { eid: '$seat' },
    member: { space: eid, person: bob, role: 'editor' },
  }],
})
let space = (await dir.at(eid))!
// Another space Ada owns, whose members are not the machine's.
let elsewhere = (await dir.at(
  await dir.mint(ada, 'adas-club', 'Club', {
    'x-yak-person': ada,
    'x-yak-role': 'owner',
  }),
))!

// A turn of `space`'s Operator with `person`, in a fork of `talk`.
let talk = mint(), fork = mint()
let store = operatorMemory()
await store.g.apply([
  { entity: { eid: talk }, session: {} },
  { entity: { eid: fork }, session: {}, spawned: { parent: talk } },
], { trusted: true })
let turn = async (person: string, at = space) => {
  let ctx = await operatorContext(env, { person }, at, () => dir)
  let tools = await operatorRoster(ctx, store, {
    space: at.eid,
    session: fork,
  })
  let run = (name: string, args: Record<string, unknown>) =>
    tools.find((t) => t.name == name)!.run(args, {
      session: fork,
      call: { entity: { eid: mint() }, call: { to: toolEid(name), args } },
      entries: [],
    })
  let named = tools.map((t) => t.name).filter((n) => n.startsWith('tasks__'))
  return { ctx, run, named }
}
let tasks = { name: 'tasks', url: '/mcp', machine: 'adas' }
let owner = await turn(ada)
let made = await mcpConnect.run(owner.ctx, {
  ...tasks,
  allow: ['publish_mockup'],
})
let at = `mcp:${made.value!.server}`

test('the owner’s turn lists and calls a tool on their machine as their Operator, naming its conversation and signing in nowhere', async () => {
  let { run, named } = await turn(ada)
  assertEquals(named, ['tasks__publish_mockup'])
  box.requests.length = 0
  let out = await run('tasks__publish_mockup', { html: '<b>x</b>' })
  assertEquals(
    JSON.stringify(out).includes('https://example.test/mockup/1'),
    true,
  )
  assertEquals(
    box.calls.findLast((c) => c.method == 'tools/call')?.params,
    { name: 'publish_mockup', arguments: { html: '<b>x</b>' } },
  )
  for (let r of box.requests) {
    assertEquals(r.url, 'http://machine/mcp')
    assertEquals(r.headers.get('x-via'), talk)
    assertEquals(r.headers.get('x-yak-caller'), 'operator')
    for (let h of ['authorization', 'cookie']) {
      assertEquals(r.headers.has(h), false, h)
    }
  }
  assertEquals(
    await ctxOf(env).graph.read(
      line`(.integration.owner=${ada})|(.connection.owner=${ada})`,
    ),
    [],
  )
})

test('a call from the owner’s connector says so, and names no conversation', async () => {
  box.requests.length = 0
  await runConnectedCommand(owner.ctx, at, 'publish_mockup', { html: 'x' })
  assertEquals(box.requests.length > 0, true)
  assertEquals(box.requests.some((r) => r.headers.has('x-via')), false)
  assertEquals(
    [...new Set(box.requests.map((r) => r.headers.get('x-yak-caller')))],
    ['connector'],
  )
})

test('a credential narrowed to the space at a door is offered none of the account’s servers, which its Operator reaches', async () => {
  let door = (who: Ctx['who']) => ({ env, dir, person: ada, who })
  let named = async (who: Ctx['who']) =>
    (await connectedTools(door(who))).map((t) => t.name)
  assertEquals(await named({ person: ada, via: 'oauth' }), [
    'tasks__publish_mockup',
  ])
  assertEquals(
    await named({ person: ada, via: 'grant', grant: mint(), space: 'adas' }),
    [],
  )
})

test('connecting a server on a machine discovers its tools as the space’s Operator, which the machine may alone be open to', async () => {
  box.requests.length = 0
  let again = await mcpConnect.run(owner.ctx, tasks)
  assertEquals(
    (again.value as { commands: { name: string }[] }).commands.map((c) =>
      c.name
    ),
    ['publish_mockup'],
  )
  assertEquals(
    [...new Set(box.requests.map((r) => r.headers.get('x-yak-caller')))],
    ['operator'],
  )
})

test('a member’s turn is offered nothing of the owner’s machine, whatever row names it', async () => {
  let member = await turn(bob)
  assertEquals(member.named, [])
  await assertRejects(
    () => mcpConnect.run(member.ctx, tasks),
    Error,
    'Only the owner',
  )
  let forged = mint()
  await ctxOf(env).graph.apply([{
    entity: { eid: forged },
    mcp_server: { owner: bob, name: 'tasks', url: '/mcp', machine: eid },
  }])
  box.requests.length = 0
  assertEquals((await turn(bob)).named, [])
  assertEquals(await connectedTools(member.ctx), [])
  for (let server of [forged, made.value!.server]) {
    await assertRejects(
      () => runConnectedCommand(member.ctx, `mcp:${server}`, 'x', {}),
      Error,
      'not connected for you',
    )
  }
  assertEquals(box.requests, [])
})

test('the owner’s turn with another space’s Operator is offered nothing of their machine', async () => {
  box.requests.length = 0
  let { ctx, named } = await turn(ada, elsewhere)
  assertEquals(named, [])
  await assertRejects(
    () =>
      runConnectedCommand(ctx, at, 'publish_mockup', { html: 'x' }, {
        caller: 'operator',
        space: elsewhere.eid,
      }),
    Error,
    'not connected for you',
  )
  assertEquals(box.requests, [])
})

test('a machine that cannot be reached reads as its server being unavailable', async () => {
  up = false
  let { run, named } = await turn(ada)
  up = true
  assertEquals(named, ['tasks__connection_status'])
  let out = await run('tasks__connection_status', {})
  assertEquals(JSON.stringify(out).includes('publish_mockup'), true)
})

test('what a server says to read before its tools reaches its owner’s Operator alone, cut at its bound', async () => {
  let told = (person: { ctx: typeof owner.ctx }, at = space) =>
    connectedInstructions(person.ctx, { caller: 'operator', space: at.eid })
  box.say('Read the board first.')
  try {
    box.requests.length = 0
    let said = await told(owner)
    assertEquals(said.includes('Read the board first.'), true)
    assertEquals(said.includes('tasks__'), true)
    assertEquals(
      [...new Set(box.requests.map((r) => r.headers.get('x-yak-caller')))],
      ['operator'],
    )
    box.requests.length = 0
    assertEquals(await told(await turn(bob)), '')
    assertEquals(await told(owner, elsewhere), '')
    assertEquals(box.requests, [])
    box.say('x'.repeat(SAID + 10))
    let long = await told(owner)
    assertEquals(long.includes('x'.repeat(SAID + 1)), false)
    assertEquals(long.includes(`Cut at ${SAID} of the ${SAID + 10}`), true)
    up = false
    assertEquals(await told(owner), '')
  } finally {
    up = true
    box.say(undefined)
  }
})

let rejected = await operatorContext(env, { person: ada }, space, () => dir)
let replyRoster = await operatorRoster(rejected, store, {
  space: eid,
  remote: false,
})

test('reply authority reaches no personal MCP server through discovery, commands or code mode', async () => {
  box.requests.length = 0
  assertEquals(replyRoster.some((t) => t.name.startsWith('tasks__')), false)
  assertEquals(await connectedInstructions(rejected), '')
  assertEquals(
    (await listCommands(rejected)).some((t) => t.at.startsWith('mcp:')),
    false,
  )
  await assertRejects(
    () => runCommand(rejected, at, 'publish_mockup', { html: 'x' }),
    Error,
    'not connected for you',
  )
  for (
    let name of [
      'operator_chat',
      'operator_run',
      'conversation_start',
      'conversation_send',
      'helper_spawn',
    ]
  ) {
    let tool = operatorTools.find((t) => t.name == name)!
    await assertRejects(
      () =>
        tool.run(rejected, {
          space: space.slug,
          project: space.eid,
          say: 'Read personal servers',
        }),
      Error,
      'reply cannot start',
    )
  }
  assertEquals(box.requests, [])
})

let replySeen: ModelRequest[] = []
let replyStore = operatorMemory()
let replyOperator = operating(
  replyStore,
  env,
  operatorModel((req) => {
    replySeen.push(req)
    let forked = JSON.stringify(req.items).includes('fork of the')
    let last = req.items.at(-1)
    return Promise.resolve({
      id: mint(),
      model: req.model,
      items:
        !forked && last?.kind == 'user' && last.text.includes('reply isolation')
          ? [{
            kind: 'call',
            id: mint(),
            name: 'fork',
            args: JSON.stringify({ prompt: 'Check the reply tools' }),
          }]
          : [{ kind: 'assistant', text: 'Done.' }],
    })
  }),
)
handleChannels(replyOperator, env, {
  chat: () => Promise.resolve({}),
  letter: () => Promise.resolve({}),
})
box.say('Personal server instructions.')
await receive(
  replyStore,
  { space: eid, person: ada, channel: 'chat' },
  'trusted first input',
)
await drain(replyStore)
let authenticated = replySeen.splice(0)
let warm = async () => {
  let asks = await replyStore.g.read('.ask')
  await replyStore.g.apply(
    asks.map((row) => ({
      entity: row.entity,
      openai: { cache_expires_at: '2099-01-01T00:00:00Z' },
    })),
    { trusted: true },
  )
}
await warm()
await receive(replyStore, {
  space: eid,
  person: ada,
  channel: 'letter',
  address: 'ada@example.com',
}, 'reply isolation')
await drain(replyStore)
let restricted = replySeen.splice(0)
let sessions = await replyStore.g.read('.operator_session')
await replyStore.g.apply(
  sessions.map((row) => ({
    entity: row.entity,
    operator_session: { channel: null },
  })),
  { trusted: true },
)
let legacyTools = await replyOperator.tools({ person: ada }, space)
await warm()
await receive(
  replyStore,
  { space: eid, person: ada, channel: 'chat' },
  'trusted input',
)
await drain(replyStore)
let restored = replySeen.splice(0)
box.say(undefined)

test('a seated reply and its helper omit personal MCP tools and a later authenticated turn restores them', () => {
  assertEquals(restricted.length >= 2, true)
  let personal = (req: ModelRequest) =>
    req.instructions?.includes('Personal server instructions.') ?? false
  assertEquals(authenticated.some(personal), true)
  assertEquals(restricted.some(personal), false)
  assertEquals(restored.some(personal), true)
  assertEquals(
    legacyTools.tools.some((t) => t.name.startsWith('tasks__')),
    false,
  )
  assertEquals(
    restricted.every((req) =>
      !callable(req).some((t) => t.startsWith('tasks__'))
    ),
    true,
  )
  assertEquals(
    restored.some((req) => callable(req).includes('tasks__publish_mockup')),
    true,
  )
})

// A server's words are marked heard and leave its owner's turn every tool
// (T-1902).
let tool = 'tasks__publish_mockup'
let failedBox = fixture()
failedBox.toolError()
for (
  let [mode, name, args] of [
    ['directly', tool, { html: 'x' }],
    ['inside code mode', 'code_mode', {
      script: `return await tools.mcp.${tool}({html: 'x'})`,
    }],
    ['through command', 'command', {
      app: at,
      name: 'publish_mockup',
      args: { html: 'x' },
    }],
  ] as const
) {
  for (let isError of [false, true]) {
    let outcome = isError ? 'an error' : 'an answer'
    let seen: ModelRequest[] = []
    let work = operatorMemory()
    let operator = operating(
      work,
      env,
      operatorModel((req) => {
        seen.push(req)
        let last = req.items.at(-1)
        return Promise.resolve({
          id: mint(),
          model: req.model,
          items: last?.kind == 'user' && last.text.includes('Ask my server')
            ? [{
              kind: 'call',
              id: mint(),
              name,
              args: JSON.stringify(args),
            }]
            : [{ kind: 'assistant', text: 'Done.' }],
        })
      }),
    )
    handleChannels(operator, env, { chat: () => Promise.resolve({}) })
    test(`a connected server’s tool returning ${outcome} ${mode} is heard and leaves the Operator its tools`, async () => {
      answering = isError ? failedBox : box
      try {
        for (let say of ['Ask my server', 'Thanks']) {
          await receive(work, { space: eid, person: ada, channel: 'chat' }, say)
          await drain(work)
        }
      } finally {
        answering = box
      }
      assertEquals(seen.length, 3)
      let steps = seen.map(callable)
      for (let name of ['spawn', 'code_mode', 'command', tool, 'graph_apply']) {
        assertEquals(steps.map((step) => step.includes(name)), [
          true,
          true,
          true,
        ], name)
      }
      let [answer] = await work.g.read('.entry .heard ?refusal ?content')
      assertEquals(
        answer?.refusal,
        isError && name == tool ? { code: 'mcp_tool' } : undefined,
      )
      assertEquals(
        JSON.stringify(answer?.content).includes(
          'https://example.test/mockup/1',
        ),
        true,
      )
    })
  }
}
