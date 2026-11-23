// Integrations: the outside services a connection can go through, as data.
//
// An integration says where a person signs in to a service and where its codes
// are exchanged, for one reached by OAuth, which hosts its credential may be
// sent to, and how a page shows it: its name, a line about it, its site and its
// logo. One with no token endpoint is reached with a pasted key instead, or
// with the several fields it names (`fields`): S3's access key ID, secret key
// and region. One key is the case of one field, named `key`.
//
// Every integration is an entity in the graph wearing `integration`, and one
// name is one entity. The ones this package builds ship as seed data, one JSON
// file each, which a host installs into its graph at start-up (`install`),
// trusted, since only the host may mark one `built`. Nothing reads the files
// after that: every lookup is a read of the graph. A custom one is a key for a
// service nobody built, or a builder's own OAuth client, made by `need` only
// where no integration holds the name yet — so no verb a space can reach
// writes over a built integration, or changes where its tokens are sent.

import { line, sub } from '@yaks/query'
import { after, cmp } from '@yaks/fp'
import type { Bundle, Eid, Reads } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import type { Scheme } from '@yaks/hook'
import { CallError } from '@yaks/tools/errors'
import { INTEGRATION, integrationEid } from './identity.ts'
import anthropic from './anthropic.json' with { type: 'json' }
import canva from './canva.json' with { type: 'json' }
import gmail from './gmail.json' with { type: 'json' }
import discord from './discord.json' with { type: 'json' }
import discordAccount from './discord-account.json' with { type: 'json' }
import discordBot from './discord-bot.json' with { type: 'json' }
import elevenlabs from './elevenlabs.json' with { type: 'json' }
import googleCalendar from './google-calendar.json' with { type: 'json' }
import googleDrive from './google-drive.json' with { type: 'json' }
import googleSearchConsole from './google-search-console.json' with {
  type: 'json',
}
import openrouter from './openrouter.json' with { type: 'json' }
import openai from './openai.json' with { type: 'json' }
import voipms from './voipms.json' with { type: 'json' }

/** An outside service, as data. */
export type Integration = {
  name: string
  /** A hosted service; operation declarations stay with the app release. */
  service?: { app: string }
  /** what a person calls it: OpenRouter, Google Calendar */
  title?: string
  /** one line saying what it is, written for a person */
  tagline?: string
  /** its address on the web */
  site?: string
  description?: string
  details?: string
  docs?: string
  connects?: 'key' | 'signin' | 'client'
  categories?: string[]
  image?: string
  /** its mark, as an SVG document, drawn as an image */
  logo?: string
  /** where a person grants access (OAuth) */
  authorize?: string
  /** where codes and refresh tokens are exchanged; none means a pasted key */
  token?: string
  /** OpenID endpoint naming the account when no id_token is returned. */
  userinfo?: string
  /** the field that names the account, as a dotted path, where it is not an
   * email address: of the token endpoint's answer (Discord's `guild.id`, the
   * server its bot was added to; @yaks/oauth `Provider.account`), else of
   * the `userinfo` answer (a Discord user's `id`) */
  account?: string
  /** the field that names that account for people, as a dotted path of the
   * same answer: the server's name (`guild.name`), a Discord user's
   * `global_name` */
  account_title?: string
  /** another integration naming the person who signs in through this one,
   * whose own connection the same sign-in makes: Discord's bot added with
   * `identify` granted also links the Discord account of whoever added it
   * (`discord-account`) */
  links?: string
  /** a person's own account at the service (a Discord user), which says who
   * they are there: a connection through it is its connector's, never the
   * space's */
  personal?: boolean
  /** the chat platform its connections talk through (@yaks/chat), by name:
   * connecting it is all it takes for the Operator and the space's apps to
   * hear and answer there */
  chat?: string
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
  /** the broker new connections through it are made through (./brokers.ts),
   * and what the broker calls it; none is direct */
  broker?: { name: string; integration: string }
  /** the API hosts its credential may be sent to, and no others */
  hosts: string[]
  /** its API: the address its paths are under, its reference, and the calls
   * that only read though their method is not GET (`POST /freeBusy`, `*` for
   * one segment); none is reached at its first host */
  api?: { base: string; docs?: string }
  /** the only API methods a connection through it may ask for, where the
   * service names one in each request (voip.ms's `method`); none limits
   * nothing */
  methods?: string[]
  /** what a person gives to connect a pasted-key one, when it is more than
   * one key; none is one key */
  fields?: Field[]
  /** how the service signs the webhooks it sends */
  signature?: Scheme
  /** still in the service's testing mode, where only the people it lists may
   * sign in: offered only on a page opened with `?enable=<name>` */
  testing?: boolean
  /** installed from this package's seed data; only the host writes it */
  built?: boolean
  /** how a person gets the credential, in markdown, for them and their agent */
  instructions?: string
  /** what its one key looks like, shown in the box it is pasted in:
   * ElevenLabs' `sk_••••••••` */
  example?: string
  /** the space or person that made a custom one, who alone may change its
   * text; none for a built one */
  owner?: string
}

