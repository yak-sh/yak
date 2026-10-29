import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient, resultUrl } from '../src/client'
import { MCPClient } from '../src/transport'

test('all commands share authenticated tools/call and preserve words/project', async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = []
  const wrap = (value: unknown) => [
    { entity: { eid: 'reply' }, content: { body: JSON.stringify(value) } },
  ]
  const answers: Record<string, unknown> = {
    conversation_projects: wrap({
      owner: 'jeff',
      projects: [{ id: 'project', title: 'Yak' }],
    }),
    conversation_start: wrap({
      session: 'session',
      project: 'project',
      status: 'pending',
    }),
    conversation_send: wrap({
      session: 'session',
      project: 'project',
      status: 'pending',
    }),
    conversation_read: wrap({
      session: 'session',
      project: 'project',
      status: 'running',
      messages: [
        { id: 'input', role: 'user', text: 'my exact words\n' },
        {
          id: 'reply',
          role: 'assistant',
          text: 'arriving…',
        },
      ],
    }),
    conversation_recent: wrap({
      conversations: [
        {
          session: 'session',
          project: 'project',
          status: 'running',
          title: 'my exact words',
        },
      ],
    }),
    graph_query: [
      {
        entity: { eid: 'task' },
        doc: { title: 'A task', body: 'Found it' },
      },
    ],
    conversation_inbox: [
      {
        entity: { eid: 'decision' },
        doc: { title: 'An ask' },
      },
    ],
  }
  const request = (async (input, init) => {
    const request = new Request(input, init)
    assert.equal(request.headers.get('authorization'), 'Bearer probe-only')
    const rpc = await request.json()
    if (rpc.method === 'initialize') {
      return Response.json({
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          serverInfo: { name: 'private-probe', version: '1' },
        },
      })
    } else if (rpc.method === 'notifications/initialized') {
      return new Response(null, { status: 202 })
    } else {
      assert.equal(rpc.method, 'tools/call')
      calls.push(rpc.params)
      const value = answers[rpc.params.name]
      assert.ok(value, rpc.params.name)
      return Response.json({
        jsonrpc: '2.0',
        id: rpc.id,
        result: { content: [{ type: 'text', text: JSON.stringify(value) }] },
      })
    }
  }) as typeof fetch
  {
    const transport = new MCPClient({
      endpoint: 'https://probe.invalid/mcp',
      request: (url, options) =>
        request(url, {
          ...options,
          headers: {
            ...Object.fromEntries(new Headers(options?.headers)),
            authorization: 'Bearer probe-only',
          },
        }),
    })
    const client = createClient(transport.call.bind(transport))
    assert.deepEqual(await client.projects(), [
      {
        id: 'project',
        title: 'Yak',
      },
    ])
    assert.deepEqual(await client.drop('my exact words\n', 'project'), {
      id: 'session',
    })
    assert.equal(
      (await client.conversation('session', 'project')).messages[1].text,
      'arriving…',
    )
    await client.send('session', 'more\nwords', 'project')
    assert.equal((await client.recent('project'))[0].id, 'session')
    assert.equal((await client.search('.task & x"'))[0].id, 'task')
    assert.equal((await client.inbox())[0].id, 'decision')
    assert.equal(
      calls.find((c) => c.name === 'conversation_start')?.arguments.prompt,
      'my exact words\n',
    )
    assert.deepEqual(
      calls.find((c) => c.name === 'conversation_send')?.arguments,
      { session: 'session', project: 'project', text: 'more\nwords' },
    )
    assert.equal(
      calls.find((c) => c.name === 'graph_query')?.arguments.q,
      '".task & x\\"" ?doc .limit=50',
    )
    assert.equal(
      resultUrl('#a83446de17'),
      'https://tasks.yak.sh/a83446de17',
    )
    await assert.rejects(client.drop(' \n', 'project'), /Say something/)
    await assert.rejects(
      client.send('session', '', 'project'),
      /Say something/,
    )
    assert.deepEqual(await client.search(''), [])
  }
})

test('malformed conversation response is not accepted as a successful drop', async () => {
  const client = createClient(<T>() => Promise.resolve([] as T))
  await assert.rejects(
    client.drop('do not lose this', 'project'),
    /did not return/,
  )
})
