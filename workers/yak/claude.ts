// Claude for the platform's own agents (the Operator, builders), on the
// platform's Anthropic key: a Worker secret like OPENAI_API_KEY, read at the
// moment of each call, and never handed to an app.
import { messages } from '@yaks/anthropic'
import { type Model, ModelError } from '@yaks/model'
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
export let claude = (env: Env): Model =>
  messages({
    key: () =>
      env.ANTHROPIC_API_KEY ??
        Promise.reject(
          new ModelError('key', 'yaks.app has no Anthropic key yet'),
        ),
    fetch: env.MODEL_FETCH,
    base: env.ANTHROPIC_API,
  })