/** One thing a person gives to connect a pasted-key integration: what an app
 * reads it by, what the page asks for it by, whether it is typed in the open,
 * as a username or a region is, and what it looks like. */
export type Field = {
  name: string
  label: string
  shown?: boolean
  example?: string
}

/** The one field of an integration that declares none: its key. */
export let KEY: Field = { name: 'key', label: 'Key' }

/** What a person gives to connect a pasted-key integration, in the order the
 * page asks for it: the fields it declares, or its one key, shaped as the
 * integration says. */
export let fieldsOf = (i?: Integration): Field[] =>
  i?.fields?.length
    ? i.fields
    : [i?.example ? { ...KEY, example: i.example } : KEY]

/** A read of the graph: what a tool's context and a graph both offer. */
export type Read = Reads<Bundle[] | Promise<Bundle[]>, []>

// The integrations this package builds, as their seed files say them. The JSON
// types `answers` as any string, so OpenRouter's is said again as the word it
// is.
let SEEDS: Integration[] = [
  anthropic,
  canva,
  discord,
  discordAccount,
  discordBot,
  elevenlabs,
  gmail,
  googleCalendar,
  googleDrive,
  googleSearchConsole,
  { ...openai, refresh_encoding: 'json' },
  { ...openrouter, answers: 'key' },
  voipms,
]

/** The integrations this package builds, as shipped: what `install` writes,
 * read here with no graph, for a host that only needs to know them. */
export let seeds = (): Integration[] => SEEDS

/** Whether a person connects it by pasting a key rather than signing in:
 * one with no token endpoint and no broker to sign in through. */
export let keyed = (i: Integration): boolean => !i.token && !i.broker

/** Whether a person can connect it here: by pasting a key, through a sign-in
 * that answers a key to any caller (OpenRouter), or through what it signs in
 * with once that is kept (`kept`): its broker, when it names one
 * (./brokers.ts), else the OAuth client it names (./clients.ts). */
export let connectable = (i: Integration, kept?: unknown): boolean =>
  i.broker ? !!kept : keyed(i) || i.answers == 'key' || !!i.client_id || !!kept

/** An integration by name, as the graph holds it. */
export let known = async (
  read: Read,
  name: string,
): Promise<Integration | undefined> => {
  let [b] = await read(
    line`.entity.eid=${integrationEid(name)}&.${INTEGRATION}`,
  )
  return b?.[INTEGRATION] as Integration | undefined
}

/** The built integration that stands in for the service `name`: the one of
 * that name, else one signing in through a broker's listing of it (Gmail for
 * Nango's google-mail). The catalog offers, the directory lists and the
 * connections page adds that one in the listing's place. */
export let standIn = <I extends Integration>(
  built: I[],
  name: string,
  broker?: string,
): I | undefined =>
  built.find((i) => i.built && i.name == name) ??
    built.find((i) =>
      i.built && i.broker?.integration == name &&
      (!broker || i.broker.name == broker)
    )

/** An integration by name, among rows already read: what `list` and
 * `borrowed` return beside their connections. */
export let knownIn = (
  rows: Bundle[],
  name: string,
): Integration | undefined =>
  rows.find((b) => b[INTEGRATION] && b.entity.eid == integrationEid(name))
    ?.[INTEGRATION] as Integration | undefined

/** The built integrations a graph holds. */
export let installed = async (read: Read): Promise<Integration[]> =>
  (await read(line`.${INTEGRATION}.built`)).map((b) =>
    b[INTEGRATION] as Integration
  )

/** The platform's mark that an integration is featured (@yaks/platform). */
export let FEATURED = 'featured'

/** An integration as the catalog and the directory read it: with whether the
 * platform featured it, which is the platform's mark rather than its own. */
export type Marked = Integration & { featured?: boolean }

