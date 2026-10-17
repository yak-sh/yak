import { test } from '@yaks/testing'
import { assertEquals, assertMatch } from '@std/assert'
import { type Comp, graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { contextDoc, snapshot } from './mod.ts'
import { outputView } from './output.ts'

const vocab = loadVocab([contextDoc])
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
  assertEquals(view.includes('Handle: ' + handle), true)
  const [stored] = rows
  assertEquals(stored.entity.eid, handle)
  assertEquals((stored.context_output as Comp).body, body)
})

test('bounded output replay reuses its stored snapshot', async () => {
  assertEquals(await outputView(g, entry, 512), view)
  assertEquals((await g.read('.context_output')).length, 1)
})
