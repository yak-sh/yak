// The words the harness speaks, as DOCUMENTS and as one loaded vocabulary: the
// `vocab` facet a host takes (`@yaks/harness/vocab`).
//
// The list is here and nowhere else — a host composing the harness (@yaks/cli
// `compose`) takes it through the subpath, and `store.ts` loads it for the
// harness's own file — so a word added here is a word both speak.
//
// Every document comes from another package's OWN `./vocab`, never its front
// door: `@yaks/process` mod.ts starts child processes, and the harness's words
// should be loadable by anything that wants to know what a harness SAYS,
// including a browser tab that will never run one.

import { openrouterDoc } from '@yaks/openrouter/vocab'
import { mcpDoc } from '@yaks/mcp-client/vocab'
import { artifactDoc, blobKeywords, blobRead } from '@yaks/blob/vocab'
import { contextDoc } from '@yaks/context/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { spineDoc } from '@yaks/kernel/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { openaiDoc } from '@yaks/openai/vocab'
import { processDoc } from '@yaks/process/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { derived as sessionColumns, sessionDoc } from '@yaks/session/vocab'
import { taskDoc } from '@yaks/task/vocab'
import {
  type Keywords,
  loadVocab,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import type { Derived } from '@yaks/sql'
import { checkoutDoc } from '@yaks/git/vocab'
import doc from './vocab.json' with { type: 'json' }

const { home, ...core } = doc.$defs
export let workspaceDoc: VocabDoc = { title: 'workspace', $defs: { home } }
export let harnessDoc: VocabDoc = { title: doc.title, $defs: core }

/** Every document the harness is made of: the words a transcript is made of
 * (@yaks/session), what it asks for and what answers (@yaks/tools,
 * @yaks/context), what serves it (@yaks/model, @yaks/openai), what a reply
 * carries (@yaks/blob), the programs it starts (@yaks/process), and the work it
 * is doing (@yaks/doc, @yaks/edge, @yaks/task) — over @yaks/kernel's spine,
 * which is where `entity` and the two stamps live.
 *
 * This is a LIST, package by package, because that is the only way a word has
 * one home: no document here says another's words, so every one of them also
 * loads beside this one (`packages/facets_test.ts`). */
export let docs: VocabDoc[] = [
  spineDoc,
  harnessDoc,
  mcpDoc,
  checkoutDoc,
  workspaceDoc,
  docDoc,
  edgeDoc,
  sessionDoc,
  contextDoc,
  toolsDoc,
  artifactDoc,
  modelDoc,
  openaiDoc,
  openrouterDoc,
  processDoc,
  projectDoc,
  taskDoc,
]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [edgeKeywords, blobKeywords]

/** Everything the harness speaks, loaded once. */
export let vocab: Vocab = loadVocab(docs, keywords)

/** The columns a harness graph computes rather than keeps: a transcript's
 * status and a task's — both @yaks/session's, since the lease rung in a task's
 * ladder is the one this graph adds — and a body whose text lives in the blob
 * table. Every part of this facet comes from another package's `./vocab`, so
 * the harness's words load in a browser tab as readily as in the daemon. */
export let derived = (vocab: Vocab): Derived => ({
  ...sessionColumns(),
  ...blobRead(vocab),
})
