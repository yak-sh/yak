/**
 * What a space's Connections page (./connections-view.ts) is drawn from, as
 * the tab's page graph holds it (D-475 step 5), and what it writes there.
 *
 * - `connectionsPage{space, ask, on, list, borrowed, services, mcp, built,
 *   catalog, asked, open, trash, enable}`: everything the page shows, for the
 *   space and what its address asks (`ask`: the search, the service opened,
 *   the MCP server opened, the trash). No store holds it: the page graph's
 *   door reads it of the directory, the vault and the catalog
 *   (yaks.app's connections.ts `connectionsOf`), and reads it again as the
 *   space's connections, their links and the person's MCP servers move.
 * - `connectionAct{space, page, form}`: one of the page's buttons pressed,
 *   the fields its form sent (`do` among them) as `page` showed it. The door
 *   does it as the person and answers it with `connectionActed{say, no, go}`:
 *   what the page says of it, or where the person goes to sign in.
 * - `connectionsMoved{space}`: the space's connections, the links its apps
 *   call out through, its apps or its owner's MCP servers moved. The
 *   directory answers it as a read of the person (./person-lines.ts), again
 *   on each commit that touches them: how the door knows to read the page
 *   again.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { line } from '@yaks/query'
import type { VocabDoc } from '@yaks/vocab'

/** One thing a person gives to connect a pasted-key service, and the one a
 * service that declares none asks for: its key (@yaks/connections `Field`). */
import { type Field as KeyField, KEY } from '@yaks/connections/form'

export { KEY, type KeyField }

/** How a connection stands. */
export type Status = 'needed' | 'connected' | 'broken'

/** A service as a page draws it: what a person calls it, a line about it,
 * its site, its logo and how to get its key, each empty where its integration
 * says none. */
export type Face = {
  title: string
  tagline: string
  description?: string
  details?: string
  docs?: string
  connects?: 'key' | 'signin' | 'client'
  broker?: string
  site: string
  /** its integration's name, which a logo kept elsewhere is served by */
  name: string
  /** an SVG document, drawn as an image */
  logo: string
  /** its logo's address, for a service with no SVG kept here, served from
   * our own door (./routes.ts `integrationLogo`) */
  image: string
  /** how a person gets its key, drawn from its markdown as HTML, its links
   * marked as the writer's */
  instructions: string
  /** what it says was written by the space that made it, not by yaks.app */
  theirs: boolean
  /** what a person gives to connect it with a pasted key: its one key, or
   * the fields it names */
  fields: KeyField[]
}

/** What a person reads about a service a space made, which its owner may
 * change (@yaks/connections `About`). */
export type About = {
  title?: string
  tagline?: string
  site?: string
  instructions?: string
  example?: string
}

/** One app calling out through a connection, as the page shows it. */
export type Using = {
  /** the app's eid */
  app: string
  title: string
  /** its address, the name every tool takes, for an app of this space; empty
   * for one elsewhere */
  slug: string
  /** what its code reads it as, env.NAME */
  binding: string
  /** handed the key itself rather than a sentinel */
  direct: boolean
  /** anyone using the app may call out through it, not only its members */
  anyone: boolean
  /** the space's side of an ask each person answers with their own */
  each: boolean
  /** the calls it made through it this month (@yaks/egress `calls`) */
  calls: number
  /** the most calls a month it may make, or null for no limit */
  cap: number | null
  /** the cap each copy installed from it borrows the connection under, or
   * null where it lends it to none (@yaks/connections `lend`) */
  lends: number | null
  /** for a copy borrowing it from another space's app: the space the copy is
   * in, as its people call it; null for an app of the connection's own */
  borrower: string | null
}

/** One connection, as the page shows it. */
export type Shown = {
  eid: string
  integration: string
  face: Face
  /** the signed-in person's own, rather than the space's: shown only on
   * their own space's page */
  own: boolean
  /** each person who uses its apps connects their own; the space's is only
   * the ask */
  each: boolean
  status: Status
  account: string
  /** what people call the account, where `account` is an id */
  title: string
  /** connected by pasting a key, rather than by signing in */
  keyed: boolean
  /** the hosts its key may be sent to */
  hosts: string[]
  /** its integration was made by the space or person it is kept for, who may
   * change what is said about it: these, as written */
  about: About | null
  /** its integration is in the integration directory: listed by its owner,
   * or built */
  listed: boolean
  scopes: string[]
  /** the scopes its integration now asks for that it lacks: signing in again
   * would give it them */
  lacking: string[]
  /** the apps that call out through it */
  apps: Using[]
  /** the name an app attached to it reads it by, unless the owner names one */
  binding: string
  /** live apps in this space that the owner may attach */
  available: { app: string; title: string }[]
  /** why it is not finished yet: the note on its `provisional` mark */
  saving: string
  /** how to get its key, as its integration says */
  instructions: string
  /** why its key could not be saved: the text beside its `exception` */
  failed: string
}

