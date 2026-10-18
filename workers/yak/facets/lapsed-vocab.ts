// The directory's record of assistants that lost their sign-in (lapsed.ts).
import type { VocabDoc } from '@yaks/vocab'
import { owned, ref, text, time } from './schema.ts'
export let docs: VocabDoc[] = [{
  reserved: false,
  $defs: {
    lapsed: {
      description:
        "An assistant of this person's whose sign-in to yaks.app is gone, " +
        'until they connect it again.',
      component: true,
      type: 'object',
      journal: false,
      identity: ['person', 'agent'],
      properties: {
        person: ref('cascade'),
        agent: {
          ...text,
          description:
            'which assistant, as their Agents list names it (connected.ts ' +
            '`Agent.id`), or `any` when it is not known, which stands for ' +
            'every assistant',
        },
        known: owned({
          ...time,
          description: 'when they disconnected it themselves, which is no bug',
        }),
      },
    },
  },
}]
