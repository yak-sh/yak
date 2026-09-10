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
export let workspaceDoc: VocabDoc = {
  title: 'workspace',
  $defs: {
    home: {
      type: 'object',
      description:
        'An agent home checkout, separate from working directory; not a sandbox.',
      properties: {
        worktree: { type: 'string', ref: 'worktree', death: 'keep' },
        cwd: {
          type: 'string',
          description:
            'Optional default command directory, independent of the home checkout.',
        },
      },
    },
  },
}
/** The words no package owns: the spine, and the two stamps @yaks/graph writes
 * when a vocabulary declares them — without which nothing here has a time. */
export let harnessDoc: VocabDoc = {
  title: 'harness',
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
  },
}

/** Everything the harness speaks, loaded once. */
export let vocab: Vocab = loadVocab([
  harnessDoc,
  checkoutDoc,
  workspaceDoc,
  docDoc,
  edgeDoc,
  sessionDoc,
  modelDoc,
  openaiDoc,
  processDoc,
  taskDoc,
], [edgeKeywords, blobKeywords])
