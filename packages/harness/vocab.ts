// The words the harness speaks, as DOCUMENTS and as one loaded vocabulary.
// The list is here and nowhere else: `plugin.ts` hands these same documents to
// a host that composes the harness (@yaks/cli `compose`), and `store.ts` loads
// them for the harness's own file. Both read one list, so a word added here is
// a word both speak.

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
import {
  type Keywords,
  loadVocab,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { checkoutDoc } from '@yaks/git/checkout-vocab'
import doc from './vocab.json' with { type: 'json' }

const { home, ...core } = doc.$defs
export let workspaceDoc: VocabDoc = { title: 'workspace', $defs: { home } }
export let harnessDoc: VocabDoc = { title: doc.title, $defs: core }

/** Every document the harness is made of: the words a transcript is made of
 * (@yaks/session), what serves it (@yaks/model, @yaks/openai), the programs it
 * starts (@yaks/process), and the work it is doing (@yaks/doc, @yaks/edge,
 * @yaks/task). */
export let docs: VocabDoc[] = [
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
]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [edgeKeywords, blobKeywords]

/** Everything the harness speaks, loaded once. */
export let vocab: Vocab = loadVocab(docs, keywords)
