/**
 * @yaks/openai serves {@link https://jsr.io/@yaks/model | @yaks/model}'s seam
 * over OpenAI's Responses API: one streamed exchange over `fetch`, a bearer
 * from the environment or the Codex CLI's sign-in, and the two endpoints
 * those bearers open. It records nothing and keeps no process; a daemon that
 * wants a model calls {@link responses} and gets a `Model`.
 *
 * ```ts
 * import { credential, responses } from '@yaks/openai'
 *
 * let model = responses({
 *   credential: credential(Deno.env.get, Deno.readTextFile),
 * })
 * let reply = await model({
 *   model: 'gpt-6-astra',
 *   items: [{ kind: 'user', text: 'hi' }],
 *   tools: [],
 * })
 * ```
 *
 * @module
 */

export {
  CODEX,
  codexPaths,
  type Credential,
  credential,
  fromCodex,
  fromEnv,
  OPENAI,
} from './credential.ts'
export {
  body,
  frames,
  input,
  items,
  OPENAI_COMP,
  openaiDoc,
  type Options,
  responses,
} from './responses.ts'
