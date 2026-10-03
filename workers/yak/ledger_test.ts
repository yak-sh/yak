// App-addressed patches pass through the invocation ledger before routing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { spineDoc } from '@yaks/kernel/vocab'
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
    apply: (batch, opts) => {
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

// The caller's app has no invocation vocabulary: bookkeeping must never land
// there, while the data a tool wrote must still pass through.
let app = () => {
  let vocab = loadVocab([spineDoc, {
    $defs: {
      doc: {
        component: true,
        properties: { title: { type: 'string' } },
      },
    },
  }])
  return graph({ vocab, storage: ram(vocab) })
}

test('the invocation ledger keeps refusals out of caller data', async () => {
  let host = app(), door = ledger(host)
  for (let failure of ['refusal']) {
    await door.apply([{
      entity: { eid: failure },
      [failure]: { code: 'invalid' },
      content: { body: 'Invalid arguments' },
      result: { call: 'asked' },
    }])
    assertEquals((await door.get([failure]))[0][failure], { code: 'invalid' })
    assertEquals(await host.get([failure]), [])
  }
  await door.apply([{ entity: { eid: 'saved' }, doc: { title: 'Saved' } }])
  assertEquals((await host.get(['saved']))[0].doc, { title: 'Saved' })
  assertEquals(await door.get(['saved']), [])
})

test('checking a refusal does not keep its invocation', async () => {
  let host = app(), door = ledger(host)
  await door.apply([{
    entity: { eid: 'checked' },
    refusal: { code: 'invalid' },
  }], { check: true })
  assertEquals(await host.get(['checked']), [])
  assertEquals(await door.get(['checked']), [])
})
