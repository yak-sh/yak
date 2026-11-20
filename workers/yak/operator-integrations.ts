// The services connected for the person an Operator works for, and the one
// call that reaches any endpoint of their APIs as that connection (T-2097).
// The tools made for a service (operator-google.ts, @yaks/canva) cover what
// is asked most; `api_call` covers the rest, so an Operator is never blind to
// what a connection can reach.
//
// Each integration names its API as data (`integration.api{base, docs,
// reads}`); one that names none is reached at its first host. A call goes
// through @yaks/connections `request`, the path every connection's requests
// take, so the credential is added at the boundary and only the integration's
// hosts are reached. A read (`reads`: a GET, or a call its integration says
// only reads, as Calendar's POST /freeBusy) runs as asked; any other waits for
// the person's tap (operator-approvals.ts `ESCALATING`), since what a write
// does can't be told from its path.
//
// Every connected service is said to the Operator in one line on each ask
// (`integrationsTold`), so it reaches for one without being told to.
import type { Bundle, Comp } from '@yaks/graph'
import { line } from '@yaks/query'
import { CONNECTION, type Integration, known, request } from '@yaks/connections'
import type { Tool } from '@yaks/session'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { type Ctx, refuse } from './tool.ts'
import { ctxOf } from './connections.ts'
import { recall } from './lib/hops.ts'

/** A connected service the Operator may call, and its integration. */
export type Held = { held: Bundle; i: Integration }

/** The methods that only read, whatever the path. */
export let READING = new Set(['GET', 'HEAD'])

/** The most of an answer's body the Operator reads, in characters. */
export let LIMIT = 30_000

let comp = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp
let str = (v: unknown) => typeof v == 'string' ? v.trim() : ''

// An integration whose connection is called here: not an MCP server's or an
// app service's, which are sources of their own, nor a chat platform's, read
// within the rooms its bot serves (chat.ts), and naming hosts to call.
let callable = (i: Integration | undefined): i is Integration =>
  !!i && !i.name.startsWith('mcp:') && !i.service && !i.chat &&
  i.hosts.length > 0

/** The address an integration's API paths are under.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(baseOf({ name: 'x', hosts: ['api.x.com'] }), 'https://api.x.com')
 * ```
 */
export let baseOf = (i: Integration): string =>
  i.api?.base ?? `https://${i.hosts[0]}`

/** The URL a call asks for: `path` under the integration's API, or a whole
 * https URL as given, with `query` added, each array value once per item.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let i = { name: 'c', hosts: ['www.googleapis.com'], api: { base: 'https://www.googleapis.com/calendar/v3' } }
 * assertEquals(urlOf(i, '/freeBusy'), 'https://www.googleapis.com/calendar/v3/freeBusy')
 * assertEquals(urlOf(i, 'calendars/primary/events', { q: 'dentist', id: ['a', 'b'] }), 'https://www.googleapis.com/calendar/v3/calendars/primary/events?q=dentist&id=a&id=b')
 * assertEquals(urlOf(i, 'https://www.googleapis.com/drive/v3/files'), 'https://www.googleapis.com/drive/v3/files')
 * ```
 */
export let urlOf = (
  i: Integration,
  path: string,
  query: Record<string, unknown> = {},
): string => {
  let whole = /^https:\/\//.test(path)
  let url = new URL(
    whole ? path : `${baseOf(i).replace(/\/$/, '')}/${path.replace(/^\//, '')}`,
  )
  for (let [k, v] of Object.entries(query)) {
    for (let one of Array.isArray(v) ? v : [v]) {
      if (one != null) url.searchParams.append(k, String(one))
    }
  }
  return url.href
}

// A pattern of `api.reads` as the paths it matches: `*` is one segment.
let pattern = (path: string) =>
  new RegExp(
    `^${
      path.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]+')
    }$`,
  )

/** Whether a call only reads: a GET or a HEAD, or one its integration says
 * reads though its method is another (`api.reads`), which runs without a
 * tap as they do.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let i = { name: 'c', hosts: ['www.googleapis.com'], api: { base: 'https://www.googleapis.com/calendar/v3', reads: ['POST /freeBusy', 'POST /calendars/x/acl/watch'] } }
 * assertEquals(reads(i, 'get', '/calendars/primary/events'), true)
 * assertEquals(reads(i, 'POST', '/freeBusy'), true)
 * assertEquals(reads(i, 'POST', 'https://www.googleapis.com/calendar/v3/freeBusy'), true)
 * assertEquals(reads(i, 'POST', '/calendars/primary/events'), false)
 * assertEquals(reads(i, 'POST', 'https://www.googleapis.com/drive/v3/freeBusy'), false)
 * ```
 */
export let reads = (i: Integration, method: string, path: string): boolean => {
  let m = method.toUpperCase()
  if (READING.has(m)) return true
  let base = new URL(baseOf(i))
  let under = base.pathname.replace(/\/$/, '')
  let url: URL
  try {
    url = new URL(urlOf(i, path))
  } catch {
    return false
  }
  if (url.origin != base.origin || !url.pathname.startsWith(`${under}/`)) {
    return false
  }
  let rest = url.pathname.slice(under.length)
  return (i.api?.reads ?? []).some((r) => {
    let [rm, rp = ''] = r.split(' ')
    return rm.toUpperCase() == m && pattern(rp).test(rest)
  })
}

/** An integration by name, as the platform's graph holds it: what an
 * escalation reads a call's `reads` from (operator-approvals.ts `Turn`). */