let marked = (b: Bundle): Marked => ({
  ...b[INTEGRATION] as Integration,
  ...b[FEATURED] ? { featured: true } : {},
})

/** What a person reads at length about an integration: drawn only for the
 * one a page opens, read by name (`known`), and for those built here. */
export type Prose = 'description' | 'details' | 'docs' | 'instructions'

// Every property but its prose, which a catalog's card, search and offer
// read: a new property of an integration is a type error here until it is
// named, so a catalog never silently goes without one.
let CARRIED = {
  name: 1,
  service: 1,
  title: 1,
  tagline: 1,
  site: 1,
  connects: 1,
  categories: 1,
  image: 1,
  logo: 1,
  authorize: 1,
  token: 1,
  userinfo: 1,
  account: 1,
  account_title: 1,
  links: 1,
  personal: 1,
  chat: 1,
  scopes: 1,
  params: 1,
  auth: 1,
  refresh_encoding: 1,
  answers: 1,
  resource: 1,
  issuer: 1,
  client: 1,
  client_id: 1,
  broker: 1,
  hosts: 1,
  api: 1,
  methods: 1,
  fields: 1,
  example: 1,
  signature: 1,
  testing: 1,
  built: 1,
  owner: 1,
} satisfies Record<Exclude<keyof Integration, Prose>, 1>
let CATALOGUED = [
  ...Object.keys(CARRIED).map((p) => `${INTEGRATION}.${p}`),
  FEATURED,
]

/** The host catalog's rows, including integrations not connected yet: those
 * built here whole, the rest without their prose (`Prose`), which is half of
 * each and drawn only for the one a page opens. */
export let catalogued = async (read: Read): Promise<Marked[]> => {
  let [whole, rest] = await Promise.all([
    read(line`.${INTEGRATION}.built=true&?${FEATURED}`),
    read(line`.${INTEGRATION}&!${INTEGRATION}.owner&.fields=${CATALOGUED}`),
  ])
  let built = new Map(whole.map((b) => [b.entity.eid, b]))
  return [...whole, ...rest.filter((b) => !built.has(b.entity.eid))]
    .map(marked)
    .filter((i) => !i.owner && (i.built || Array.isArray(i.categories)))
}

// What moves whenever the catalog does: its newest integration, its newest
// edit, and which ones are featured, a few dozen rows. A custom integration
// is its owner's and no catalog's, and nothing deletes one (an owner's death
// detaches it), so these see every change the catalog makes, while the rest
// of the store moves none of them.
let SHOWN = line`.${INTEGRATION}&!${INTEGRATION}.owner`
let STAMP = [
  line`${sub(SHOWN)}&.order=-created.at&.limit=1&.fields=created.at`,
  line`${sub(SHOWN)}&.order=-updated.at&.limit=1&.fields=updated.at`,
  line`${sub(SHOWN)}&.${FEATURED}&.fields=${FEATURED}.at`,
]

/** The host catalog (`catalogued`), read again only once it changed: each
 * call reads a stamp of a few rows beside the rest of its moment, and the
 * whole only when the stamp moved, or beside the stamp when none is held yet.
 * The rows are shared by every caller, so none changes them. */
export let catalogHeld = (): (read: Read) => Promise<Marked[]> => {
  type Held = { stamp: Promise<string>; rows: Promise<Marked[]> }
  let held: Held | undefined
  return async (read: Read): Promise<Marked[]> => {
    let stamp = Promise.all(STAMP.map((q) => read(q))).then(JSON.stringify)
    let hold = () => {
      let now: Held = held = { stamp, rows: catalogued(read) }
      Promise.all([now.stamp, now.rows])
        .catch(() => held == now && (held = undefined))
      return now
    }
    let was = held ?? hold()
    return await (await was.stamp == await stamp ? was : hold()).rows
  }
}

/** What a person reads about an integration, which its owner may change:
 * never where its credential is sent. */
export type About = Pick<
  Integration,
  'title' | 'tagline' | 'site' | 'instructions' | 'example'
>
/** The properties of {@link About}, in the order a page shows them. */
export let ABOUT = [
  'title',
  'tagline',
  'site',
  'instructions',
  'example',
] as const

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

/** What a custom integration shown in the integration directory wears:
 * @yaks/platform's `published{at}`, as anything shared on a platform does. */
export let PUBLISHED = 'published'

/** The patch publishing a shared thing now, or taking it out. */
export let publishing = (on: boolean): { at: string } | null =>
  on ? { at: new Date().toISOString() } : null

