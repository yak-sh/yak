// The business's own vocabulary: what the story's graph adds to the packages
// it is made of, as a yaks app's vocab.json would. Its rules are queries the
// graph runs inside every write, whoever writes.
import type { VocabDoc } from '@yaks/vocab'

/** The shop's address, which its letters go from, and yours. */
export const SHOP = 'hello@example.com'
export const YOURS = 'you@example.com'

export let shopDoc = {
  title: 'shop',
  $defs: {
    letter_from: {
      rule: true,
      match: `.mail .deliver !mail.from, *mail.from="${SHOP}"`,
      description:
        "A letter that names no sender goes from the shop's address.",
    },
    mailed: {
      component: true,
      type: 'object',
      description: 'A letter about this went to the one it asks.',
    },
    question_mail: {
      rule: true,
      match:
        '$q .decision !decided +!mailed, filed.assignee=$p, doc.title=$t; $p .email; +doc.title=$t, +doc.body="Reply with the number of a choice or answer in your own words.", +mail.target=$q, +deliver.to=$p',
      description:
        'A question for someone with an address is also a letter to them about it, once, which a reply answers.',
    },
  },
} as unknown as VocabDoc
