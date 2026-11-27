// Notice subscriptions and their letters stay inside the app's store. Their
// owner is the app itself, so an ordinary public query cannot read addresses
// or the confirmation and unsubscribe links stored in outgoing letters.
import { effectsIn, type Vocab, type VocabDoc } from '@yaks/vocab'
import noticesJson from './vocab/notices.vocab.json' with { type: 'json' }

export let noticesDoc: VocabDoc = noticesJson as VocabDoc

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
