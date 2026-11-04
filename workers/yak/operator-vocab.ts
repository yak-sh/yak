import type { VocabDoc } from '@yaks/vocab'

export let operatorDoc: VocabDoc = {
  $defs: {
    operator_request: {
      component: true,
      description:
        'A received operator request and the channel to answer it on.',
      properties: {
        space: { type: 'string', ref: 'entity', death: 'keep' },
        person: { type: 'string', ref: 'person', death: 'keep' },
        task: { type: 'string', ref: 'task', death: 'keep' },
        channel: { type: 'string' },
        administrative: { type: 'boolean' },
        address: { type: 'string' },
        reply_to: { type: 'string' },
        files: { type: 'array', items: { type: 'object' } },
        app: {
          type: 'string',
          description: 'The app whose break started the request.',
        },
      },
    },
    operator_answer: {
      component: true,
      description: 'The answer kept before its channel attempts delivery.',
      properties: {
        task: { type: 'string', ref: 'task', death: 'keep' },
        text: { type: 'string' },
        message_id: { type: 'string' },
      },
    },
    sms_consent: {
      component: true,
      description:
        'A person agreed to texts from the operator at this number, in these words.',
      properties: {
        person: { type: 'string', ref: 'person', death: 'keep' },
        number: { type: 'string' },
        consent: { type: 'string' },
        at: { type: 'string', format: 'date-time' },
      },
    },
    operator_receive: {
      effect: true,
      created: ['operator_request'],
      tries: 3,
      description: 'Carry out one received request through the space operator.',
    },
    operator_deliver: {
      effect: true,
      created: ['operator_answer'],
      idempotent: false,
      tries: 3,
      description: 'Deliver a kept answer through its originating channel.',
    },
  },
}
