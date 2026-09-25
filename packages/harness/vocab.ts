// The harness's words, exported as `@yaks/harness/vocab`: `docs` is what a host
// composing the harness as one plugin among others (@yaks/cli `compose`) takes
// from it — the harness's own components and tools, and nothing another
// package says.
//
// The rest of this file is the harness as an application: every document a
// harness graph is made of, loaded into one vocabulary for the SQLite file
// `store.ts` opens on its own. A `yak` config lists the same packages as
// plugins instead.
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
import { connectionsDoc } from '@yaks/connections/vocab'
import { provisionalDoc } from '@yaks/effects/vocab'
import doc from './vocab.json' with { type: 'json' }

const { home, ...core } = doc.$defs
export let workspaceDoc: VocabDoc = { title: 'workspace', $defs: { home } }
export let harnessDoc: VocabDoc = { title: doc.title, $defs: core }

/** The harness's own words: the `home` a session works from, and its tools. */
export let docs: VocabDoc[] = [harnessDoc, workspaceDoc]

/** Every vocabulary document the harness is made of: the components a
 * transcript is made of (@yaks/session), what it asks for and what answers
 * (@yaks/tools, @yaks/context), what serves it (@yaks/model, @yaks/openai),
 * what a reply carries (@yaks/blob), the programs it starts (@yaks/process),
 * the sign-ins it keeps (@yaks/secrets, @yaks/connections) and the mark one
 * wears while it
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
export let made: VocabDoc[] = [
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
  connectionsDoc,
  provisionalDoc,
]

/** Every one of those documents, loaded into one vocabulary, with the JSON
 * Schema keywords they use. */
export let vocab: Vocab = loadVocab(made, [
  edgeKeywords,
  blobKeywords,
  idKeywords,
] as Keywords[])

/** The properties a harness graph computes rather than stores: a transcript's
 * status and a task's — both from @yaks/session, since the claim this graph
 * adds is the step in a task's status that it contributes — and a body whose
 * text lives in the blob table. Every part of this comes from another package's
 * `./vocab` subpath, so the harness's vocabulary loads in a browser tab as
 * readily as in the daemon. */
export let computed = (vocab: Vocab): Derived => ({
  ...sessionDerived(),
  ...blobRead(vocab),
})
