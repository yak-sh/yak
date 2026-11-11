// What happens after a sign-up commits: the `@yaks/forms/effects` entry
// point, the code behind `form_post` (./vocab.json).

import type { Handlers } from '@yaks/effects'
import type { Options } from './options.ts'
import { formPost } from './mail.ts'

export { formPost, lettered, PURPOSES, told } from './mail.ts'

/** `form_post`, writing a completed sign-up's letters as `options` say. */
export let effects = (_host: unknown, options: Options = {}): Handlers => ({
  form_post: formPost(options),
})
