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

import { after, cmp } from '@yaks/fp'
import type { Bundle, Eid, Query } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import type { Scheme } from '@yaks/hook'
import { CallError } from '@yaks/tools/errors'
import { INTEGRATION, integrationEid } from './identity.ts'
import googleCalendar from './google-calendar.json' with { type: 'json' }
import openrouter from './openrouter.json' with { type: 'json' }
import openai from './openai.json' with { type: 'json' }

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
  /** OpenID endpoint naming the account when no id_token is returned. */
  userinfo?: string
  /** what a connection asks for when nothing narrower was needed */
  scopes?: string[]
  /** extra authorize parameters, such as Google's `access_type: 'offline'` */
  params?: Record<string, string>
  /** how the client authenticates at the token endpoint (@yaks/oauth) */
  auth?: 'basic' | 'post'
  /** how refresh grants are sent when a provider requires JSON */
  refresh_encoding?: 'form' | 'json'
  /** what the exchange answers: tokens, or a key, as OpenRouter's does */
  answers?: 'tokens' | 'key'
  /** the resource a grant is for (RFC 8707), as an MCP server asks */
  resource?: string
  /** the issuer its returns name (RFC 9207), where it says it names one */
  issuer?: string
  /** the OAuth client it signs in as, by name (./clients.ts): one registration
   * several integrations can share */
  client?: string
  /** a public OAuth client's id; no secret or registration is needed */
  client_id?: string
  /** the API hosts its credential may be sent to, and no others */
  hosts: string[]
  /** how the service signs the webhooks it sends */
  signature?: Scheme
  /** still in the service's testing mode, where only the people it lists may
   * sign in: offered only on a page opened with `?enable=<name>` */
  testing?: boolean
  /** installed from this package's seed data; only the host writes it */
  built?: boolean
  /** how a person gets the credential, in markdown, for them and their agent */
  instructions?: string
  /** the space or person that made a custom one, who alone may change its
   * text; none for a built one */
  owner?: string
}

/** A read of the graph: what a tool's context and a graph both offer. */
export type Read = (query: Query) => Bundle[] | Promise<Bundle[]>

// The integrations this package builds, as their seed files say them. The JSON
// types `answers` as any string, so OpenRouter's is said again as the word it
// is.
let SEEDS: Integration[] = [
  googleCalendar,
  { ...openai, refresh_encoding: 'json' },
  { ...openrouter, answers: 'key' },
]

/** Whether a person connects it by pasting a key rather than signing in. */
export let keyed = (i: Integration): boolean => !i.token

/** Whether a person can connect it here: by pasting a key, through a sign-in
 * that answers a key to any caller (OpenRouter), or through the OAuth client
 * it names, once that client is kept (./clients.ts). */
export let connectable = (i: Integration, client?: unknown): boolean =>
  keyed(i) || i.answers == 'key' || !!i.client_id || !!client

/** An integration by name, as the graph holds it. */
export let known = async (
  read: Read,
  name: string,
): Promise<Integration | undefined> => {
  let [b] = await read(`.entity.eid=${integrationEid(name)}&.${INTEGRATION}`)
  return b?.[INTEGRATION] as Integration | undefined
}

/** The built integrations a graph holds. */
export let installed = async (read: Read): Promise<Integration[]> =>
  (await read(`.${INTEGRATION}.built`)).map((b) =>
    b[INTEGRATION] as Integration
  )

/** What a person reads about an integration, which its owner may change:
 * never where its credential is sent. */
export type About = Pick<
  Integration,
  'title' | 'tagline' | 'site' | 'instructions'
>
/** The properties of {@link About}, in the order a page shows them. */
export let ABOUT = ['title', 'tagline', 'site', 'instructions'] as const

/** What was said about an integration, as it is written: each property given,
 * trimmed, and an empty one cleared. A site is an https address, the only
 * kind a page links. */
export let told = (
  a: Record<string, unknown>,
): Record<string, string | null> => {
  let out: Record<string, string | null> = {}
  for (let k of ABOUT) {
    if (a[k] == null) continue
    let v = String(a[k]).trim()
    if (k == 'site' && v && !/^https:\/\/[^\s/]+\S*$/.test(v)) {
      throw new CallError('site', `a site is an https address, not ${v}`)
    }
    out[k] = v || null
  }
  return out
}

/** An integration's owner changing what is said about it. A built one is the
 * host's, and one with no owner (made before owners were kept, or whose owner
 * is gone) is nobody's to change. */
export let set = async (
  read: Read,
  a: About & { owner: Eid; integration: string },
): Promise<Bundle[]> => {
  let name = a.integration
  let i = await known(read, name)
  if (!i) {
    throw new CallError('integration', `no integration is named ${name}`)
  }
  if (i.built) {
    throw new CallError(
      'integration',
      `${name} is built, and only the host changes it`,
    )
  }
  if (i.owner != a.owner) {
    throw new CallError('owner', `only the space that made ${name} changes it`)
  }
  let patch = told(a)
  return Object.keys(patch).length
    ? [{
      entity: { eid: integrationEid(name) },
      [INTEGRATION]: patch,
      $was: { [INTEGRATION]: { owner: token(i.owner) } },
    }]
    : []
}

// A value in one order, so two that say the same thing compare equal: every
// object's properties sorted, and an absent one the same as a cleared one.
let canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v == 'object'
    ? Object.entries(v).filter(([, x]) => x != null)
      .sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, canon(x)])
    : v
let said = (v: unknown) => JSON.stringify(canon(v))

/**
 * The batch that installs built integrations in a graph: each one missing
 * there, or held otherwise than its seed says, written whole — a property the
 * seed does not name is cleared — and marked `built`. Nothing, where every one
 * already matches. A host applies it trusted, since `built` is server-owned,
 * once at start-up. `seeds` defaults to this package's own.
 */
export let install = (
  read: Read,
  seeds: Integration[] = SEEDS,
): Bundle[] | Promise<Bundle[]> =>
  after(
    read(`.entity.eid=${
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
