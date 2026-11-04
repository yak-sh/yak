// Claude for the platform's own agents (the Operator, builders), on the
// platform's Anthropic key: a Worker secret like OPENAI_API_KEY, read at the
// moment of each call, and never handed to an app.
import { mark } from '@yaks/anthropic/mark'
import { anthropicDoc } from '@yaks/anthropic/vocab'
import { deferredModel, type Model, ModelError } from '@yaks/model'
import type { Env } from './env.ts'

/** Which provider serves a model name: Workers AI's are `@cf/…`,
 * Anthropic's `claude-…`, and any other is OpenAI's. */
export let providerOf = (name: string): string =>
  name.startsWith('@cf/')
    ? 'workers-ai'
    : name.startsWith('claude-')
    ? 'anthropic'
    : 'openai'

/** The Messages API on the platform's key; without one, every call is
 * refused as a missing key. */
export let claude = (env: Env): Model => {
  let options = {
    key: () =>
      env.ANTHROPIC_API_KEY ??
        Promise.reject(
          new ModelError('key', 'yaks.app has no Anthropic key yet'),
        ),
    fetch: env.MODEL_FETCH,
    base: env.ANTHROPIC_API,
  }
  return deferredModel(
    () => import('@yaks/anthropic').then(({ messages }) => messages(options)),
    { mark, vocab: anthropicDoc, anchor: () => undefined, info: true },
  )
}
