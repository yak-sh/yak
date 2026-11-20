// The directory's outreach trials (./outreach.ts, ./outreach-trial.ts): what every space's Operator
// would write its people, given what changed lately, kept as rows for the
// platform admin to read and never sent.
import type { VocabDoc } from '@yaks/vocab'

let at = (description: string) => ({
  type: 'string',
  format: 'date-time',
  description,
})

export let docs: VocabDoc[] = [{
  $defs: {
    outreach_trial: {
      component: true,
      journal: false,
      type: 'object',
      properties: {
        changelog: {
          type: 'string',
          description:
            'what yaks.app can do now that it could not lately, in the words the admin gave',
        },
        provider: {
          type: 'string',
          description:
            "the provider of the model each letter is written by: the admin's, else the one the Operator's base persona names, kept once the batch is sent",
        },
        model: {
          type: 'string',
          description: 'the model each letter is written by, as `provider` is',
        },
      },
      description:
        'a trial run of the Operators writing to their people between visits: one letter per space, from its own apps and use and the changelog, written in one batch and kept as `outreach_letter` rows. Nothing is sent',
    },
    outreach_batch: {
      component: true,
      journal: false,
      type: 'object',
      properties: {
        id: { type: 'string', description: "the provider's batch id" },
        at: at('when the batch was sent'),
        spaces: { type: 'number', description: 'how many spaces it asks for' },
        shared: {
          type: 'string',
          description:
            "the prefix every request began with: the Operator's base persona, how these emails are written and the changelog",
        },
      },
      description:
        "a trial's batch, sent to the model's provider; its wake reads it until it has ended",
    },
    outreach_written: {
      component: true,
      journal: false,
      type: 'object',
      properties: {
        at: at('when its letters were read back'),
        letters: { type: 'number', description: 'how many letters came back' },
        dollars: {
          type: 'number',
          description: 'what the whole batch cost, at batch prices',
        },
      },
      description: "a trial's letters, read back from its finished batch",
    },
    outreach_letter: {
      component: true,
      journal: false,
      type: 'object',
      properties: {
        trial: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
          index: true,
          description: 'the trial it was written in',
        },
        space: {
          type: 'string',
          ref: 'space',
          death: 'cascade',
          description: 'the space whose Operator wrote it',
        },
        stage: {
          type: 'string',
          description:
            'where the space stood: nothing built, quiet, building, in use',
        },
        brief: {
          type: 'string',
          description:
            'what its Operator was told of the space after the shared prefix: its people, its apps and their use',
        },
        dollars: {
          type: 'number',
          description: 'what writing it cost, at batch prices',
        },
      },
      description:
        "what a space's Operator would email its people in a trial, its subject and words in `doc{title, body}` once written; never sent",
    },
    outreach_write: {
      effect: true,
      created: ['outreach_trial'],
      description:
        "send a new trial's batch: one request per space, each the space's own apps and use after a prefix every request shares",
    },
    outreach_read: {
      effect: true,
      created: ['fired'],
      changed: ['fired'],
      target: '.outreach_trial',
      description:
        "read a trial's batch when its wake fires: its letters once it has ended, else wake again later",
    },
  },
}]
