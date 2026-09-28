/**
 * @yaks/openai implements {@link https://jsr.io/@yaks/model | @yaks/model}'s
 * `Model` interface over OpenAI's Responses API: one streamed exchange over
 * `fetch`, a bearer an application supplies, and the endpoint it reaches. It
 * stores nothing and starts no process; a server that wants a model calls
 * {@link responses} and gets back a `Model`.
 *
 * ```ts ignore
 * import { fromEnv, responses } from '@yaks/openai'
 *
 * let model = responses({
 *   credential: () => fromEnv(Deno.env.get)!,
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
  type Credential,
  fromChatGPT,
  fromEnv,
  OPENAI,
} from './credential.ts'
export {
  body,
  input,
  items,
  OPENAI_COMP,
  openaiDoc,
  type Options,
  responses,
} from './responses.ts'

export {
  CREDENTIAL_FAULT,
  type CredentialSource,
  frames,
  type RateLimits,
  ResponseError,
  type ResponseEvent,
  type ResponseFault,
  type ResponseItem,
  type ResponseOptions,
  type ResponseRequest,
  type ResponseResult,
  type ResponseUsage,
  type RunOptions,
  transport,
  type TransportCredential,
} from './transport.ts'

export type { ImageGeneration, Images } from './images.ts'
export { generatedBytes, generatedMedia } from './media.ts'
export type { MediaStore } from './media.ts'
export { jsonFrames } from './sse.ts'
