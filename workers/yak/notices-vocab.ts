// Notice subscriptions and their letters stay inside the app's store. Their
// owner is the app itself, so an ordinary public query cannot read addresses
// or the confirmation and unsubscribe links stored in outgoing letters.
import { effectsIn, type Vocab, type VocabDoc } from '@yaks/vocab'
import { owned, ref, text, time } from './facets/schema.ts'

export let noticesDoc: VocabDoc = {
  $defs: {
    notice_subscription: {
      component: true,
      type: 'object',
      floor: 'owner',
      personal: 'owner',
      properties: {
        owner: owned(ref('keep')),
        root: owned(text),
        ticket: owned(text),
        requested_at: owned(time),
      },
      description:
        'An email recipient asking for this app’s notices; confirmed only after opening the letter’s link.',
    },
    notice_confirmed: {
      component: true,
      type: 'object',
      floor: 'owner',
      properties: { at: owned(time) },
      description: 'The recipient confirmed that this address wants notices.',
    },
    notice_posted: {
      component: true,
      type: 'object',
      floor: 'editor',
      properties: { at: { ...owned(time), default: { now: true } } },
      description:
        'When a row first became a posted notice, independently of when its draft was created.',
    },
    notice_letter: {
      component: true,
      type: 'object',
      floor: 'owner',
      personal: 'owner',
      properties: { owner: owned(ref('keep')) },
      description:
        'A private confirmation or notice letter, including its recipient and subscription links.',
    },
  },
}

export let noticeComponents = (doc: VocabDoc): string[] =>
  Object.entries(doc.$defs ?? {}).filter(([, s]) => s.notice === true)
    .map(([name]) => name)

export let noticeEnabled = (vocab: Vocab): boolean =>
  effectsIn(vocab.docs).some(({ name }) => name == 'notice_post')

export let noticeEffects = (doc: VocabDoc): VocabDoc =>
  noticeComponents(doc).length
    ? ({
      $defs: {
        notice_post: {
          effect: true,
          created: noticeComponents(doc),
          description:
            'Send a newly posted notice to its confirmed email subscribers.',
        },
      },
    })
    : {}
