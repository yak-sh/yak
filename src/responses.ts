// Tasks adds only observation vocabulary and the redaction policy. The wire,
// credentials, retries, watchdog, and provider evidence belong to @yaks/openai.
import {
  type CredentialSource as TransportCredentials,
  type ResponseEvent,
  type ResponseOptions as TransportOptions,
  transport,
  type TransportCredential as Credential,
} from '@yaks/openai'
import type { ObservationDelta } from './observations.ts'

export {
  CREDENTIAL_FAULT,
  type RateLimits,
  type ResponseEvent,
  type ResponseFault,
  type ResponseItem,
  type ResponseRequest,
  type ResponseResult,
  type ResponseUsage,
  type TransportCredential as Credential,
} from '@yaks/openai'

// Server credential sources are asynchronous (the package also accepts sync).
export type CredentialSource = Omit<TransportCredentials, 'get' | 'refresh'> & {
  get: () => Promise<Credential>
  refresh?: () => Promise<Credential>
}

export type ResponseOptions =
  & Omit<TransportOptions, 'store' | 'redact' | 'credentials'>
  & {
    credentials: CredentialSource
  }

// How long a turn keeps waiting out a backend incident before it gives up. A
// 503 or a bus gone silent answers every attempt the same way, so the wire's
// three attempts are spent in five seconds and the Session settles `failed`
// over a blip (T-37332). Ten minutes of capped backoff outlives an ordinary
// outage; a longer one still ends the session, honestly.
export let PATIENCE_MS = 600_000

export let responses = (options: ResponseOptions) =>
  transport({ ...options, store: false, redact: true })

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

// Only named scalar fields cross from the OpenAI dialect into the Tasks
// observation vocabulary. Completed items take the durable runner path;
// these deltas are hints for a watcher who is connected right now.
export let responseObservation = (
  event: ResponseEvent,
): ObservationDelta | undefined => {
  if (
    event.type == 'response.output_text.delta' ||
    event.type == 'response.refusal.delta'
  ) {
    return typeof event.delta == 'string' && event.delta
      ? { kind: 'model', text: event.delta }
      : undefined
  }
  if (event.type == 'response.reasoning_summary_text.delta') {
    return typeof event.delta == 'string' && event.delta
      ? { kind: 'reasoning', text: event.delta }
      : undefined
  }
  if (event.type == 'response.output_item.added' && record(event.item)) {
    let item = event.item
    if (item.type == 'function_call' || item.type == 'custom_tool_call') {
      return {
        kind: 'tool',
        name: typeof item.name == 'string' ? item.name : 'tool',
      }
    }
  }
  return undefined
}
