import { type Bundle, token } from '@yaks/graph'
import { owns } from '@yaks/member'

export type Binding = {
  fetch(path: string, init?: RequestInit): Promise<Response>
}
export type Who = {
  person?: string | null
  via?: string | null
  browsers?: string[]
}
export class Refusal extends Error {
  constructor(message: string, public status = 422) {
    super(message)
  }
}
export let who = (request: Request): Who => ({
  person: request.headers.get('x-yak-person'),
  via: request.headers.get('x-yak-via'),
  ...(request.headers.get('x-yak-person')
    ? {
      browsers: (request.headers.get('x-yak-browsers') ?? '').split(',').map((
        id,
      ) => id.trim()).filter(
        (id) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id),
      ),
    }
    : {}),
})
export let allowed = (access: { owner?: string; via?: string }, caller: Who) =>
  owns({ by: access.owner, via: access.via }, {
    by: caller.person,
    via: caller.via,
    browsers: caller.browsers,
  })
export let principal = (caller: Who) => {
  if (!caller.person && !caller.via) {
    throw new Refusal('Open this page again to start a saved draft.', 401)
  }
  return {
    ...(caller.person ? { owner: caller.person } : {}),
    ...(caller.via ? { via: caller.via } : {}),
  }
}
/** Keep upstream diagnostics out of the grouping message and in its cause. */
export let checked = async (
  answer: Response,
  message = 'PrintBound graph request failed',
): Promise<Response> => {
  if (answer.ok) return answer
  let body = await answer.text()
  if (answer.status >= 500) {
    throw new Error(`${message} (${answer.status})`, {
      cause: {
        status: answer.status,
        requestId: answer.headers.get('x-request-id'),
        body,
      },
    })
  }
  throw new Refusal(body, answer.status)
}
export let json = async <T>(answer: Response): Promise<T> =>
  (await checked(answer)).json()
export let store = (binding: Binding) => ({
  query: (q: string) =>
    binding.fetch('/query?q=' + encodeURIComponent(q)).then(json<Bundle[]>),
  apply: (entities: Bundle[]) =>
    binding.fetch('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entities }),
    }).then(json<{ bundles: Bundle[] }>),
})
export type Store = ReturnType<typeof store>
export let guard = (row: Bundle, components: string[]) =>
  Object.fromEntries(
    components.filter((name) => row[name]).map((
      name,
    ) => [
      name,
      Object.fromEntries(
        Object.entries(row[name] as Record<string, unknown>).map((
          [key, value],
        ) => [key, token(value)]),
      ),
    ]),
  )
export let identifier = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$|^[a-f0-9]{64}$/i.test(id)) {
    throw new Refusal('That saved book is not available.', 403)
  }
  return id
}
