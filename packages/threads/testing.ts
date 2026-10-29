import { effectDoc } from '@yaks/effects'
import { loadVocab, type VocabDoc } from '@yaks/vocab'

export let doc: VocabDoc = {
  $defs: {
    job: {
      component: true,
      properties: { value: { type: 'number' }, ready: { type: 'boolean' } },
    },
    answer: {
      component: true,
      properties: {
        value: { type: 'number', stamped: true },
        by: { type: 'string' },
      },
    },
    admitted: { component: true },
    mark: {
      component: true,
      properties: { live: { type: 'boolean' }, stopped: { type: 'boolean' } },
    },
    finish: { effect: true, created: ['job'] },
    admit_answer: { rule: true, match: '.answer, +!admitted' },
    answered: { effect: true, created: ['admitted'] },
  },
}
export let vocab = loadVocab([doc, effectDoc])
