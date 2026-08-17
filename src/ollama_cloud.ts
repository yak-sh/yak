// Ollama's hosted Responses API. Its base URL and API key are runtime
// configuration (config.ts): the base resolves graph override > environment >
// default, the key lives behind the server-only credential store. Both are read
// fresh at each request boundary through an injected `OllamaConfig`, so a
// save/reset reaches the next request — and the next readiness probe — without a
// tasksd restart. The key never enters a Session, prompt, child environment, or
// command line: it goes in only at the HTTP edge, as the bearer. An origin gets
// Ollama's OpenAI-compatible /v1 path; a base already ending in /v1 is left be.
import { type ResponseOptions, responses } from './responses.ts'
import { resolve } from './config.ts'

let request = (value: Record<string, unknown>) =>
  Object.fromEntries(
    [
      'model',
      'input',
      'instructions',
      'tools',
      'temperature',
      'top_p',
      'max_output_tokens',
    ].flatMap((name) => value[name] === undefined ? [] : [[name, value[name]]]),
  )

// Append the OpenAI-compatible /v1 path to an origin; a base already ending in
// /v1 is used as-is. Idempotent against a canonical origin.
let versioned = (value: string) => {
  let root = value.trim().replace(/\/$/, '')
  return root.endsWith('/v1') ? root : `${root}/v1`
}

// A live view of Ollama's runtime configuration. `base` resolves OLLAMA_BASE_URL
// through the config catalog; `key` reads OLLAMA_API_KEY from the server-only
// credential store (undefined when unconfigured — the endpoint may be keyless).
// Both are called at the request boundary, never cached across requests.
export type OllamaConfig = {
  base: () => string
  key: () => Promise<string | undefined>
}

// The default view for a transport built without a server (tests, a bare
// client): the base from the config resolver with no graph plane (environment >
// default), and no key. A server passes a graph-backed config instead.
let envConfig: OllamaConfig = {
  base: () => resolve('OLLAMA_BASE_URL', () => undefined).value!,
  key: () => Promise.resolve(undefined),
}

export let ollamaCloudTransport = (
  options: Omit<ResponseOptions, 'credentials' | 'base'> = {},
  config: OllamaConfig = envConfig,
) =>
  responses({
    ...options,
    authentication: 'optional',
    // Ollama documents this exact non-stateful Responses subset. In
    // particular, OpenAI's encrypted reasoning replay and cache controls are
    // not part of the hosted contract.
    shape: (value) => ({ ...request(value), stream: true }),
    // Resolved per run: `responses` calls get() once at the start of each
    // request and holds the base + token for that request's retries, so an
    // in-flight request keeps the generation it began with.
    credentials: {
      get: async () => ({
        base: versioned(config.base()),
        token: (await config.key())?.trim() ?? '',
      }),
    },
  })

// A bounded, provider-safe readiness probe for the credential `test` action: a
// GET against the resolved base's /models with a short deadline. The secret is
// supplied by the credential store (already resolved, never logged here); the
// base comes from the same resolver the transport uses, so readiness and
// requests agree. A non-2xx or a transport failure throws — the credential
// service scrubs the message into a redacted diagnostic.
export let ollamaProbe = (
  base: () => string,
  fetcher: typeof fetch = fetch,
) =>
async (_key: string, secret: string | undefined): Promise<void> => {
  let headers = new Headers({ accept: 'application/json' })
  let token = secret?.trim()
  if (token) headers.set('authorization', `Bearer ${token}`)
  let response = await fetcher(`${versioned(base())}/models`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(5000),
  })
  await response.body?.cancel()
  if (!response.ok) throw new Error(`Ollama returned ${response.status}.`)
}
