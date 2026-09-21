// The mail components, and only those: the `@yaks/mail/vocab` entry point. It
// imports no storage, no SQL and no runtime, so a browser tab that loads this
// vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { mailDoc } from './comp.ts'

export { mailDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [mailDoc]
