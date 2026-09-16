import { openrouterDoc } from '@yaks/openrouter'
import { mcpDoc } from '@yaks/mcp-client/graph'
import { blobKeywords } from '@yaks/blob'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { modelDoc } from '@yaks/model'
import { openaiDoc } from '@yaks/openai'
import { processDoc } from '@yaks/process'
import { sessionDoc } from '@yaks/session'
import { taskDoc } from '@yaks/task'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { checkoutDoc } from '@yaks/git/checkout-vocab'
import doc from './vocab.json' with { type: 'json' }

const { home, ...core } = doc.$defs
export let workspaceDoc: VocabDoc = { title: 'workspace', $defs: { home } }
export let harnessDoc: VocabDoc = { title: doc.title, $defs: core }

/** Everything the harness speaks, loaded once. */
export let vocab: Vocab = loadVocab([
  harnessDoc,
  mcpDoc,
  checkoutDoc,
  workspaceDoc,
  docDoc,
  edgeDoc,
  sessionDoc,
  modelDoc,
  openaiDoc,
  openrouterDoc,
  processDoc,
  taskDoc,
], [edgeKeywords, blobKeywords])
