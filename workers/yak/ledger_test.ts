// App-addressed patches pass through the invocation ledger before routing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { ledger } from './ledger.ts'

test('the ledger forwards an app-addressed content-only patch', async () => {
  let vocab = loadVocab([{
    $defs: {
      content: {
        component: true,
        type: 'object',
        properties: { body: { type: 'string' } },
      },
    },
  }])
  let host = graph({ vocab, storage: ram(vocab) })
  let sent: Bundle[] = []
  let door = ledger({
    ...host,
    apply: async (batch, opts) => {
      sent = batch
      return host.apply(batch.map(({ $app: _, ...rest }) => rest), opts)
    },
  })
  let patch = {
    entity: { eid: '00000000-0000-4000-8000-000000000001' },
    $app: 'yourname/vale',
    content: { body: 'updated builder prompt' },
  }
  await door.apply([patch])
  assertEquals(sent, [patch])
  assertEquals((await host.get([patch.entity.eid]))[0].content, patch.content)
  await door.apply([{
    entity: { eid: '00000000-0000-4000-8000-000000000002' },
    content: { body: 'invocation answer' },
  }])
  assertEquals(sent, [patch])
})
