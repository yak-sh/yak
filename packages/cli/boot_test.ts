// The whole thing, once: a config file naming plugins, their facets imported
// one subpath at a time, a scratch database, and the four endpoints answering
// over it. It costs a port and a file, so it runs under TASKS_SLOW rather than
// in the fast tier.
//
// The port is bound here rather than through the `serve` tool, because this is
// `compose` being tested and not that tool: what the tool adds — binding a
// port with the handler the config's own plugins built and recording the call
// for as long as it listens — is @yaks/api's own test. What this asserts of it
// is that a config naming that package gets the verb, and a handler at all.

import { assert, assertEquals } from '@std/assert'
import { compose, read } from './host.ts'

let slow = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, ignore: !Deno.env.get('TASKS_SLOW') })

// A port this box is not using, asked for and given back.
let free = (): number => {
  let l = Deno.listen({ port: 0 })
  let { port } = l.addr as Deno.NetAddr
  l.close()
  return port
}

slow(
  'a composed host answers on every endpoint, and carries the serve verb',
  async () => {
    let dir = Deno.makeTempDirSync()
    let port = free()
    Deno.writeTextFileSync(
      `${dir}/yak.json`,
      JSON.stringify({
        db: 'graph.db',
        plugins: ['@yaks/api', '@yaks/mcp', '@yaks/harness'],
        numbers: false,
        port,
      }),
    )
    let host = await compose(read(`${dir}/yak.json`))
    // The config named the package that hosts routes, so there is one.
    assert(host.handler, 'a config naming @yaks/api composed no handler')
    let server = Deno.serve({ port }, host.handler)
    let at = `http://localhost:${port}`
    try {
      // The tools are the vocabulary's declarations wearing the module's runs
      // — `serve` among them, contributed by the package in the config.
      let listed = await fetch(`${at}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      }).then((r) => r.json())
      let names = listed.result.tools.map((t: { name: string }) => t.name)
      assert(names.includes('session_list'), names.join(' '))
      assert(names.includes('graph_apply'), names.join(' '))
      assert(names.includes('serve'), names.join(' '))

      // A subscription hears about a write it did not make.
      let socket = new WebSocket(`ws://localhost:${port}/ws`)
      let frames: Record<string, unknown>[] = []
      socket.onmessage = (e) => frames.push(JSON.parse(e.data))
      await new Promise((ok) => socket.onopen = ok)
      socket.send(JSON.stringify({ subscribe: '.session', id: 's' }))

      let applied = await fetch(`${at}/apply`, {
        method: 'POST',
        body: JSON.stringify([{
          entity: { eid: 'boot-session' },
          session: { id: 'one' },
        }]),
      }).then((r) => r.json())
      // The endpoint signs the batch with this process, which is the floor
      // where no plugin named a caller.
      assertEquals(applied[0].created.by, host.me)

      let found = await fetch(`${at}/query?q=.session`).then((r) => r.json())
      assertEquals(found[0].entity.eid, 'boot-session')
      // A status the store computes rather than keeps, answered over HTTP.
      assertEquals(found[0].session.status, 'empty')

      let heard = await until(() =>
        frames.some((f) =>
          f.id == 's' &&
          (f.bundles as { entity: { eid: string } }[])
            .some((b) => b.entity.eid == 'boot-session')
        )
      )
      assert(heard, JSON.stringify(frames))
      socket.close()
    } finally {
      await server.shutdown()
      await host.close()
      Deno.removeSync(dir, { recursive: true })
    }
  },
)

// Poll for a fact instead of guessing a duration.
let until = async (said: () => boolean, ms = 2000): Promise<boolean> => {
  let end = Date.now() + ms
  while (Date.now() < end) {
    if (said()) return true
    await new Promise((go) => setTimeout(go, 10))
  }
  return said()
}
