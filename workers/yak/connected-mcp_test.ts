// A person's MCP server on their own machine, asked the way their Operator
// asks it: through the tunnel of a space they own, to a stub machine behind a
// stub gateway.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { mint } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { fixture } from '../../packages/mcp-client/testing.ts'
import {
  connectedTools,
  mcpConnect,
  runConnectedCommand,
} from './connected-mcp.ts'
import { ctxOf } from './connections.ts'
import { platform } from './directory-probe.ts'
import { directoryOf, stamp } from './directory.ts'
import type { Env } from './env.ts'
import { operatorContext, operatorRoster } from './operator.ts'
import { operatorMemory } from './operator-testing.ts'

// The machine, and the gateway in the apps' namespace that reaches it while
// it is `up`.
let box = fixture(), up = true
let DISPATCH = {
  get: (name: string) => {
    if (!up) throw new Error(`Worker not found: ${name}`)
    return { fetch: (r: Request) => box.fetcher(r) }
  },
} as unknown as Env['DISPATCH']
let { env } = platform('machine-mcp', { DISPATCH })
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

// A turn of the space's Operator with `person`, in a fork of `talk`.
let talk = mint(), fork = mint()
let store = operatorMemory()
await store.g.apply([
  { entity: { eid: talk }, session: {} },
  { entity: { eid: fork }, session: {}, spawned: { parent: talk } },
], { trusted: true })
let turn = async (person: string) => {
  let ctx = await operatorContext(env, { person }, space, () => dir)
  let tools = await operatorRoster(ctx, store, { space: eid, session: fork })
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
      `(.integration.owner=${ada})|(.connection.owner=${ada})`,
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

test('a machine that cannot be reached reads as its server being unavailable', async () => {
  up = false
  let { run, named } = await turn(ada)
  up = true
  assertEquals(named, ['tasks__connection_status'])
  let out = await run('tasks__connection_status', {})
  assertEquals(JSON.stringify(out).includes('publish_mockup'), true)
})
