import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { artifactDoc } from '@yaks/blob'
import { loadVocab, pick } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools'
import artifact from '../blob/vocab.json' with { type: 'json' }
import projection from '../render/vocab.json' with { type: 'json' }
import runtime from './runtime/vocab.json' with { type: 'json' }
import backend from './vocab.json' with { type: 'json' }
import { frontendVocab } from './frontend.ts'
import { harnessDoc, homeDoc } from './vocab.ts'
import { words } from '@yaks/cli/host'
import { at } from './testing.ts'

let { vocab } = await words(at())
let projectionVocab = loadVocab([projection])
let runtimeVocab = loadVocab([pick(toolsDoc, ['refusal']), runtime])

test('package JSON declarations preserve artifact references and compose with the rest', () => {
  assertEquals(artifactDoc, artifact)
  assertEquals<unknown>(
    { ...harnessDoc.$defs, ...homeDoc.$defs },
    backend.$defs,
  )
  assertEquals(vocab.prop('home', 'machine')?.ref, 'machine')
  assertEquals(vocab.prop('attachment', 'artifact')?.ref, 'artifact')
  assertEquals(vocab.prop('created', 'at')?.stamped, true)
  assertEquals(artifact.$defs.attachment.properties.artifact.death, 'keep')
  assertEquals(artifact.$defs.attachment.properties.audience.enum, [
    'user',
    'model',
  ])
})

test('frontend and projection vocabularies stay separate from stored backend fields', () => {
  assertEquals(frontendVocab.comp('draft')?.durable, 'connection')
  assertEquals(frontendVocab.comp('savedDraft')?.sync, 'none')
  assertEquals(vocab.comp('savedDraft'), undefined)
  assertEquals(projectionVocab.prop('prop', 'ref')?.scalar, 'text')
  // The projection extends the tools declaration; it cannot declare a second
  // refusal of its own or silently omit the component.
  assertThrows(
    () => loadVocab([runtime]),
    Error,
    "'refusal' extends a component no document declares",
  )
  assertEquals(runtimeVocab.prop('session', 'status')?.scalar, 'text')
  assertEquals(runtimeVocab.prop('refusal', 'code')?.scalar, 'text')
})