/** A connection an app here borrows from the space that lends it, as the
 * page shows it: whose it is, and what the app has spent of its cap. */
export type Borrowed = {
  /** the connection lent */
  eid: string
  integration: string
  face: Face
  /** connected by pasting a key, rather than by signing in */
  keyed: boolean
  /** where its key may be sent, and so a key of the borrower's own */
  hosts: string[]
  /** the space lending it, as its people call it */
  lender: string
  /** the app borrowing it */
  app: Using
}

/** A service the page offers to connect, as a card draws it. */
export type Offered = {
  name: string
  keyed: boolean
  face: Face
  available?: boolean
}

/** The catalog, as the page shows it. */
export type Catalog = {
  /** what the page was asked to find (`?q=`) */
  q: string
  featured: Offered[]
  /** what the search found, best first, at most `SHOWN` */
  found: Offered[]
  /** how many it found in all */
  matched: number
  /** how many services the catalog holds */
  total: number
  /** the kinds of service it holds, the most common first, each by its
   * name and as a person reads it */
  kinds: { name: string; label: string }[]
}

/** The most a search shows at once. */
export let SHOWN = 48

/** An outside service holding a grant from the person: an agent signed in
 * with their yaks.app account. */
export type Service = { name: string; connectedAt: number }

/** An app, as the page names it beside a source granted to it. */
export type Grantee = {
  eid: string
  title: string
  space: string
  slug: string
}

/** One MCP server the person keeps, as the page shows it
 * (@yaks/connections/mcp `Shown`), with the apps it is granted to. */
export type McpServer = {
  id: string
  name: string
  url: string
  machine?: string
  enabled: boolean
  allow?: string[]
  header?: string
  trashed: boolean
  /** whether it serves everyone the space's Operator works with */
  everyone: boolean
  status: 'open' | 'machine' | 'needed' | 'connected' | 'broken'
  connection?: string
  /** whether its credential is a key the person gives, rather than a
   * sign-in; absent where it asked for neither */
  keyed?: boolean
  apps: Grantee[]
}

/** What the page shows of a person's MCP servers: each with the apps it is
 * granted to; with the one opened, every tool it offers, for choosing which
 * are offered; and an app asking for the sources `at` names, each with
 * whether it holds it. */
export type McpPage = {
  servers: McpServer[]
  /** Apps allowed to read this person's friends and send play invitations. */
  friends?: Grantee[]
  /** where a sign-in returns, the redirect URI a server's own OAuth client
   * names */
  redirect?: string
  tools?: {
    server: string
    list?: {
      name: string
      title: string
      description: string
      allowed: boolean
    }[]
    failed?: string
  }
  ask?: {
    app: Grantee
    at: string
    sources: { at: string; title: string; about: string; granted: boolean }[]
  }
}

/** What the Connections page is drawn from. */
export type Connections = {
  trash?: { id: string; integration: string; at: number }[]
  /** whether this deploy can keep a key at all */
  on: boolean
  /** the person's MCP servers in this space */
  mcp?: McpPage
  list: Shown[]
  /** outside services holding a grant from the person, on their own space's
   * page */
  services: Service[]
  /** the built integrations nothing here is connected to yet, and this deploy
   * can connect */
  built: Offered[]
  /** the testing integrations the page was opened for (`?enable=`), which
   * its forms carry */
  enable?: string[]
  /** the integration whose hash was opened (`?detail=<name>`), while this
   * space has none through it */
  asked?: Offered
  /** the catalog: what is featured, and what the page's search found, of
   * everything nothing here is connected to yet and this deploy can
   * connect */
  catalog?: Catalog
  /** the connection whose hash was opened (`?detail=<eid>`), shown whole
   * where the rest are cards */
  open?: string
  /** what the apps of this space borrow from another space's lend */
  borrowed: Borrowed[]
}

/** The page's address asks the read: the search (`q`), the service or
 * connection opened (`detail`), the MCP server opened and an app asking for
 * sources (`mcp`, `grant`, `at`), the trash (`trash`) and the testing
 * integrations (`enable`). */
export let ASKS = ['q', 'detail', 'mcp', 'grant', 'at', 'trash', 'enable']

/** What `params` ask of the page, as one text the same asks always give. */
export let askOf = (params: URLSearchParams): string => {
  let kept = new URLSearchParams()
  for (let k of ASKS) {
    let v = params.getAll(k).join(',').trim()
    if (v) kept.set(k, v)
  }
  return kept.toString()
}

let PAGE = '.connectionsPage.space='

/** The line of the Connections page of the space `space`, as `ask` asks
 * it. */
