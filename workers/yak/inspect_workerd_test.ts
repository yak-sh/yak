// The shared store reads the terminal needs, including the actual runtime's
// socket upgrade, without journal history.
/// <reference lib="deno.ns" />
import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { bearerFor, connector, signIn, workerd } from './probe.ts'

test(
  'private app inspector schema and live reads use login bearer without history in workerd',
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
      let journal = await (await read(`._comp.name=_change`)).json()
      assertEquals(journal, [])
      let changes = await (await read(`.doc&.entity.eid=${eid}`)).json()
      assert(changes.some((b: { doc: { title?: string } }) =>
        b.doc.title == 'Runtime history'
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
            subscribe: `.doc&.entity.eid=${eid}`,
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
