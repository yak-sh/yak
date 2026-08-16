// Ollama's hosted Responses API. The API key is read only at the HTTP edge:
// it never enters a Session, prompt, child environment, or command line.
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

export let ollamaCloudReady = (
  read = () => Deno.env.get('OLLAMA_API_KEY'),
) => !!read()?.trim()

export let ollamaCloudTransport = (
  options: Omit<ResponseOptions, 'credentials' | 'base'> = {},
  read = () => Deno.env.get('OLLAMA_API_KEY'),
) =>
  responses({
    ...options,
    base: 'https://ollama.com/v1',
    // Ollama documents this exact non-stateful Responses subset. In
    // particular, OpenAI's encrypted reasoning replay and cache controls are
    // not part of the hosted contract.
    shape: (value) => ({ ...request(value), stream: true }),
    credentials: {
      get: () => Promise.resolve({ token: read()?.trim() ?? '' }),
    },
  })
