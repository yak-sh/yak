import { test } from '@yaks/testing'
import { assertEquals, assertMatch } from '@std/assert'
import { type Comp, graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { contextDoc, snapshot } from './mod.ts'
import { outputView } from './output.ts'

// A tool's answer as data (@yaks/tools `result`), declared here alone.
const vocab = loadVocab([contextDoc, {
  $defs: {
    result: {
      component: true,
      type: 'object',
      properties: { call: { type: 'string' }, value: { type: 'object' } },
    },
  },
}])
const g = graph({ vocab, storage: ram(vocab) })
const source = crypto.randomUUID()
const body = 'a'.repeat(2000)
const revision = (await snapshot(body, source)).revision
const handle = derivedEid('output:' + source + ':' + revision)

const entry = { entity: { eid: source }, content: { body } }
const view = await outputView(g, entry, 512)
const rows = await g.read('.context_output')

test('bounded output retains its immutable snapshot under a UUID handle', () => {
  assertMatch(
    handle,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  assertEquals(JSON.parse(view).id, handle)
  const [stored] = rows
  assertEquals(stored.entity.eid, handle)
  assertEquals((stored.context_output as Comp).body, body)
})

test('bounded output replay reuses its stored snapshot', async () => {
  assertEquals(await outputView(g, entry, 512), view)
  assertEquals((await g.read('.context_output')).length, 1)
})

test('concise tool prose survives large structured backing data', async () => {
  let text = 'entry-1 · entry — Their dentist is Dr Alvarez.'
  let compact = {
    entity: { eid: crypto.randomUUID() },
    content: { body: text },
    result: { value: { result: [{ content: { body } }] } },
  }
  assertEquals(await outputView(g, compact, 512), text)
})

test('a result read without its value is viewed by the value it keeps', async () => {
  let eid = crypto.randomUUID()
  let value = { rows: [body] }
  await g.apply([{ entity: { eid }, result: { call: 'c', value } }])
  let read = await outputView(
    g,
    { entity: { eid }, result: { call: 'c' } },
    512,
  )
  let whole = await outputView(g, {
    entity: { eid },
    result: { call: 'c', value },
  }, 512)
  assertEquals(read, whole)
  assertEquals(JSON.parse(read).bytes > 512, true)
})
