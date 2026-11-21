import type { VocabDoc } from '@yaks/vocab'

export let operatorDoc: VocabDoc = {
  $defs: {
    // Retired: the Operator's settings as its persona held them before
    // its name was the persona's title, its voice @yaks/speech's `speech`
    // and its cache @yaks/model's `cache`. The store moves them onto those on
    // its first read of the persona (operator-persona.ts `held`), and this
    // goes once every store has (T-164108).
    operator: {
      component: true,
      type: 'object',
      description:
        "Retired: the Operator's settings from before they were its persona's title, speech{} and cache{}, which the store moves them onto on its first read.",
      properties: {
        name: { type: 'string' },
        voice: { type: 'string' },
        voice_speed: { type: 'string' },
        voice_model: { type: 'string' },
        voice_backend: { type: 'string' },
        cache_retention: { type: 'number' },
      },
    },
    walkthrough: {
      component: true,
      description:
        "Marks a conversation as the recorded walkthrough of one of the space's apps: each of the person's requests in it is a step, ending in the release its last app_deploy of that app made. yaks.app's home page shows the demo space's walkthroughs beside the apps they built.",
      properties: {
        app: {
          type: 'string',
          index: true,
          description: 'the slug of the app the conversation built',
        },
      },
    },
    operator_approval: {
      component: true,
      description:
        "A privileged act asked for in this person's conversation, waiting for their tap on a link: texted to their number where they wrote by text or call, else given in the Operator's answer (yaks.app's operator-approvals.ts). Approve marks it verified{} and carries it out; Decline marks it declined{} and runs nothing.",
      properties: {
        person: { type: 'string', ref: 'entity', death: 'keep' },
        session: { type: 'string', ref: 'session', death: 'keep' },
        tool: { type: 'string', description: 'The tool the act calls.' },
        args: { type: 'object', description: 'Its arguments.' },
        say: {
          type: 'string',
          description: "What it does, in the person's words.",
        },
        number: { type: 'string', description: 'Where the link was texted.' },
        expires: { type: 'string', format: 'date-time' },
        why: {
          type: 'string',
          enum: ['identity', 'authority'],
          description:
            "Why it waits (yaks.app's operator-route.ts): identity, the act is within the person's role and only that it is theirs needs confirming; authority, their role does not allow it, and someone whose role does approves it, running it with their own tools. Identity where absent.",
        },
        approvers: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Everyone who may answer it, any one for the rest; the person alone where absent.',
        },
        then: {
          type: 'array',
          items: { type: 'string' },
          description:
            "Where the person's role does not allow it and their words came where nothing proves who sent them: who approves it once the person has confirmed it is theirs, asked anew then.",
        },
      },
    },
    approval_ask: {
      component: true,
      description:
        "On a decision assigned to someone other than an operator_approval's person, who may answer it too: the approval it asks them about. Answered, it answers the approval as its card or link would, and once the approval is answered anywhere it is answered here too.",
      properties: {
        approval: { type: 'string', ref: 'entity', death: 'cascade' },
      },
    },
    declined: {
      component: true,
      description:
        'On an operator_approval: the person pressed Decline on its link, so its act never runs and the link opens nothing more.',
      properties: {},
    },
    unverified: {
      component: true,
      description:
        "On a person's input: words that came where only the number they came from says who sent them (an SMS, RCS, or a call the carriers did not vouch for), which anyone can show. The model reads them marked unverified, and for a day a privileged act a later turn of the conversation does waits for a tap on a link texted to that number, unless that turn's own words ask for it (yaks.app's operator-approvals.ts).",
      properties: {
        number: { type: 'string', description: 'The number they came from.' },
      },
    },
    operator_contact: {
      component: true,
      description:
        'A contact proposed in this person’s conversation; only confirmed contacts are written on their directory person.',
      properties: {
        person: { type: 'string', ref: 'entity', death: 'keep' },
        address: { type: 'string' },
        source: { type: 'string', ref: 'entry', death: 'keep' },
        request: {
          type: 'string',
          ref: 'entry',
          death: 'keep',
          description:
            'The original human request whose completion waits for this contact, retained across retries and address changes.',
        },
        session: { type: 'string', ref: 'session', death: 'keep' },
        code: {
          type: 'string',
          description:
            'Retired duplicate digest; contact-move scopes its directory proof and clears it.',
        },
        expires: { type: 'string', format: 'date-time' },
        tries: {
          type: 'number',
          description:
            'Retired duplicate guess count, cleared by contact-move.',
        },
        consent: { type: 'string' },
        consent_source: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
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
        group: {
          type: 'array',
          items: { type: 'string' },
          description:
            'In a group text, everyone else in it besides its sender (`address`) and the number it reached (`reply_to`), who all read the answer unless any is `withheld`. Its `person` is the guest who stands for the group.',
        },
        withheld: {
          type: 'array',
          items: { type: 'string' },
          description:
            'In a group text, those in `group` who have not agreed to texts from `reply_to` or replied STOP to it. While any are, the answer goes to its sender (`address`) alone.',
        },
        writer: {
          type: 'string',
          ref: 'person',
          death: 'keep',
          description:
            'In a group text, the person who wrote the words, whose they are kept as.',
        },
        addressed: {
          type: 'boolean',
          description: 'In a group text, whether the words named the Operator.',
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
        raised: {
          type: 'string',
          index: true,
          description:
            "On the escalated channel, the escalation these words are one copy of: the same on the copy raised with each person who may answer it (yaks.app's operator-route.ts).",
        },
        answered_by: {
          type: 'string',
          ref: 'person',
          death: 'keep',
          description:
            'On the escalated channel, who of those it was raised with answered it first, on every copy: it is theirs, and the rest answer it no more.',
        },
        from: {
          type: 'string',
          ref: 'session',
          death: 'keep',
          description:
            "On the escalated channel, the conversation that raised the words: the Operator's own, with the reply's writer and only their permissions, which hears back only what escalation_answer sends it. The words are the Operator's, never the person's they are raised with. On the thread channel, the session that sent the note.",
        },
        role: {
          type: 'string',
          description:
            'On the thread channel, the role in the space of the person whose thread sent the note; absent for one who is not a member.',
        },
        from_space: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description: 'The space whose Operator sent a handoff.',
        },
        rebuild: {
          type: 'boolean',
          description:
            'Begun from a box given the web address of a site, on the chat channel: its words carry what to do with it.',
        },
        new_app: {
          type: 'boolean',
          description:
            'Asked for on the New app screen, on the chat channel: the words are a request for a new app.',
        },
        stepped: {
          type: 'object',
          description:
            "Begun from a step of a walkthrough on yaks.app's home page, on the chat channel: the conversation holds the demo's transcript through that step, and the words are the visitor's first.",
          properties: {
            demo: {
              type: 'string',
              description: "the demo app's slug in the demo space",
            },
            app: {
              type: 'string',
              description: "the slug of this space's copy of it",
            },
            outside: {
              type: 'array',
              items: { type: 'string' },
              description:
                "the tools the demo's Operator called that set up something outside the app, which this space does not have",
            },
          },
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
        attested: {
          type: 'boolean',
          description:
            'On a call, that the carriers vouched the caller holds the number they called from (STIR/SHAKEN full attestation, validated), so the call is trusted as chat is.',
        },
        linked: {
          type: 'boolean',
          description:
            "On a chat platform or in its voice room, that the writer's account there is linked to a person here, not a guest's.",
        },
      },
    },
    operator_oracle: {
      component: true,
      description:
        "A topic, source or link projected with one person's reach into the Operator's store. A missing person quarantines a legacy projection whose reader is unknown.",
      properties: {
        person: { type: 'string', ref: 'person', death: 'keep' },
        subject: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
    stalled: {
      component: true,
      description:
        'An Operator conversation a yaks.app bug stopped before it finished, until the bug is fixed and it is taken up again (workers/yak/operator-rerun.ts).',
      properties: {
        fault: {
          type: 'string',
          description:
            "The fault its report was filed under (@yaks/tracker `faultOf`), which the bug's resolution names.",
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
        channel: {
          type: 'string',
          description:
            'The newest input channel, inherited by helpers; reply channels carry no personal remote tools.',
        },
        confirm: {
          type: 'string',
          description:
            "The number the newest words came from where it is all that says who sent them (an SMS, an unverified call), inherited by helpers: the session's privileged acts wait for a tap on a link texted to it.",
        },
        signup: {
          type: 'string',
          description:
            'The reply phone of a form conversation; its tools are only sign-up operations.',
        },
        conversation: {
          type: 'boolean',
          description:
            "The person's one conversation with the Operator (operator-channels.ts `rootAt`), whoever's it was begun as.",
        },
        files: { type: 'array', items: { type: 'object' } },
      },
    },
    operator_memory: {
      component: true,
      description:
        'The audience of a saved memory. A person makes it theirs. An empty mark shares it with the space, subject to the ownership of its source.',
      properties: {
        person: { type: 'string', ref: 'person', death: 'keep' },
      },
    },
    // Kept by the store's rule (./operator-owner.ts `owning`) in the commit
    // that makes or changes what it is read from; nobody else writes it.
    owner: {
      component: true,
      journal: false,
      description:
        "Whose this is in the Operator's store, the one person who reads it: named by it or by what it hangs on (its conversation, its session, the session a helper works for, the request files came with). Without a person it is named as more than one person's, or by something that names nobody, and nobody reads it. An entity without an owner is nobody's, and everyone who reads the store sees it.",
      properties: {
        person: {
          type: 'string',
          ref: 'person',
          death: 'keep',
          stamped: true,
        },
      },
    },
    operator_files: {
      component: true,
      description:
        "The files an input came with, or a result brought back, as lines kept before they were found among the attachments (@yaks/blob `attachment{message}`) say them, until their store's pass moves them there (files-move.ts).",
      properties: {
        request: { type: 'string', ref: 'entity', death: 'keep' },
        files: { type: 'array', items: { type: 'object' } },
      },
    },
    taken: {
      component: true,
      description:
        "The item an input's words came in, as 1ad52d4f7 wrote it for a few minutes before @yaks/session named it `intake{item}`; moved there by its store's pass (files-move.ts `intakeBackfill`).",
      properties: { item: { type: 'string' } },
    },
    operator_channel: {
      component: true,
      description:
        "How a person's words came into their conversation, as lines kept before @yaks/session's `channel{name, framing}` say it, until their store's pass moves them there (channel-move.ts `channelBackfill`).",
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
    operator_hosted: {
      component: true,
      description:
        "A line telling a conversation that a hosted model answers it in place of its person's own machine, which did not answer a step (operator-machine.ts). It stands until the machine answers again, which marks it `completed`; while it stands the conversation is not told again.",
      properties: {
        code: {
          type: 'string',
          description:
            "The code of the machine's failure (@yaks/model `ModelError`): `unreachable`, `stalled`, or its provider's own.",
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
    operator_machine: {
      component: true,
      description:
        "A helper that runs on its person's own machine, reached through a space's tunnel, rather than in yaks.app's sandbox (workers/yak operator-helpers.ts): the space whose tunnel goes there, the task and session the machine keeps the run as, and the machine's name and the model asked of it. The machine's word about that task is the helper's report.",
      properties: {
        space: { type: 'string', ref: 'entity', death: 'keep' },
        task: {
          type: 'string',
          description:
            'The task the machine filed the brief as, by its eid there.',
        },
        session: {
          type: 'string',
          description: "The machine's session running it, by its eid there.",
        },
        names: {
          type: 'string',
          description:
            "The task's and the session's short ids there, as one line.",
        },
        machine: {
          type: 'string',
          description:
            'The machine, by the name it gave itself in its answer (@yaks/spawn/routes `Spawned`).',
        },
        model: {
          type: 'string',
          description:
            "The model the run was asked to use, by the machine's name for it; absent where it runs its provider's own.",
        },
      },
    },
    operator_letter: {
      component: true,
      description:
        "A letter the Operator wrote for a person, to someone else or to them, beside its `mail` and `doc`: a reply that names it comes back into its writer's conversation, and the person it was written for is told when that is someone else.",
      properties: {
        person: { type: 'string', ref: 'person', death: 'keep' },
        platform: {
          type: 'boolean',
          description:
            "A letter yaks.app owes the person, such as an invitation or a contact code, sent in the Operator's name: the space's monthly emails never count or refuse it.",
        },
        session: {
          type: 'string',
          ref: 'session',
          death: 'keep',
          description: 'The session that wrote it.',
        },
      },
    },
    operator_invite: {
      component: true,
      description:
        "What an invitation letter the Operator wrote invites its reader to, beside its `operator_letter`: a reply to it is answered knowing the place and the role it grants, which that reader's own permissions cannot see.",
      properties: {
        invite: {
          type: 'string',
          description: "The invitation's eid in the directory.",
        },
        place: {
          type: 'string',
          description:
            'What accepting opens, as the letter names it: a title and the address it opens at.',
        },
        role: {
          type: 'string',
          description:
            'The role accepting gives them there: owner, editor or viewer.',
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
    operator_handoff: {
      component: true,
      description: 'Work an Operator sent for a person to another space.',
      properties: {
        person: { type: 'string', ref: 'person', death: 'keep' },
        space: { type: 'string', ref: 'entity', death: 'keep' },
        session: { type: 'string', ref: 'session', death: 'keep' },
        task: { type: 'string', ref: 'entity', death: 'keep' },
        previous: { type: 'string', ref: 'entity', death: 'keep' },
        notify: { type: 'boolean' },
        report: { type: 'string', ref: 'entity', death: 'keep' },
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
        message_id: {
          type: 'string',
          description:
            'The id its channel gave it as it went: a text’s. An answer by email is carried by a letter of its own (`mail.target`), whose `mail.message_id` it threads by.',
        },
        with: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'The answer that carries this one: a turn that answered several requests sent by the same way says it once, on the first.',
        },
      },
    },
    // Retired, kept until contraction: a person's wake-ups, subscriptions and
    // their runs are @yaks/wake's `wake{for, note, brief}`,
    // `watch{query, local, seen}` and `occurrence{wake, at, call, error}`
    // (operator-schedules.ts). A store's rows keep these beside the new words
    // the pass wrote (wake-move.ts), so a rollback still reads every schedule;
    // nothing else reads or writes them.
    operator_ask: {
      component: true,
      description:
        "Retired: what the space's Operator was asked each time this row fired, now the wake's own for, note and brief.",
      properties: {
        space: { type: 'string', ref: 'entity', death: 'keep' },
        person: { type: 'string', ref: 'person', death: 'keep' },
        administrative: { type: 'boolean' },
        say: { type: 'string' },
        helper: { type: 'string' },
      },
    },
    operator_work: {
      component: true,
      description:
        "Retired: one occurrence of scheduled Operator work, now @yaks/wake's occurrence.",
      properties: {
        schedule: { type: 'string', ref: 'entity', death: 'keep' },
        at: { type: 'string', format: 'date-time' },
        call: { type: 'string', ref: 'call', death: 'keep' },
        helper: { type: 'string', ref: 'session', death: 'keep' },
        error: { type: 'string' },
      },
    },
    operator_subscription: {
      component: true,
      description:
        "Retired: a query the space's Operator watched, now @yaks/wake's watch.",
      properties: {
        query: { type: 'string' },
        mine: { type: 'boolean' },
        seen: { type: 'object' },
      },
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
    operator_machine_stop: {
      effect: true,
      target: '.entry&.stop',
      created: ['stop'],
      tries: 3,
      description:
        'Ask the machine a stopped helper runs on to stop its run there (workers/yak operator-helpers.ts `stopOnMachine`); a stop of any other session asks nothing.',
    },
    operator_receive: {
      effect: true,
      created: ['operator_request'],
      tries: 3,
      description: 'Carry out one received request through the space operator.',
    },
    operator_handoff_send: {
      effect: true,
      created: ['operator_handoff'],
      tries: 5,
      description: 'Queue the handoff in the destination Operator store.',
    },
    operator_handoff_reply: {
      effect: true,
      created: ['operator_answer'],
      target:
        '.operator_answer.request.operator_request.channel=operator-handoff',
      tries: 5,
      description: 'Deliver a handoff report to the originating Operator.',
    },
    operator_deliver: {
      effect: true,
      created: ['operator_answer'],
      idempotent: false,
      tries: 3,
      description: 'Deliver a kept answer through its originating channel.',
    },
    // Declared here rather than beside @yaks/platform's `operator{name}`,
    // which it writes, because only this store runs it: on the box every
    // persona has a home, and nothing there would answer its runs.
    operator_named: {
      effect: true,
      target: '.persona.home',
      created: ['doc'],
      changed: ['doc.title'],
      tries: 5,
      description:
        "Copy the Operator's name, its persona's title, to its space's directory row, which lists, letters and pages read (operator-persona.ts `named`).",
    },
    draft_conflict: {
      component: true,
      description:
        "A property a released draft's preview and the live app both changed since the draft began, which this decision asks the person to settle: the draft's value or the live one (draft-merge.ts).",
      properties: {
        app: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description: 'The app whose live rows the draft merges into.',
        },
        branch: {
          type: 'number',
          description: "The branch of the app's store the draft wrote on.",
        },
        draft: { type: 'string', description: 'The draft released.' },
        eid: { type: 'string', description: 'The entity both changed.' },
        comp: { type: 'string' },
        prop: { type: 'string' },
        live: {
          type: 'string',
          description:
            'The live value as it was asked about, as JSON: a pick that saw another settles nothing, so a change on the live app since is never lost.',
        },
        by: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description: 'Who released the draft, who the merge is written as.',
        },
        via: {
          type: 'string',
          description: 'The instrument the release came through.',
        },
      },
    },
    draft_merge: {
      effect: true,
      target: '.draft_conflict',
      created: ['decided'],
      tries: 3,
      description:
        "Once every question of a released draft's merge is answered, merge the draft's branch into the app's live rows with those picks, and ask again about any property the live app changed since (draft-merge.ts `settled`).",
    },
    operator_alert: {
      effect: true,
      created: ['notification', 'decision'],
      idempotent: false,
      tries: 3,
      description:
        'Tell the person what the Operator tells or asks them, the way they chose to be alerted: a notification it wrote them, or a decision assigned to them, an approval among them (operator-alerts.ts).',
    },
    operator_decision_answer: {
      effect: true,
      target: '.decision !operator_approval !approval_ask',
      created: ['decided'],
      tries: 3,
      description:
        "Continue the Operator's work when its person answers a question.",
    },
    operator_approval_ask_answer: {
      effect: true,
      target: '.approval_ask',
      created: ['decided'],
      tries: 3,
      description:
        'An approval answered by someone else who may answer it, from their Updates or an alert: as operator_approval_answer, pressed as theirs.',
    },
    operator_approval_answer: {
      effect: true,
      target: '.operator_approval',
      created: ['decided'],
      tries: 3,
      description:
        "An approval answered as a decision, from the person's Updates or an alert: Approve carries out its act and anything else declines it, as its card or link would (operator-approvals.ts `approvals`).",
    },
  },
}

/** The `yak/operator` vocab facet: the Operator store's own words. */
export let docs: VocabDoc[] = [operatorDoc]
