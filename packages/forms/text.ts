// A sign-up by text: which texts are a carrier's command and which answer the
// question the sign-up owes.

import { type Keyword, keyword } from '@yaks/phone'

/** The carrier command a text is, or null for a text that answers a form
 * question: a bare yes answers one, and the named commands (STOP, HELP and
 * their aliases) keep their meaning. */
/// formKeyword('Yes!') -> null
/// formKeyword('STOP') -> 'stop'
/// formKeyword('Ann Park') -> null
export let formKeyword = (text: string): Keyword | null =>
  /^\W*yes\W*$/i.test(text.trim()) ? null : keyword(text)
