import { assertEquals } from '@std/assert'
import { artifactDoc } from '@yaks/blob'
import { loadVocab } from '@yaks/vocab'
import artifact from '../blob/vocab.json' with { type: 'json' }
import projection from '../render/vocab.json' with { type: 'json' }
import runtime from './runtime/vocab.json' with { type: 'json' }
import backend from './vocab.json' with { type: 'json' }
import { frontendVocab } from './frontend.ts'
import { harnessDoc, vocab, workspaceDoc } from './vocab.ts'

Deno.test('package JSON declarations preserve artifact references and backend composition', () => {
  assertEquals(artifactDoc, artifact)
  assertEquals<unknown>(
    { ...harnessDoc.$defs, ...workspaceDoc.$defs },
    backend.$defs,
  )
  assertEquals(vocab.prop('home', 'worktree')?.ref, 'worktree')
  assertEquals(vocab.prop('attachment', 'artifact')?.ref, 'artifact')
  assertEquals(vocab.prop('created', 'at')?.stamped, true)
  assertEquals(artifact.$defs.attachment.properties.artifact.death, 'keep')
  assertEquals(artifact.$defs.attachment.properties.audience.enum, [
    'user',
    'model',
  ])
})

Deno.test('frontend and projection vocabularies stay separate from stored backend fields', () => {
  assertEquals(frontendVocab.comp('draft')?.durable, 'connection')
  assertEquals(frontendVocab.comp('savedDraft')?.sync, 'none')
  assertEquals(vocab.comp('savedDraft'), undefined)
  assertEquals(loadVocab([projection]).prop('prop', 'ref')?.scalar, 'text')
  assertEquals(loadVocab([runtime]).prop('session', 'status')?.scalar, 'text')
})
