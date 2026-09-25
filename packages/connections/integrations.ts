// Integrations: the outside services a connection can go through, as data.
//
// An integration says where a person signs in to a service and where its codes
// are exchanged, for one reached by OAuth, which hosts its credential may be
// sent to, and how a page shows it: its name, a line about it, its site and its
// logo. One with no token endpoint is reached with a pasted key instead.
//
// Every integration is an entity in the graph wearing `integration`, and one
// name is one entity. The ones this package builds ship as seed data, one JSON
// file each, which a host installs into its graph at start-up (`install`),
// trusted, since only the host may mark one `built`. Nothing reads the files
// after that: every lookup is a read of the graph. A custom one is a key for a
// service nobody built, or a builder's own OAuth client, made by `need` only
// where no integration holds the name yet — so no verb a space can reach
// writes over a built integration, or changes where its tokens are sent.

import {
  type Bundle,
  type Eid,
  identityEid,
  type Query,
  then,
} from '@yaks/graph'
import type { Scheme } from '@yaks/hook'
import googleCalendar from './google-calendar.json' with { type: 'json' }
import openrouter from './openrouter.json' with { type: 'json' }

export let INTEGRATION = 'integration'

/** An outside service, as data. */
export type Integration = {
  name: string
  /** what a person calls it: OpenRouter, Google Calendar */
  title?: string
  /** one line saying what it is, written for a person */
  tagline?: string
  /** its address on the web */
  site?: string
  /** its mark, as an SVG document, drawn as an image */
  logo?: string
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
  /** the OAuth client it signs in as, by name (./clients.ts): one registration
   * several integrations can share */
  client?: string
  /** the API hosts its credential may be sent to, and no others */
  hosts: string[]
  /** how the service signs the webhooks it sends */
  signature?: Scheme
  /** still in the service's testing mode, where only the people it lists may
   * sign in: offered only on a page opened with `?enable=<name>` */
  testing?: boolean
  /** installed from this package's seed data; only the host writes it */
  built?: boolean
}

/** A read of the graph: what a tool's context and a graph both offer. */
export type Read = (query: Query) => Bundle[] | Promise<Bundle[]>

// The integrations this package builds, as their seed files say them. The JSON
// types `answers` as any string, so OpenRouter's is said again as the word it
// is.
let SEEDS: Integration[] = [
  googleCalendar,
  { ...openrouter, answers: 'key' },
]

/** Whether a person connects it by pasting a key rather than signing in. */
export let keyed = (i: Integration): boolean => !i.token

/** Whether a person can connect it here: by pasting a key, through a sign-in
 * that answers a key to any caller (OpenRouter), or through the OAuth client
 * it names, once that client is kept (./clients.ts). */
export let connectable = (i: Integration, client?: unknown): boolean =>
  keyed(i) || i.answers == 'key' || !!client

/** An integration's entity: derived from its name, so one name is one
 * integration. */
export let integrationEid = (name: string): Eid =>
  identityEid(INTEGRATION, [name])

/** An integration by name, as the graph holds it. */
export let known = async (
  read: Read,
  name: string,
): Promise<Integration | undefined> => {
  let [b] = await read(`.eid=${integrationEid(name)}&.${INTEGRATION}`)
  return b?.[INTEGRATION] as Integration | undefined
}

/** The built integrations a graph holds. */
export let installed = async (read: Read): Promise<Integration[]> =>
  (await read(`.${INTEGRATION}.built`)).map((b) =>
    b[INTEGRATION] as Integration
  )

// A value in one order, so two that say the same thing compare equal: every
// object's properties sorted, and an absent one the same as a cleared one.
let canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v == 'object'
    ? Object.entries(v).filter(([, x]) => x != null)
      .sort(([a], [b]) => a < b ? -1 : 1).map(([k, x]) => [k, canon(x)])
    : v
let said = (v: unknown) => JSON.stringify(canon(v))

/**
 * The change that installs built integrations in a graph: each one missing
 * there, or held otherwise than its seed says, written whole — a property the
 * seed does not name is cleared — and marked `built`. Nothing, where every one
 * already matches. A host applies it trusted, since `built` is server-owned,
 * once at start-up. `seeds` defaults to this package's own.
 */
export let install = (
  read: Read,
  seeds: Integration[] = SEEDS,
): Bundle[] | Promise<Bundle[]> =>
  then(
    read(`.eid=${
      seeds.map((i) => integrationEid(i.name)).join(',')
    }&.${INTEGRATION}`),
    (found: Bundle[]) => {
      let held = new Map(found.map((b) => [b.entity.eid, b[INTEGRATION]]))
      return seeds.flatMap((seed) => {
        let eid = integrationEid(seed.name)
        let now: Record<string, unknown> = { ...seed, built: true }
        let was = held.get(eid) ?? {}
        let gone = Object.keys(was).filter((k) =>
          now[k] == null
        )
        return said(was) == said(now) ? [] : [{
          entity: { eid },
          [INTEGRATION]: {
            ...Object.fromEntries(gone.map((k) => [k, null])),
            ...now,
          },
        }]
      })
    },
  )
