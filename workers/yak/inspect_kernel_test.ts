// The inspector reads private app schema and data with its login bearer.
/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { bearerFor, connector, kernel, signIn } from './probe.ts'

test(
  'private app inspector reads use login bearer without history',
  async () => {
    let k = await kernel()
    try {
      let owner = await signIn(k)
      let agent = connector(k, owner.cookie)
      await agent.tool('app_new', {
        slug: 'inspect',
        title: 'Inspector',
        access: 'private',
      })
      await agent.tool('app_files', {
        app: 'inspect',
        op: 'write',
        files: [
          { path: 'index.html', content: '<h1>Inspector</h1>' },
          { path: 'vocab.json', content: JSON.stringify({ $defs: {} }) },
        ],
      })
      await agent.tool('app_deploy', { app: 'inspect' })
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
    } finally {
      await k.stop()
    }
  },
)
