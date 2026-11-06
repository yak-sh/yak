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
        via: {
          type: 'string',
          description:
            'The phone transport a text arrived on, used for its reply.',
        },
        files: { type: 'array', items: { type: 'object' } },
        model: {
          type: 'string',
          description:
            "The model that answers it, where not the Operator's own: a call's.",
        },
        app: {
          type: 'string',
          description: 'The app whose break started the request.',
        },
        about: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'What in their Updates the words answer: an update, or a question asked of them.',
        },
        signup: {
          type: 'boolean',
          description:
            "Sent to yaks.app's sign-up address or number: the sender's first words, unless they had signed up before.",
        },
        call: {
          type: 'string',
          description:
            "The call whose talking model asked it, in that model's words for the caller rather than the caller's own.",
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
    operator_channel: {
      component: true,
      description:
        "How a person's words came into their conversation: the channel, and the framing said before them to the model, which the conversation draws as the channel's icon instead.",
      properties: {
        channel: {
          type: 'string',
          description: 'The channel they came by (operator_request.channel).',
        },
        framing: {
          type: 'string',
          description:
            'What the model reads before their words, saying how they came; the body starts with it.',
        },
      },
    },
    operator_call: {
      component: true,
      description:
        "A line of a phone call its talking model hears and speaks, in the person's conversation: the caller's words or the model's, kept as a notice, or what the model asked the Operator.",
      properties: {
        call: { type: 'string', description: "The line's id for the call." },
        said: {
          type: 'boolean',
          description:
            "The talking model's words, which the Operator reads as its own, rather than the caller's.",
        },
        began: {
          type: 'boolean',
          description:
            'That the call began here, rather than words said on it.',
        },
        asked: {
          type: 'boolean',
          description:
            'What the talking model asked the Operator for the caller (operator_request.call), rather than what either said aloud.',
        },
      },
    },
    operator_letter: {
      component: true,
      description:
        "A letter the Operator wrote for a person to someone else, beside its `mail` and `doc`: a reply that names it comes back into that person's conversation.",
      properties: {
        person: { type: 'string', ref: 'person', death: 'keep' },
        session: {
          type: 'string',
          ref: 'session',
          death: 'keep',
          description: 'The session that wrote it.',
        },
      },
    },
    operator_text: {
      component: true,
      description:
        "A text the Operator sent for a person from their own number to someone else, beside its `text{from, to, at, message_id, via}` and `doc{body}`: a text back from that number comes into that person's conversation.",
      properties: {
        person: { type: 'string', ref: 'person', death: 'keep' },
        session: {
          type: 'string',
          ref: 'session',
          death: 'keep',
          description: 'The session that sent it.',
        },
        from: {
          type: 'string',
          description: "The person's own number it went from, in E.164 form.",
        },
        to: {
          type: 'string',
          description: 'The number it went to, in E.164 form.',
        },
        at: { type: 'string', format: 'date-time' },
        message_id: {
          type: 'string',
          description: "The provider's id for it.",
        },
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
        with: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'The answer that carries this one: a turn that answered several requests sent by the same way says it once, on the first.',
        },
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
