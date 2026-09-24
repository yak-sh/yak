// The vocabulary the harness uses, both as separate documents and as one
// loaded vocabulary, exported as `@yaks/harness/vocab`.
//
// The list is here and nowhere else — a server composing the harness (@yaks/cli
// `compose`) imports it through that subpath, and `store.ts` loads it for the
// harness's own SQLite file — so a component added here is available to both.
//
// Every document is imported from another package's own `./vocab` subpath,
// never from its main module: `@yaks/process`'s mod.ts starts child processes,
// and the harness's vocabulary has to be loadable by anything that wants to
// know which components and tools a harness has, including a browser tab that
// will never run one.

import { openrouterDoc } from '@yaks/openrouter/vocab'
import { mcpDoc } from '@yaks/mcp-client/vocab'
import { artifactDoc, blobKeywords, blobRead } from '@yaks/blob/vocab'
import { contextDoc } from '@yaks/context/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { marksDoc, spineDoc } from '@yaks/kernel/vocab'
import { idDoc, idKeywords } from '@yaks/id/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { openaiDoc } from '@yaks/openai/vocab'
import { processDoc } from '@yaks/process/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { derived as sessionDerived, sessionDoc } from '@yaks/session/vocab'
import { taskDoc } from '@yaks/task/vocab'
import {
  type Keywords,
  loadVocab,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import type { Derived } from '@yaks/sql'
import { checkoutDoc } from '@yaks/git/vocab'
import { secretsDoc } from '@yaks/secrets/vocab'
import { provisionalDoc } from '@yaks/effects/vocab'
import doc from './vocab.json' with { type: 'json' }

const { home, ...core } = doc.$defs
export let workspaceDoc: VocabDoc = { title: 'workspace', $defs: { home } }
export let harnessDoc: VocabDoc = { title: doc.title, $defs: core }

/** Every vocabulary document the harness is made of: the components a
 * transcript is made of (@yaks/session), what it asks for and what answers
 * (@yaks/tools, @yaks/context), what serves it (@yaks/model, @yaks/openai),
 * what a reply carries (@yaks/blob), the programs it starts (@yaks/process),
 * the tokens it signs in with (@yaks/secrets) and the mark one wears while it
 * is being saved (@yaks/effects), and the work it is doing
 * (@yaks/doc, @yaks/edge, @yaks/task) — over
 * @yaks/kernel's `entity` table, which is where `entity` and the two stamps
 * live, and its marks, which is where `archived` lives: a harness archives a
 * session, it does not own the component for putting something away.
 * @yaks/id's document is loaded beside it because a harness shows `S-12`: it
 * adds the `num` property to that same `entity` row.
 *
 * This is a list, package by package, because that is the only way each
 * component has exactly one home: no document here redeclares another's
 * components, so any of them also loads alongside this one
 * (`packages/facets_test.ts`). */
export let docs: VocabDoc[] = [
  spineDoc,
  idDoc,
  marksDoc,
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
  secretsDoc,
  provisionalDoc,
]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [edgeKeywords, blobKeywords, idKeywords]

/** Every one of those documents, loaded into one vocabulary. */
export let vocab: Vocab = loadVocab(docs, keywords)

/** The properties a harness graph computes rather than stores: a transcript's
 * status and a task's — both from @yaks/session, since the claim this graph
 * adds is the step in a task's status that it contributes — and a body whose
 * text lives in the blob table. Every part of this comes from another package's
 * `./vocab` subpath, so the harness's vocabulary loads in a browser tab as
 * readily as in the daemon. */
export let derived = (vocab: Vocab): Derived => ({
  ...sessionDerived(),
  ...blobRead(vocab),
})
