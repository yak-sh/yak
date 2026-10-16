// The completion example's vocabulary is input, not completion work.
import { loadVocab } from '@yaks/vocab'

export let completionVocab = loadVocab({
  $defs: {
    task: {
      component: true,
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
      },
    },
  },
})
