// The shared store reads the terminal needs, including the actual runtime's
// socket upgrade and SQLite computed journal backing.
/// <reference lib="deno.ns" />
import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { bearerFor, connector, signIn, workerd } from './probe.ts'

test(
  'private app inspector schema and live history use login bearer in workerd',
  async () => {
    let k = await workerd()
    try {
      let owner = await signIn(k)
      let agent = connector(k, owner.cookie)
      await agent.tool('app_new', {
        slug: 'inspect',
        title: 'Inspector',
        access: 'private',
      })
      let token = await bearerFor(k, owner.cookie)
      let space = owner.email.split('@')[0]
      let headers = { authorization: `Bearer ${token}` }
      let address = await k.at(k.host, `/api/app?app=${space}/inspect`, {
        headers,
      })
      assertEquals(address.status, 200)
      let read = (line: string) =>
        k.at(
          `${space}.${k.host}`,
          `/inspect/api/query?q=${encodeURIComponent(line)}&live=1`,
          { headers },
        )
      let [schema] = await (await read('._comp.name=doc')).json()
      assert(schema.entity.eid)
      let props = await (await read(`._prop.comp=${schema.entity.eid}`)).json()
      assert(
        props.some((b: { _prop: { name: string } }) => b._prop.name == 'title'),
      )
      let applied = JSON.parse(
        await agent.tool('graph_apply', {
          app: 'inspect',
          entities: [{
            entity: { eid: '$one' },
            doc: { title: 'Runtime history' },
          }],
        }),
      )
      let eid = applied.find((b: { $alias?: string }) =>
        b.$alias == '$one'
      ).entity.eid
      let changes = await (await read(`._change.target=${eid}`)).json()
      assert(changes.some((b: { _change: { value?: { title?: string } } }) =>
        b._change.value?.title == 'Runtime history'
      ))
      let Socket = WebSocket as unknown as {
        new (
          url: string,
          options: { headers: Record<string, string> },
        ): WebSocket
      }
      let socket = new Socket(
        `${k.base.replace('http:', 'ws:')}/inspect/api/ws`,
        {
          headers: { ...headers, 'x-yak-host': `${space}.${k.host}` },
        },
      )
      let frames: { id: string; refused?: unknown; bundles?: unknown[] }[] = []
      socket.addEventListener('message', (e) =>
        frames.push(JSON.parse(e.data)))
      try {
        await until(() => socket.readyState == WebSocket.OPEN, {
          timeout: 5000,
        })
        socket.send(
          JSON.stringify({
            subscribe: `._change.target=${eid}`,
            id: 'history',
          }),
        )
        await until(() => frames.some((f) => f.id == 'history'), {
          timeout: 5000,
        })
        let history = frames.find((f) => f.id == 'history')!
        assertEquals(history.refused, undefined)
        assertEquals(history.bundles?.length, changes.length)
      } finally {
        socket.close()
      }
    } finally {
      await k.stop()
    }
  },
  { tags: ['workerd'] },
)
