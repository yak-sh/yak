// The owner's Ollama server (`ollama.yak.sh`, his GPU box — a local server on
// the proxmox subnet, NOT a hosted cloud; T-22774). Two surfaces live here over
// one config view:
//   - the OpenAI-compatible Responses API (`/v1`), for managed chat generation;
//   - the native embeddings endpoint (`/api/embed`), for the semantic corpus.
// Its base URL and API key are runtime configuration (config.ts): the base
// resolves graph override > environment > default, the key lives behind the
// server-only credential store. Both are read fresh at each request boundary
// through an injected `OllamaConfig`, so a save/reset reaches the next request —
// and the next readiness probe — without a tasksd restart. The key never enters
// a Session, prompt, child environment, or command line: it goes in only at the
// HTTP edge, as the bearer. An origin gets the OpenAI-compatible /v1 path for
// Responses; a base already ending in /v1 is left be. The native /api/embed
// call uses the bare origin instead.
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
export let envConfig: OllamaConfig = {
  base: () => resolve('OLLAMA_BASE_URL', () => undefined).value!,
  key: () => Promise.resolve(undefined),
}

export let ollamaTransport = (
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

// The bare origin for a native (non-/v1) call: drop a trailing slash and any
// /v1 the Responses side appends, so `/api/embed` hangs off the root.
let origin = (value: string) => value.trim().replace(/\/(?:v1\/?)?$/, '')

// Matryoshka (MRL) truncation: qwen3-embedding is MRL-trained, so a vector's
// leading `dims` coordinates are themselves a valid lower-dimension embedding.
// Slice to `dims` and L2-renormalize to restore unit length — the corpus stays
// at the fixed DIM (384) the blob shape and the KNN index are built for, with
// zero dimension blast radius. The renorm keeps cosine == dot for stored+query.
let mrl = (v: Float32Array, dims: number): Float32Array => {
  if (v.length < dims) {
    throw new Error(
      `ollama /api/embed returned ${v.length} dims, need ≥ ${dims} to truncate`,
    )
  }
  let out = v.slice(0, dims)
  let sum = 0
  for (let x of out) sum += x * x
  let inv = 1 / (Math.sqrt(sum) || 1)
  for (let i = 0; i < out.length; i++) out[i] *= inv
  return out
}

// The native embeddings transport: POST /api/embed on the bare origin, MRL-
// truncated + renormalized to `dims`. Ollama's /api/embed answers
// `{ embeddings: [[…]] }` for a single input. The key rides the header only when
// configured (the yak box is keyless over the local subnet). Throws on any
// transport, status, or shape fault — embed.ts catches it to keep the degrade-
// to-silence contract while recording the fault durably (M-16612).
export let ollamaEmbed = async (
  text: string,
  model: string,
  dims: number,
  config: OllamaConfig = envConfig,
  fetcher: typeof fetch = fetch,
): Promise<Float32Array> => {
  let headers = new Headers({ 'content-type': 'application/json' })
  let token = (await config.key())?.trim()
  if (token) headers.set('authorization', `Bearer ${token}`)
  let res = await fetcher(`${origin(config.base())}/api/embed`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`ollama /api/embed returned ${res.status}`)
  }
  let body = await res.json() as { embeddings?: number[][] }
  let raw = body.embeddings?.[0]
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error('ollama /api/embed returned no embedding')
  }
  return mrl(Float32Array.from(raw), dims)
}

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
