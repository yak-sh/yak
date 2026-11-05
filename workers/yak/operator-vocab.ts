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
        session: {
          type: 'string',
          ref: 'session',
          death: 'keep',
          description: 'The session its words went to, whose end answers it.',
        },
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
    operator_session: {
      component: true,
      description:
        "What an Operator session works with: its space, the person whose reach it has (the newest words' sender), and the attachments it was given.",
      properties: {
        space: { type: 'string', ref: 'entity', death: 'keep' },
        person: { type: 'string', ref: 'person', death: 'keep' },
        administrative: { type: 'boolean' },
        files: { type: 'array', items: { type: 'object' } },
      },
    },
    operator_files: {
      component: true,
      description:
        'The files that came with an input, from the request they were sent in: the model is shown the ones it reads as they are, beside the words.',
      properties: {
        request: { type: 'string', ref: 'entity', death: 'keep' },
        files: { type: 'array', items: { type: 'object' } },
      },
    },
    operator_answer: {
      component: true,
      description:
        'An answer to a request, kept before its channel attempts delivery: a request is answered once on a task, and in a conversation once when the Operator starts on it and again when the work comes back.',
      properties: {
        request: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'The request whose channel carries it; absent on an answer kept on its request.',
        },
        task: { type: 'string', ref: 'task', death: 'keep' },
        text: { type: 'string' },
        message_id: { type: 'string' },
      },
    },
    // The opt-in as this store kept it before the number moved onto the
    // person in the directory (@yaks/phone). Only read, to hand the rows over
    // (operator-host.ts `/operator/texts`).
    sms_consent: {
      component: true,
      description:
        'A person agreed to texts from the operator at this number, in these words; moving to the directory.',
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
