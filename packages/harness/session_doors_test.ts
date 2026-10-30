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
    let listed = (await client.listTools()).tools.map((t: { name: string }) =>
      t.name
    )
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

test('a message to a session marked over clears the mark, so it runs', async () => {
  let host = await harness()
  let client = await connect({ graph: host.g, tools: loadTools(docs, runs()) })
  let status = async (eid: string) => {
    let [row] = await host.g.get([eid])
    return row.session as { ended?: boolean; status: string }
  }
  try {
    let [session] = result(
      await client.callTool({
        name: 'session_new',
        arguments: { prompt: 'First input', wait: false },
      }),
    ) as Bundle[]
    let eid = session.entity.eid
    await host.g.apply([{ entity: { eid }, session: { ended: true } }])
    equal((await status(eid)).status, 'stopped')
    let sent = await client.callTool({
      name: 'session_send',
      arguments: { session: eid, text: 'Second input', wait: false },
    })
    equal(sent.isError, undefined)
    equal((await status(eid)).ended, undefined)
    equal((await status(eid)).status, 'pending')
  } finally {
    await client.close()
    await host.close()
  }
})
