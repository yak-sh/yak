// Actual MCP/HTTP probe for the Raycast client. It composes an in-memory graph
// and fake native runner only; no box config, live graph or provider is opened.
import { conversationFixture } from './conversations_testing.ts'
import { working } from './testing.ts'

let fixture = await conversationFixture()
await fixture.h.g.apply([{
  entity: { eid: crypto.randomUUID() },
  task: {},
  filed: { project: fixture.project, assignee: fixture.owner },
  doc: { title: 'Raycast probe inbox' },
}])
let runner = working(fixture.h, {
  tools: [],
  model: () =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: 'fake',
      items: [{ kind: 'assistant', text: 'Native probe reply' }],
    }),
})
let server = Deno.serve({
  hostname: '127.0.0.1',
  port: 0,
  onListen: ({ port }) =>
    console.log(JSON.stringify({ port, project: fixture.project })),
}, (request) => {
  if (request.headers.get('authorization') != 'Bearer probe-only') {
    return new Response(null, { status: 401 })
  }
  return fixture.handler(request)
})
let close = async () => {
  await server.shutdown()
  await runner.stop()
  await fixture.h.close()
}
Deno.addSignalListener('SIGTERM', () => void close())
Deno.addSignalListener('SIGINT', () => void close())
await server.finished