export let integrationOf = (env: Env) => (name: string) =>
  known(ctxOf(env).graph.read, name)

/** Every service connected for `ctx.person` in `space` that the Operator may
 * call: their own, and the space's where they own it, one per integration,
 * theirs first. */
export let connectedFor = (
  env: Env,
  ctx: Pick<Ctx, 'person' | 'dir'>,
  space: Pick<Space, 'eid'>,
): Promise<Held[]> =>
  recall(
    PLATFORM_STORE,
    `operator integrations ${ctx.person} ${space.eid}`,
    async () => {
      let { read } = ctxOf(env).graph
      let [role, rows] = await Promise.all([
        ctx.dir.role(space, ctx.person),
        read(
          line`.${CONNECTION}.owner=${[
            ctx.person,
            space.eid,
          ]}&.${CONNECTION}.status=${'connected'}&*`,
        ),
      ])
      let owners = role == 'owner' ? [ctx.person, space.eid] : [ctx.person]
      let first = new Map<string, Bundle>()
      for (let owner of owners) {
        for (let b of rows) {
          let c = comp(b, CONNECTION)
          let name = String(c.integration)
          if (c.owner == owner && !first.has(name)) first.set(name, b)
        }
      }
      let held = [...first.values()]
      let found = await Promise.all(
        held.map((b) => known(read, String(comp(b, CONNECTION).integration))),
      )
      return held.flatMap((b, n) => {
        let i = found[n]
        return callable(i) ? [{ held: b, i }] : []
      })
    },
  )

// One service as the Operator is told it: what it is, whose account, and
// where its API and its reference are.
let told = ({ held, i }: Held) => {
  let account = str(comp(held, CONNECTION).account)
  return `- ${i.title || i.name} (${i.name})${
    account ? `, as ${account}` : ''
  }: ${baseOf(i)}${i.api?.docs ? `, reference ${i.api.docs}` : ''}`
}

/** What the Operator is told of the services connected for the person: one
 * line each, and that `api_call` reaches all of their APIs. */
export let integrationsTold = async (
  env: Env,
  ctx: Pick<Ctx, 'person' | 'dir'>,
  space: Pick<Space, 'eid'>,
): Promise<string> => {
  let all = await connectedFor(env, ctx, space)
  return all.length
    ? `Services connected for the person you work for, which you use for them as their assistant. Beside the tools made for each, api_call reaches any endpoint of its API as that connection (load it with tool_load), so whatever its API offers you can read or do:\n${
      all.map(told).join('\n')
    }`
    : ''
}

// The answer as the Operator reads it: the status, and the body up to LIMIT.
let answer = (status: number, body: string) =>
  `${status}\n${
    body.length > LIMIT
      ? `${
        body.slice(0, LIMIT)
      }\n… cut at ${LIMIT} of ${body.length} characters; ask for less (fields, a smaller page)`
      : body
  }`

/** The Operator's call of any endpoint of a connected service's API, as the
 * person's connection. */
export let apiCall = (
  env: Env,
  ctx: Pick<Ctx, 'person' | 'dir'>,
  space: Pick<Space, 'eid'>,
): Tool => ({
  name: 'api_call',
  title: "Call a connected service's API",
  step: {
    doing: 'Asking %{integration}…',
    done: 'Asked %{integration}',
  },
  description:
    "Call any endpoint of the API of a service connected for the person you work for, as their connection, for what no other tool does: your instructions list each service with its API address and reference. The credential is added for you. GET reads and runs at once; any other method changes something and waits for the person's tap. Answers the HTTP status, then the body.",
  parameters: {
    type: 'object',
    properties: {
      integration: {
        type: 'string',
        description: 'The service, by the name in brackets in your list.',
      },
      method: {
        type: 'string',
        description: 'The HTTP method; GET if omitted.',
      },
      path: {
        type: 'string',
        description:
          "The path under the service's API address, such as /freeBusy, or a whole https URL on its host.",
      },
      query: {
        type: 'object',
        additionalProperties: true,
        description: 'Query parameters; an array value is sent once per item.',
      },
      headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Request headers, beside the credential.',
      },
      body: {
        description:
          'The request body: JSON, sent as application/json, or text as it is.',
      },
    },
    required: ['integration', 'path'],
  },
  run: async (args) => {
    let name = str(args.integration)
    let all = await connectedFor(env, ctx, space)
    let one = all.find(({ i }) => i.name == name)
    if (!one) {
      throw refuse(
        'missing',
        `${name || 'That service'} is not connected for them. ${
          all.length
            ? `Connected: ${all.map(({ i }) => i.name).join(', ')}.`
            : 'Nothing is connected for them yet.'
        }`,
      )
    }
    let query = args.query && typeof args.query == 'object'
      ? args.query as Record<string, unknown>
      : {}
    let url: string
    try {
      url = urlOf(one.i, str(args.path), query)
    } catch {
      throw refuse('arguments', `${args.path} is not a path or an https URL.`)
    }
    let { value } = await request(ctxOf(env), {
      at: `connection:${one.held.entity.eid}`,
      owners: [String(comp(one.held, CONNECTION).owner)],
      name: 'request',
      args: {
        url,
        method: str(args.method) || 'GET',
        ...args.headers == null ? {} : { headers: args.headers },
        ...args.body == null ? {} : { body: args.body },
      },
    })
    return answer(value.status, value.body)
  },
})
