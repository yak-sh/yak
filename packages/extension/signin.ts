// Signing in: the host's own OAuth door, asked as a public client the
// extension registers for itself (dynamic registration, RFC 7591), and the
// authorization-code flow with PKCE that @yaks/oauth runs for a provider given
// as data. The redirect is the browser's own for the extension
// (`chrome.identity.getRedirectURL()`, `https://<id>.chromiumapp.org/`), so
// each installation registers its own client.

import type { AuthorizationStore, Provider, Tokens } from '@yaks/oauth'
import type { Config } from './connect.ts'

/** The host's OAuth door, as the paths every host of this kind serves. */
export let DOOR = {
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  register: '/oauth/register',
  scope: 'graph',
}

/** A dynamic-registration request (RFC 7591 §2). */
export type Registration = {
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: string
}

/** The dynamic-registration request for a public client at `redirect`. */
export let registration = (config: Config, redirect: string): Registration => ({
  client_name: config.name,
  redirect_uris: [redirect],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
})

/** Register a public client with the host, and answer its id. */
export let register = async (
  config: Config,
  redirect: string,
  ask: typeof fetch = fetch,
): Promise<string> => {
  let res = await ask(config.origin + DOOR.register, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registration(config, redirect)),
  })
  let body = await res.json().catch(() => ({}))
  if (!res.ok || typeof body?.client_id != 'string') {
    throw new Error(`${config.name} refused to register the extension.`)
  }
  return body.client_id
}

/** The host as an OAuth provider, for the client it registered. */
export let provider = (config: Config, client: string): Provider => ({
  authorize: config.origin + DOOR.authorize,
  token: config.origin + DOOR.token,
  scopes: [DOOR.scope],
  client: { id: client },
})

/** Where a store keeps values: `chrome.storage.local` in the browser, a Map
 * in a test. */
export type Area = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

/** A grant store over an area. Updates run one at a time, so two callers
 * refreshing at once never both spend the refresh token, and a record is
 * saved even when its update throws (@yaks/oauth's `AuthorizationStore`). */
export let kept = (area: Area): AuthorizationStore<Tokens> => {
  let queue: Promise<unknown> = Promise.resolve()
  let read = async (key: string) => {
    let v = await area.get(key)
    return v && typeof v == 'object' ? { ...v } : undefined
  }
  return {
    read,
    update: (key, fn) => {
      let run = queue.then(async () => {
        let record: Tokens = (await read(key)) ?? {}
        try {
          return await fn(record)
        } finally {
          await area.set(key, record)
        }
      })
      queue = run.catch(() => {})
      return run
    },
  }
}