/** An integration's owner changing what is said about it, or publishing it in
 * the integration directory (`listed`) or taking it out. A built one is the
 * host's, and one with no owner (made before owners were kept, or whose owner
 * is gone) is nobody's to change. */
export let set = async (
  read: Read,
  a: About & { owner: Eid; integration: string; listed?: boolean },
): Promise<Bundle[]> => {
  let name = a.integration
  let [held] = await read(
    line`.entity.eid=${integrationEid(name)}&.${INTEGRATION}&?${PUBLISHED}`,
  )
  let i = held?.[INTEGRATION] as Integration | undefined
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
  // Published again, it keeps the moment it was first published.
  let listing = a.listed == null || a.listed == !!held[PUBLISHED]
    ? {}
    : { [PUBLISHED]: publishing(a.listed) }
  return Object.keys(patch).length || Object.keys(listing).length
    ? [{
      entity: { eid: integrationEid(name) },
      ...Object.keys(patch).length ? { [INTEGRATION]: patch } : {},
      ...listing,
      $was: { [INTEGRATION]: { owner: token(i.owner) } },
    }]
    : []
}

/** An integration in the integration directory, and since when a custom one
 * is published there. */
export type Listed = Marked & { published?: string; unchecked?: boolean }

/**
 * The integration directory: host catalog services outside testing and custom
 * integrations their owner listed, by title. Words match every part of the
 * service and integration descriptions, including categories and docs.
 */
export let listing = async (read: Read, words = ''): Promise<Listed[]> => {
  let terms = words.toLowerCase().split(/\s+/).filter(Boolean)
  let rows = await read(
    line`.${INTEGRATION}&?${PUBLISHED}&?unchecked&?${FEATURED}`,
  )
  let built = rows.map(marked).filter((i) => i.built)
  let all = rows.flatMap(
    (b) => {
      let i = marked(b)
      let at = (b[PUBLISHED] as { at?: string } | undefined)?.at
      // A listing whose owner is gone is nobody's to keep, or take down; one
      // a built integration stands in for is that one.
      return (!i.testing && !i.owner &&
          (i.built ||
            Array.isArray(i.categories) && !standIn(built, i.name))) ||
          (b[PUBLISHED] && i.owner)
        ? [{
          ...i,
          ...at ? { published: at } : {},
          ...b.unchecked ? { unchecked: true } : {},
        }]
        : []
    },
  )
  let text = (i: Integration) =>
    [
      i.name,
      i.title,
      i.tagline,
      i.site,
      ...i.hosts,
      i.instructions,
      i.description,
      i.details,
      i.docs,
      i.connects,
      i.service?.app,
      ...i.categories ?? [],
    ]
      .join(' ').toLowerCase()
  return all.filter((i) => terms.every((t) => text(i).includes(t)))
    .sort((a, b) =>
      cmp((a.title || a.name).toLowerCase(), (b.title || b.name).toLowerCase())
    )
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

// Catalog descriptions are maintained in the graph, independently of the
// operational seed definitions shipped by this package.
let EDITORIAL = [
  'title',
  'tagline',
  'site',
  'description',
  'details',
  'docs',
  'categories',
  'image',
]

/**
 * The batch that installs built integrations in a graph: each one missing
 * there, or held otherwise than its seed says, with operational seed fields
 * current and graph-authored catalog descriptions preserved, and marked `built`. Nothing, where every one
 * already matches. A host applies it trusted, since `built` is server-owned,
 * once at start-up. `seeds` defaults to this package's own.
 */
export let install = (
  read: Read,
  seeds: Integration[] = SEEDS,
): Bundle[] | Promise<Bundle[]> =>
  after(
    seeds.length
      ? read(
        line`.entity.eid=${
          seeds.map((i) => integrationEid(i.name))
        }&.${INTEGRATION}`,
      )
      : [],
    (found: Bundle[]) => {
      let held = new Map(found.map((b) => [
        b.entity.eid,
        b[INTEGRATION] as Record<string, unknown>,
      ]))
      return seeds.flatMap((seed) => {
        let eid = integrationEid(seed.name)
        let was = held.get(eid) ?? {}
        let editorial = Object.fromEntries(
          EDITORIAL.filter((k) => was[k] != null).map((k) => [k, was[k]]),
        )
        let now: Record<string, unknown> = {
          ...seed,
          ...editorial,
          built: true,
        }
        let gone = Object.keys(was).filter((k) => now[k] == null)
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
