import { assertEquals } from '@std/assert'
import { artifactDoc } from '@yaks/blob'
import { loadVocab } from '@yaks/vocab'
import artifact from '../blob/vocab.json' with { type: 'json' }
import column from '../render/vocab.json' with { type: 'json' }
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
  assertEquals(vocab.column('home', 'worktree')?.ref, 'worktree')
  assertEquals(vocab.column('attachment', 'artifact')?.ref, 'artifact')
  assertEquals(vocab.column('created', 'at')?.stamped, true)
  assertEquals(artifact.$defs.attachment.properties.artifact.death, 'keep')
  assertEquals(artifact.$defs.attachment.properties.audience.enum, [
    'user',
    'model',
  ])
})

Deno.test('frontend and projection vocabularies stay separate from stored backend fields', () => {
  assertEquals(frontendVocab.comp('draft')?.keywords.persist, 'none')
  assertEquals(frontendVocab.comp('savedDraft')?.keywords.persist, 'local')
  assertEquals(vocab.comp('savedDraft'), undefined)
  assertEquals(loadVocab([column]).column('column', 'ref')?.scalar, 'text')
  assertEquals(loadVocab([runtime]).column('session', 'status')?.scalar, 'text')
})