export let connectionsPage = (space: string, ask: string): string =>
  line`.connectionsPage.space=${space}&.connectionsPage.ask=${ask}`

/** The space and the asks a `connectionsPage` line names, or undefined for
 * another line. */
export let pageAsked = (
  text: string,
): { space: string; ask: string } | undefined => {
  if (!text.startsWith(PAGE)) return undefined
  let m =
    /^\.connectionsPage\.space=("(?:[^"\\]|\\.)*"|[^&]*)&\.connectionsPage\.ask=("(?:[^"\\]|\\.)*"|.*)$/
      .exec(text)
  let bare = (v: string) =>
    v.startsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v
  if (!m) return undefined
  let asked = { space: bare(m[1]), ask: bare(m[2]) }
  return connectionsPage(asked.space, asked.ask) == text ? asked : undefined
}

let MOVED = '.connectionsMoved.space='

/** The line that moves as the Connections page of the space `space` does. */
export let connectionsMoved = (space: string): string => MOVED + space

/** The space a `connectionsMoved` line names, or undefined for another line. */
export let movedSpace = (text: string): string | undefined =>
  text.startsWith(MOVED) ? text.slice(MOVED.length) : undefined

/** That the Connections page of `space` moved, as `person`'s row. */
export let movedRow = (person: string, space: string): Bundle => ({
  entity: { eid: derivedEid(`connections-moved|${person}|${space}`) },
  connectionsMoved: { space },
})

let strings = { type: 'string' }
let lists = { type: 'array' }
let objects = { type: 'object' }

export let connectionsWords: VocabDoc = {
  $defs: {
    connectionsPage: {
      component: true,
      type: 'object',
      properties: {
        space: strings,
        ask: strings,
        on: { type: 'boolean' },
        list: lists,
        borrowed: lists,
        services: lists,
        built: lists,
        mcp: objects,
        catalog: objects,
        asked: objects,
        open: strings,
        trash: lists,
        enable: lists,
      },
      required: ['space', 'ask'],
    },
    connectionAct: {
      component: true,
      type: 'object',
      properties: { space: strings, page: strings, form: objects },
      required: ['space', 'form'],
    },
    connectionsMoved: {
      component: true,
      type: 'object',
      properties: { space: strings },
      required: ['space'],
    },
    connectionActed: {
      component: true,
      type: 'object',
      properties: {
        say: strings,
        no: { type: 'boolean' },
        go: strings,
      },
    },
  },
}

/** The Connections page of `space` as `ask` asks it, as a row. */
export let pageRow = (space: string, ask: string, c: Connections): Bundle => ({
  entity: { eid: derivedEid(`connectionsPage|${space}|${ask}`) },
  connectionsPage: { ...c, space, ask },
})

/** What the page is drawn from, if `rows` hold it. */
export let pageOf = (rows: Bundle[]): Connections | undefined => {
  let row = rows.find((r) => r.connectionsPage)?.connectionsPage as
    | (Connections & { space: string; ask: string })
    | undefined
  if (!row) return undefined
  let { space: _, ask: __, ...c } = row
  return c
}

/** What a form sent, each field by its name: a field sent more than once
 * (a server's tools) as every value. */
export type Sent = Record<string, string | string[]>

/** What a form holding `body` sent. */
export let sentOf = (body: FormData): Sent => {
  let sent: Sent = {}
  for (let k of new Set(body.keys())) {
    let all = body.getAll(k).map(String)
    sent[k] = all.length == 1 ? all[0] : all
  }
  return sent
}

/** What a `connectionAct` sent, as a form the page's post would carry. */
export let formOf = (sent: Sent): FormData => {
  let form = new FormData()
  for (let [k, v] of Object.entries(sent)) {
    for (let one of Array.isArray(v) ? v : [v]) form.append(k, one)
  }
  return form
}

/** A button pressed on the Connections page of `space`, as `page` (its
 * address) showed it. */
export type Act = { space: string; page: string; form: Sent }

/** The act `bundles` write, when they are one press of the page's, else
 * undefined. */
export let actOf = (bundles: Bundle[]): (Act & { eid: string }) | undefined => {
  let [b, ...rest] = bundles
  let act = b?.connectionAct as Act | undefined
  if (rest.length || !act?.space || !act.form) return undefined
  return { ...act, eid: b.entity.eid }
}

/** What came of a press: what the page says, refused where `no`, or where
 * the person goes to sign in. */
export type Acted = { say?: string; no?: boolean; go?: string }

/** The act `eid`, answered with what came of it. */
export let actedRow = (eid: string, acted: Acted): Bundle => ({
  entity: { eid },
  connectionActed: acted,
})

/** What came of the act `rows` answer, if they do. */
export let actedOf = (rows: Bundle[]): Acted | undefined =>
  rows.find((r) => r.connectionActed)?.connectionActed as Acted | undefined
