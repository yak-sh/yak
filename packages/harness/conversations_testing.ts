// Conversation behavior at the authenticated MCP door, using scratch in-memory
// graphs and fake native replies. No provider or live graph is contacted.
import { assertEquals } from '@std/assert'
import { loadTools } from '@yaks/graph/tools'
import { mcp } from '@yaks/mcp'
import { conversations } from './conversations.ts'
import { docs } from './vocab.ts'
import { runs } from './runs.ts'
import { at } from './testing.ts'
import { compose } from '@yaks/cli/host'
import { hosted } from './store.ts'
import { HARNESS } from './default.ts'

export let conversationFixture = async () => {
  let config = at()
  config.plugins = [...config.plugins!, '@yaks/goal']
  let host = await compose(config, ['graph'])
  let h = hosted(host, () => host.close())
  await h.g.apply([
    { entity: { eid: '$model' }, model: { name: 'fake' } },
    { entity: { eid: '$provider' }, provider: { name: 'openai' } },
    {
      entity: { eid: '$serves' },
      edge: { from: '$provider', to: '$model' },
      serves: { name: 'fake' },
    },
    {
      entity: { eid: HARNESS },
      using: { provider: '$provider', model: '$model' },
    },
  ], { trusted: true })
  let owner = crypto.randomUUID(), other = crypto.randomUUID()
  let project = crypto.randomUUID(), elsewhere = crypto.randomUUID()
  let persona = crypto.randomUUID()
  await h.g.apply([
    { entity: { eid: owner }, person: {}, doc: { title: 'Probe owner' } },
    { entity: { eid: other }, person: {} },
    { entity: { eid: project }, project: {}, doc: { title: 'Probe project' } },
    { entity: { eid: elsewhere }, project: {}, doc: { title: 'Elsewhere' } },
    {
      entity: { eid: persona },
      persona: { home: project },
      doc: { title: 'Probe persona', body: 'Help this project gently.' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      edge: { from: project, to: persona },
      contains: {},
    },
    {
      entity: { eid: crypto.randomUUID() },
      goal: { scope: project },
      doc: { title: 'Make talking easy' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      task: {},
      filed: { project },
      doc: { title: 'Recent probe work' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      filed: { project },
      content: { body: 'Owner across another door' },
      $actor: { by: owner },
    },
    {
      entity: { eid: crypto.randomUUID() },
      filed: { project: elsewhere },
      content: { body: 'Private elsewhere words' },
      $actor: { by: owner },
    },
  ])
  let imported = crypto.randomUUID(), agent = crypto.randomUUID()
  await h.g.apply([
    {
      entity: { eid: imported },
      session: { id: imported, actor: owner, operator: true },
      filed: { project },
    },
    {
      entity: { eid: agent },
      session: { id: agent, actor: owner, operator: false },
      filed: { project },
    },
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session: imported },
      content: { body: 'Imported human words' },
      $actor: { by: imported, via: imported },
    },
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session: agent },
      content: { body: 'Agent is not owner' },
      $actor: { by: owner, via: agent },
    },
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session: imported },
      content: { body: 'Model is not owner' },
      output: { source: imported },
      $actor: { by: imported, via: imported },
    },
  ])
  let run = conversations({ me: h.me, config: { person: owner } })
  let tools = loadTools(docs, { ...runs(), ...run }).filter((t) =>
    t.name.startsWith('conversation_')
  )
  let handler = mcp({
    graph: h.g,
    sessions: h.g,
    tools,
    authenticate: () => ({ by: h.me, via: h.me }),
  })
  let request = async (name: string, args: Record<string, unknown> = {}) => {
    let res = await handler(
      new Request('http://127.0.0.1/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-03-26',
          'X-Via': 'yak-raycast',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      }),
    )
    let body = await res.json()
    return body.result as {
      isError?: boolean
      content: { type: string; text: string }[]
    }
  }
  let call = async (name: string, args: Record<string, unknown> = {}) => {
    let result = await request(name, args)
    assertEquals(result.isError, undefined, JSON.stringify(result))
    return JSON.parse(
      result.content.filter((c) => c.type == 'text').map((c) => c.text).join(
        '',
      ),
    )
  }
  return {
    h,
    handler,
    run,
    request,
    call,
    owner,
    other,
    project,
    elsewhere,
    persona,
  }
}
