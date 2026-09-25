// Integrations: the outside services a connection can go through, as data.
//
// An integration says where a person signs in to a service and where its codes
// are exchanged, for one reached by OAuth, and which hosts its credential may be
// sent to. One with no token endpoint is reached with a pasted key instead.
//
// The integrations this package builds ship with it as data, one JSON file
// each, named for the integration and listed in `BUILT`. A custom one is an
// entity in the space wearing `integration`: a key for a service nobody built,
// or a builder's own OAuth client. A built name is never a custom one's —
// `need` refuses to make one, and a lookup finds the built one first — so a
// space cannot change where a built integration's tokens are sent.

import { type Bundle, type Eid, identityEid, type Query } from '@yaks/graph'
import type { Scheme } from '@yaks/hook'
import googleCalendar from './google-calendar.json' with { type: 'json' }
import openrouter from './openrouter.json' with { type: 'json' }

export let INTEGRATION = 'integration'

/** An outside service, as data. */
export type Integration = {
  name: string
  /** where a person grants access (OAuth) */
  authorize?: string
  /** where codes and refresh tokens are exchanged; none means a pasted key */
  token?: string
  /** what a connection asks for when nothing narrower was needed */
  scopes?: string[]
  /** extra authorize parameters, such as Google's `access_type: 'offline'` */
  params?: Record<string, string>
  /** how the client authenticates at the token endpoint (@yaks/oauth) */
  auth?: 'basic' | 'post'
  /** what the exchange answers: tokens, or a key, as OpenRouter's does */
  answers?: 'tokens' | 'key'
  /** the resource a grant is for (RFC 8707), as an MCP server asks */
  resource?: string
  /** the issuer its returns name (RFC 9207), where it says it names one */
  issuer?: string
  /** a public client registered with it for this host (RFC 7591), as an MCP
   * server asks */
  client?: string
  /** the API hosts its credential may be sent to, and no others */
  hosts: string[]
  /** how the service signs the webhooks it sends */
  signature?: Scheme
}

/** A read of the graph: what a tool's context and a graph both offer. */
export type Read = (query: Query) => Bundle[] | Promise<Bundle[]>

/** The integrations this package builds, by name. */
export let BUILT: Record<string, Integration> = {
  // `access_type: offline` is what makes Google issue a refresh token, and
  // `prompt: consent` makes it issue one again when a person connects anew.
  'google-calendar': googleCalendar,
  openrouter: { ...openrouter, answers: 'key' },
}

/** Whether a person connects it by pasting a key rather than signing in. */
export let keyed = (i: Integration): boolean => !i.token

/** Whether a person can connect it here: by pasting a key, through a sign-in
 * that answers a key to any caller (OpenRouter), or through the OAuth client
 * this host is registered as with it. */
export let connectable = (i: Integration, client?: unknown): boolean =>
  keyed(i) || i.answers == 'key' || !!client

/** A custom integration's entity: derived from its name, so one name is one
 * integration. */
export let integrationEid = (name: string): Eid =>
  identityEid(INTEGRATION, [name])

/** An integration by name: a built one, else the space's own. */
export let known = async (
  read: Read,
  name: string,
  built: Record<string, Integration> = BUILT,
): Promise<Integration | undefined> => {
  if (Object.hasOwn(built, name)) return built[name]
  let [b] = await read(`.eid=${integrationEid(name)}&.${INTEGRATION}`)
  return b?.[INTEGRATION] as Integration | undefined
}
