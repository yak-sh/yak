// A connection as a source of tools: `connection:<connection>` offers one
// command, `request`, which sends an HTTPS request through the connection
// (`call`), its credential added on the way. So it reaches only the hosts its
// integration names, and its answer is the service's, never the credential.
//
// Who may send through which connection is the host's to say (`owners`): the
// person's own, the space's for its owner, an app's grants. A connection that
// is an MCP server's credential, or an app service's, is a source of its own
// kind already. A shared chat bot is read through its platform within the
// servers it serves. A workspace's own OAuth grant can be called here.

import { line } from '@yaks/query'
import type { Bundle, Comp, Eid } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { call, type Ctx } from './connections.ts'
import { CONNECTION } from './identity.ts'
import { type Integration, known, type Read } from './integrations.ts'

/** One command a source offers, as a pool of tools lists it. */
export type SourceCommand = {
  /** its source's address: `connection:<connection>` */
  at: string
  name: string
  title: string
  description: string
  readOnly: boolean
  /** its arguments, as JSON Schema */
  input: Record<string, unknown>
}

/** A request's answer: the service's status, headers and body as text. */
export type Answer = {
  status: number
  headers: Record<string, string>
  body: string
}

let REQUEST = 'request'

let INPUT = {
  type: 'object',
  properties: {
    method: { type: 'string', description: 'The HTTP method; GET if omitted.' },
    url: {
      type: 'string',
      description: 'The https URL, on one of the hosts the connection names.',
    },
    headers: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Request headers. The credential is added on the way.',
    },
    body: {
      description:
        'The request body: text as it is, or JSON, sent with content-type application/json.',
    },
  },
  required: ['url'],
}

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let addressOf = (eid: Eid) => `connection:${eid}`

/** Whether a service can be called through a connection its owner holds. */
export let requestable = (i: Integration | undefined): i is Integration =>
  !!i && !i.name.startsWith('mcp:') && !i.service &&
  (!i.chat || !!i.chat_grant) &&
  i.hosts.length > 0

// A connected source held by one of `owners`, with its integration.
let offered = async (
  read: Read,
  b: Bundle,
  owners: Eid[],
): Promise<Integration | undefined> => {
  let c = comp(b, CONNECTION)
  if (
    c.status != 'connected' || !owners.includes(String(c.owner)) ||
    typeof c.integration != 'string' || c.integration.startsWith('mcp:')
  ) return undefined
  let i = await known(read, c.integration)
  return requestable(i) ? i : undefined
}

let described = (b: Bundle, i: Integration): SourceCommand => {
  let title = i.title || i.name
  let account = comp(b, CONNECTION).account
  return {
    at: addressOf(b.entity.eid),
    name: REQUEST,
    title: `${title}: request`,
    description: `Send an HTTPS request through the ${title} connection${
      account ? ` of ${account}` : ''
    }, its credential added on the way. It reaches ${
      i.hosts.join(', ')
    } and no other host.`,
    readOnly: false,
    input: INPUT,
  }
}

/** The `request` command of each connection `owners` hold, or of the ones
 * among `only`. */
export let requests = async (
  read: Read,
  owners: Eid[],
  only?: Eid[],
): Promise<SourceCommand[]> => {
  if (!owners.length || only?.length === 0) return []
  let held = await read(
    only
      ? line`.entity.eid=${only}&.${CONNECTION}&*`
      : line`.${CONNECTION}.owner=${owners}&.${CONNECTION}.status=${'connected'}&*`,
  )
  let found = await Promise.all(held.map((b) => offered(read, b, owners)))
  return held.flatMap((b, n) => found[n] ? [described(b, found[n]!)] : [])
}

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

// The request the arguments say, refused where they say none.
let methodOf = (i: Integration, url: string) => {
  if (!i.api?.reads?.length) return 'GET'
  let base = new URL(i.api.base)
  let at = URL.parse(url)
  let prefix = base.pathname.replace(/\/$/, '')
  if (at?.origin != base.origin || !at.pathname.startsWith(prefix + '/')) {
    return 'GET'
  }
  let path = at.pathname.slice(prefix.length)
  return i.api.reads.find((r) => r.endsWith(' ' + path))?.split(' ')[0] ?? 'GET'
}

let asked = (i: Integration, args: Record<string, unknown>): Request => {
  if (typeof args.url != 'string') {
    throw new CallError('arguments', 'request needs a url')
  }
  let method = typeof args.method == 'string'
    ? args.method.toUpperCase()
    : methodOf(i, args.url)
  if (args.headers != null && !object(args.headers)) {
    throw new CallError('arguments', 'headers is an object of strings')
  }
  let headers = new Headers(
    Object.entries(args.headers ?? {}).map(([k, v]) => [k, String(v)]),
  )
  let body = args.body == null
    ? undefined
    : typeof args.body == 'string'
    ? args.body
    : JSON.stringify(args.body)
  if (
    body != null && typeof args.body != 'string' && !headers.has('content-type')
  ) {
    headers.set('content-type', 'application/json')
  }
  try {
    return new Request(args.url, { method, headers, body })
  } catch (e) {
    throw new CallError('arguments', `request: ${(e as Error).message}`)
  }
}

/** Run a connection's command for a caller that may send through what
 * `owners` hold: the request, sent through `call`. */
export let request = async (
  c: Ctx,
  a: {
    at: string
    owners: Eid[]
    name: string
    args: Record<string, unknown>
  },
): Promise<{ text: string; value: Answer }> => {
  let eid = a.at.slice('connection:'.length)
  let [b] = eid
    ? await c.graph.read(line`.entity.eid=${eid}&.${CONNECTION}&*`)
    : []
  let i = b && await offered(c.graph.read, b, a.owners)
  if (!i) {
    throw new CallError('access', `${a.at} is not a connection you can use`)
  }
  if (a.name != REQUEST) {
    throw new CallError(
      'missing',
      `${i.title || i.name} has one command, request`,
    )
  }
  let res = await call(c, eid, asked(i, a.args))
  let headers = Object.fromEntries(
    [...res.headers].filter(([k]) => k != 'set-cookie'),
  )
  return {
    text: '',
    value: { status: res.status, headers, body: await res.text() },
  }
}
