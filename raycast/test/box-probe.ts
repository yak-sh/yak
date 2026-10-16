// Run against conversations_probe.ts only, never a live graph. This drives the
// same client functions as the native commands against the real box packages.
import assert from 'node:assert/strict'
import { MCPClient } from '../src/transport'
import { createClient, resultUrl } from '../src/client'

async function main() {
  const port = Number(process.env.YAK_PROBE_PORT)
  assert.ok(
    Number.isInteger(port) && port > 0 && port < 65536,
    'YAK_PROBE_PORT is required',
  )
  const transport = new MCPClient({
    endpoint: `http://127.0.0.1:${port}/mcp`,
    request: (url, init) => {
      const headers = new Headers(init?.headers)
      headers.set('authorization', 'Bearer probe-only')
      return fetch(url, { ...init, headers })
    },
  })
  const client = createClient(transport.call.bind(transport))
  const project = (await client.projects()).find(
    (p) => p.title === 'Probe project',
  )?.id
  assert.ok(project)
  const { id } = await client.drop(
    'Exact probe input\nwith a second line',
    project,
  )
  let page = await client.conversation(id, project)
  assert.equal(page.messages[0].text, 'Exact probe input\nwith a second line')
  const deadline = Date.now() + 10_000
  while (!page.messages.some((m) => m.text === 'Native probe reply')) {
    assert.ok(Date.now() < deadline, 'native probe reply deadline')
    page = await client.conversation(id, project)
  }
  await client.send(id, 'Exact follow-up', project)
  assert.ok(
    (await client.conversation(id, project)).messages.some(
      (m) => m.text === 'Exact follow-up',
    ),
  )
  assert.ok((await client.recent(project)).some((c) => c.id === id))
  assert.equal((await client.conversation(id, project)).id, id)
  assert.ok(
    (await client.search('Recent probe work')).some(
      (r) => r.title === 'Recent probe work',
    ),
  )
  assert.ok(
    (await client.inbox()).some((r) => r.title === 'Raycast probe inbox'),
  )
  assert.equal(resultUrl(id), `https://tasks.yak.sh/${id}`)
  console.log(
    'PASS: drop, read native reply, follow-up, recent/reopen, search/open URL, inbox through actual MCP HTTP probe',
  )
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
