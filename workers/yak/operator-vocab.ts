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
        provider: { type: 'string' },
        model: {
          type: 'string',
          description:
            "The model that answers it, where not the Operator's own: a call's.",
        },
        app: {
          type: 'string',
          description:
            'The app whose break started the request, on the error channel; the app open beside the chat, on the chat channel.',
        },
        page: {
          type: 'string',
          description:
            'The address of the yaks.app page the words were written on, on the chat channel.',
        },
        about: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            "What the words are about: in their Updates, the update or question they answer; on the wake channel, the wake-up that fired; on the subscription channel, the subscription whose rows changed; on the letter and texted channels, the Operator's letter or text they reply to; on the escalated channel, that reply.",
        },
        from: {
          type: 'string',
          ref: 'session',
          death: 'keep',
          description:
            "On the escalated channel, the conversation that raised the words: the Operator's own, with the reply's writer and only their permissions, which hears back only what escalation_answer sends it. The words are the Operator's, never the person's they are raised with.",
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
        signup: {
          type: 'string',
          description:
            'The vouched phone of a reply-only form conversation; its tools are only sign-up operations.',
        },
        conversation: {
          type: 'boolean',
          description:
            "The person's one conversation with the Operator (operator-channels.ts `rootAt`), whoever's it was begun as.",
        },
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
    operator_stopped: {
      component: true,
      description:
        "That the person stopped a helper from its page, said in their conversation when one of its helpers started it, so no report of the helper's reaches the conversation (operator.ts `stop`): a line of theirs, which the model reads as from them and which tells it to leave the helper stopped until they have talked. The page draws it as their act, not its words.",
      properties: {
        helper: {
          type: 'string',
          ref: 'session',
          death: 'keep',
          description: 'The helper session they stopped.',
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
    // Which of the person's own numbers the Operator uses, and how: its
    // own setting, written by phone_numbers or any write to its store
    // (operator-line.ts).
    operator_line: {
      component: true,
      description:
        "One of the numbers a person's own connected phone account holds (own_number in the directory), as the person chose for their Operator: outbound, its phone_send texts go from it; inbound, texts that reach it come to the Operator. Each is on only when true, and the two are independent.",
      properties: {
        connection: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          identity: true,
          description: 'The connection to the account that holds it.',
        },
        number: {
          type: 'string',
          identity: true,
          description: 'The number in E.164 form.',
        },
        outbound: {
          type: 'boolean',
          description: 'Whether phone_send texts go from it.',
        },
        inbound: {
          type: 'boolean',
          description:
            'Whether texts that reach it come to the Operator: on, its SMS callback is pointed at yaks.app; off, its callback is left as the person had it, or put back.',
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
    // What a row that fires asks the Operator, as the person who set it: a
    // wake-up (operator-wakes.ts), and any other trigger that becomes a turn
    // in their conversation (operator-channels.ts `fire`).
    operator_ask: {
      component: true,
      description:
        "What the space's Operator is asked each time this row fires, as the person who set it.",
      properties: {
        space: { type: 'string', ref: 'entity', death: 'keep' },
        person: { type: 'string', ref: 'person', death: 'keep' },
        administrative: { type: 'boolean' },
        say: {
          type: 'string',
          description: 'The words given to the Operator when it fires.',
        },
        helper: {
          type: 'string',
          description:
            'The brief for a fresh helper after the scheduled call, including its result.',
        },
      },
    },
    operator_work: {
      component: true,
      description:
        'One occurrence of scheduled Operator work, with its recorded call and helper.',
      properties: {
        schedule: { type: 'string', ref: 'entity', death: 'keep' },
        at: { type: 'string', format: 'date-time' },
        call: { type: 'string', ref: 'call', death: 'keep' },
        helper: { type: 'string', ref: 'session', death: 'keep' },
        error: {
          type: 'string',
          description:
            'A call failure retained while the helper checks its outcome.',
        },
      },
    },
    // A query the Operator watches for the person who set it, beside the
    // wake-up that looks at it again (operator-subscriptions.ts).
    operator_subscription: {
      component: true,
      description:
        "A query the space's Operator watches for the person who set it: each time its wake fires the query is read again, and a change in its rows is a turn.",
      properties: {
        query: { type: 'string' },
        mine: {
          type: 'boolean',
          description:
            "Read over the Operator's own store rather than the space.",
        },
        seen: {
          type: 'object',
          description:
            'Each row the query answered at the last look, by eid, and a digest of it.',
        },
      },
    },
    operator_fired: {
      effect: true,
      created: ['fired'],
      changed: ['fired'],
      tries: 3,
      description:
        "Give a fired wake's words to the Operator as a request of the person who set it; for a subscription, only when its query's rows changed.",
    },
    operator_line_point: {
      effect: true,
      created: ['operator_line'],
      changed: ['operator_line.inbound'],
      removed: ['operator_line'],
      tries: 3,
      description:
        "Point the SMS callback of each of a connection's numbers taken inbound at yaks.app, and put back the callback of each that no longer is (operator-line.ts `pointed`).",
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
    operator_alert: {
      effect: true,
      created: ['notification'],
      idempotent: false,
      tries: 3,
      description:
        'Tell the person a notification the Operator wrote them, the way they chose to be alerted (operator-alerts.ts).',
    },
  },
}
