// Ollama's hosted Responses API. Configuration is read only at the HTTP edge:
// an optional API key never enters a Session, prompt, child environment, or
// command line. An origin gets Ollama's OpenAI-compatible /v1 path; a full /v1
// base is left alone.
import { type ResponseOptions, responses } from './responses.ts'

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

let base = (value = 'https://ollama.yak.sh/') => {
  let root = value.trim().replace(/\/$/, '')
  return root.endsWith('/v1') ? root : `${root}/v1`
}

type Environment = (name: string) => string | undefined

export let ollamaCloudTransport = (
  options: Omit<ResponseOptions, 'credentials' | 'base'> = {},
  read: Environment = (name) => Deno.env.get(name),
) =>
  responses({
    ...options,
    base: base(read('OLLAMA_BASE_URL')),
    authentication: 'optional',
    // Ollama documents this exact non-stateful Responses subset. In
    // particular, OpenAI's encrypted reasoning replay and cache controls are
    // not part of the hosted contract.
    shape: (value) => ({ ...request(value), stream: true }),
    credentials: {
      get: () =>
        Promise.resolve({ token: read('OLLAMA_API_KEY')?.trim() ?? '' }),
    },
  })
