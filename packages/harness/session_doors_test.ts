import { equal, ok, test } from '@yaks/testing'
import { transcript } from '@yaks/session'
import { loadTools } from '@yaks/graph/tools'
import { connect, result } from '../mcp/testing.ts'
import type { Bundle } from '@yaks/graph'
import { harness } from './testing.ts'
import { docs } from './vocab.ts'
import { runs } from './runs.ts'

test('MCP starts a native session and sends input without waiting for a runner', async () => {
  let host = await harness()
  let client = await connect({ graph: host.g, tools: loadTools(docs, runs()) })
  try {
    let listed = (await client.listTools()).tools.map((t) => t.name)
    ok(listed.includes('session_new') && listed.includes('session_send'))
    let started = await client.callTool({
      name: 'session_new',
      arguments: { prompt: 'First input', wait: false },
    })
    equal(started.isError, undefined)
    let [session] = result(started) as Bundle[]
    ok(session.session)
    let sent = await client.callTool({
      name: 'session_send',
      arguments: {
        session: session.entity.eid,
        text: 'Second input',
        wait: false,
      },
    })
    equal(sent.isError, undefined)
    let entries = await transcript(host.g, session.entity.eid)
    ok(
      entries.some((e) =>
        (e.content as { body?: string })?.body == 'First input'
      ),
    )
    ok(
      entries.some((e) =>
        (e.content as { body?: string })?.body == 'Second input'
      ),
    )
  } finally {
    await client.close()
    await host.close()
  }
})
