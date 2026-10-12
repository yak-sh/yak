// Guest-write registration and directory attribution declarations.
import type { VocabDoc } from '@yaks/vocab'
let pending = '.worked .edge.from.browser.by !completed'
export let attributionDoc: VocabDoc = {
  $defs: {
    browser: {
      component: true,
      type: 'object',
      description: 'a platform-vouched writing browser, claimed on sign-in',
      properties: {
        by: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          stamped: true,
          description: 'the person who claimed this browser’s guest work',
        },
      },
    },
    attribute_writes: {
      effect: true,
      created: ['worked'],
      changed: ['worked'],
      active: pending,
      sweep: pending,
      description: 'fill the authors of a signed-in browser’s guest rows',
    },
  },
}
export let registrationDoc: VocabDoc = {
  $defs: {
    register_writes: {
      effect: true,
      created: ['created', 'updated'],
      changed: ['updated'],
      target: '(.created.via !created.by|.updated.via !updated.by)',
      description: 'register this browser’s guest work for durable attribution',
    },
  },
}
export let docs: VocabDoc[] = [attributionDoc, registrationDoc]
