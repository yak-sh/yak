// The agent and terminal doors at their in-memory seams: one host's helpers
// and the serving process's HTTP replies, never a second composed graph.

import type { Anatomy, AnatomyTool } from '@yaks/code/anatomy'
import type { Host as CliHost } from '@yaks/cli/host'
import type { Bundle, Graph } from '@yaks/graph'
import { equal, ok, test } from '@yaks/testing'
import { channel, peek } from '@yaks/trace'
import { observe } from './activity.ts'
import { type Capture, capture } from './capture.ts'
import { commands } from './cli.ts'
import { select, type Snapshot, snapshot } from './snapshot.ts'
import { runs } from './tools.ts'
import doc from './vocab.json' with { type: 'json' }

let tool = (id: string, name: string, pkg: string): AnatomyTool => ({
  id,
  name,
  package: pkg,
  facet: 'tools',
  declared: true,
  loaded: true,
  bound: false,
  inputSchema: { type: 'object' },
})
let parts = (): Anatomy => ({
  version: 1,
  host: 'native',
  packages: [{
    id: 'package:alpha',
    name: '@yaks/alpha',
    configured: true,
    declared: true,
    loaded: true,
    bound: true,
  }],
  tools: [
    tool('tool:alpha', 'alpha_read', '@yaks/alpha'),
    tool('tool:beta', 'beta_read', '@yaks/beta'),
  ],
  roles: [],
  facets: [],
  comps: [],
  commands: [],
  effects: [],
  rules: [],
  hooks: [],
  routes: [],
  views: [],
  inspectViews: [],
  tui: [],
  kits: [],
  themes: [],
  skills: [],
  secrets: [],
  edges: [{
    id: 'edge:alpha',
    from: 'package:alpha',
    to: 'tool:alpha',
    kind: 'declares',
  }, {
    id: 'edge:beta',
    from: 'package:alpha',
    to: 'tool:beta',
    kind: 'declares',
  }],
})
let asked = (args: Record<string, unknown> = {}): Bundle => ({
  entity: { eid: 'call:visualize' },
  call: { args },
})
// A runner's graph argument is not a way to observe some other host.
let other = {} as Graph
let decoded = <T>(rows: Bundle[]): T => {
  equal(rows.length, 1)
  let content = rows[0].content
  if (
    !content || typeof content != 'object' || !('body' in content) ||
    typeof content.body != 'string'
  ) throw new Error('expected a JSON reply')
  return JSON.parse(content.body)
}

test('anatomy tool uses shared selection, node counts and included-only edges', async () => {
  let original = parts()
  let before = structuredClone(original)
  let host = { graph: {}, anatomy: () => original }
  for (
    let args of [
      {},
      { group: 'tools' },
      { search: ' ALPHA ' },
      { search: 'alpha', limit: 1 },
      { id: 'tool:beta' },
      { group: 'missing' },
    ]
  ) {
    let rows = await runs(host).visualize_anatomy(asked(args), other)
    equal(rows[0].entity.eid, '$anatomy')
    let value = decoded<Snapshot>(rows)
    let expected = select(snapshot(host), args)
    expected.takenAt = value.takenAt
    equal(value, expected)
    equal(value.selection!.total, 3)
    equal(original, before)
    for (let edge of value.anatomy.edges) {
      let ids = [
        ...value.anatomy.packages,
        ...value.anatomy.tools,
      ].map((part) => part.id)
      ok(ids.includes(edge.from) && ids.includes(edge.to))
    }
  }
  let truncated = decoded<Snapshot>(
    await runs(host).visualize_anatomy(
      asked({ search: 'alpha', limit: 1 }),
      other,
    ),
  )
  equal(truncated.selection, {
    total: 3,
    matched: 2,
    shown: 1,
    truncated: true,
  })
  equal(truncated.anatomy.edges, [])
})

test('anatomy tool exposes missing composition as unobserved, not absent', async () => {
  let value = decoded<Snapshot>(
    await runs({ graph: {} }).visualize_anatomy(
      asked(),
      other,
    ),
  )
  equal(value.anatomy.host, 'unobserved')
  equal(value.selection, { total: 0, matched: 0, shown: 0, truncated: false })
  equal(Object.keys(value.coverage.observed).length, 17)
  ok(Object.values(value.coverage.observed).every((seen) => !seen))
  equal(value.coverage.activity, 'process-local')
  equal(value.coverage.recording, 'subscriber-only')
})

test('activity tool returns the shared bounded capture of its actual host', async () => {
  let graph = {}
  let observation = observe(graph)
  let unrelated = observe(other)
  try {
    for (let name of ['graph.query', 'graph.get', 'graph.fanout']) {
      channel(graph).instant({ kind: 'query', name })
    }
    channel(other).instant({ kind: 'get', name: 'graph.other' })
    let expected = await capture(graph, { limit: 2, wait: 0 })
    let rows = await runs({ graph }).visualize_activity(
      asked({ limit: 2, wait: 0 }),
      other,
    )
    equal(rows[0].entity.eid, '$activity')
    let value = decoded<Capture>(rows)
    equal(value, JSON.parse(JSON.stringify(expected)))
    equal(value.epoch, observation.epoch)
    equal(value.events.map((event) => event.name), [
      'graph.get',
      'graph.fanout',
    ])
    equal(value.events.map((event) => event.seq), [2, 3])
    equal(value.gap, 1)
    equal(value.coverage, 'process-local')
  } finally {
    unrelated.close()
    observation.close()
  }
  equal(peek(graph), undefined)
  equal(peek(other), undefined)
})

test('agent door declarations publish bounded filters and capture inputs', () => {
  let anatomy = doc.$defs.visualize_anatomy.input
  equal(anatomy.limit.minimum, 1)
  equal(anatomy.limit.maximum, 5000)
  equal(anatomy.limit.default, 1000)
  equal(anatomy.group.enum.length, 17)
  ok(!anatomy.group.enum.includes('edges'))
  ok(!anatomy.group.enum.includes('phases'))
  let activity = doc.$defs.visualize_activity.input
  equal(activity.limit.minimum, 1)
  equal(activity.limit.maximum, 256)
  equal(activity.wait.minimum, 0)
  equal(activity.wait.maximum, 2000)
  equal(activity.wait.default, 0)
})

let empty = (): Capture => ({
  epoch: 'capture:local',
  events: [],
  gap: 0,
  coverage: 'process-local',
})
// The only replaced interfaces are network delivery and the token-store read.
// No test reads the user's credentials, starts a server or composes a host.
let terminal = async (
  args: Record<string, unknown>,
  value: unknown,
  opts: {
    json?: boolean
    host?: string
    via?: string
    config?: CliHost['config']
    tokens?: Record<string, string>
    token?: string
    status?: number
  } = {},
) => {
  let sent: Request[] = []
  let keys: string[] = []
  let out: string[] = []
  let notes: string[] = []
  let fetcher = globalThis.fetch
  let reader = Deno.readTextFileSync
  let token = Deno.env.get('YAKS_TOKEN')
  let state = '/virtual/visualize-doors'
  if (opts.token) Deno.env.set('YAKS_TOKEN', opts.token)
  else Deno.env.delete('YAKS_TOKEN')
  Deno.readTextFileSync = (path) => {
    if (path == `${state}/token.json`) {
      keys.push(String(path))
      return JSON.stringify(opts.tokens ?? {})
    }
    return reader(path)
  }
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    sent.push(new Request(input, init))
    return Promise.resolve(Response.json(value, { status: opts.status ?? 200 }))
  }) as typeof fetch
  let context = {
    host: opts.host ?? 'localhost:8787',
    json: opts.json ?? false,
    state,
    via: opts.via,
    out: (s: string) => out.push(s),
    note: (s: string) => notes.push(s),
  }
  let host = {
    config: opts.config ?? {},
    get graph() {
      throw new Error('the CLI must not read a newly composed graph')
    },
  }
  try {
    let code = await commands[0].run(args, host, context)
    return { code, sent, keys, out, notes }
  } finally {
    globalThis.fetch = fetcher
    Deno.readTextFileSync = reader
    if (token == null) Deno.env.delete('YAKS_TOKEN')
    else Deno.env.set('YAKS_TOKEN', token)
  }
}

test('CLI reads served anatomy filters and prints the exact JSON DTO', async () => {
  let value = select(snapshot({ anatomy: parts }), {
    search: 'alpha',
    limit: 1,
  })
  let told = await terminal({
    url: 'https://platform.test',
    group: 'tools',
    search: 'name &=#',
    id: 'tool:alpha',
    limit: 1,
    json: true,
  }, value)
  equal(told.code, 0)
  equal(told.out, [JSON.stringify(value)])
  equal(told.notes, [])
  equal(told.sent.length, 1)
  let request = told.sent[0]
  let url = new URL(request.url)
  equal(url.origin, 'https://platform.test')
  equal(url.pathname, '/visualize/anatomy')
  equal(Object.fromEntries(url.searchParams), {
    group: 'tools',
    search: 'name &=#',
    id: 'tool:alpha',
    limit: '1',
  })
  equal(request.method, 'GET')
  equal(request.redirect, 'error')
  equal(request.headers.get('accept'), 'application/json')
})

test('CLI uses native serving config and context JSON for activity', async () => {
  let value = { ...empty(), gap: 7 }
  let told = await terminal({ what: 'activity', limit: 2, wait: 0 }, value, {
    config: { hostname: '0.0.0.0', port: 9191 },
    json: true,
  })
  equal(told.code, 0)
  equal(told.out, [JSON.stringify(value)])
  equal(
    told.sent[0].url,
    'http://127.0.0.1:9191/visualize/activity?limit=2&wait=0',
  )
  let fallback = await terminal({}, snapshot({}), { json: true })
  equal(fallback.sent[0].url, 'http://127.0.0.1:8787/visualize/anatomy')
})

test('CLI selects credentials only for the requested origin and carries provenance', async () => {
  let tokens = {
    'https://selected.test': 'matching-key',
    'selected.test': 'selected-host-key',
    'default.test': 'unrelated-key',
  }
  let matching = await terminal(
    { url: 'https://selected.test', json: true },
    {},
    {
      host: 'https://selected.test',
      tokens,
      via: 'session:local',
    },
  )
  equal(matching.sent[0].headers.get('authorization'), 'Bearer matching-key')
  equal(matching.sent[0].headers.get('x-via'), 'session:local')
  equal(matching.sent[0].redirect, 'error')
  let selected = await terminal(
    { url: 'https://selected.test', json: true },
    {},
    {
      host: 'default.test',
      tokens,
    },
  )
  equal(
    selected.sent[0].headers.get('authorization'),
    'Bearer selected-host-key',
  )
  let absent = await terminal({ url: 'https://unknown.test', json: true }, {}, {
    host: 'default.test',
    tokens,
  })
  equal(absent.sent[0].headers.get('authorization'), null)
  let explicit = await terminal(
    { url: 'https://selected.test', json: true },
    {},
    {
      token: 'explicit-env-token',
      tokens,
    },
  )
  equal(
    explicit.sent[0].headers.get('authorization'),
    'Bearer explicit-env-token',
  )
  equal(explicit.keys, [])
})

test('CLI reports HTTP refusals without printing a DTO or response values', async () => {
  for (let status of [400, 401, 403]) {
    let told = await terminal({ json: true }, { secret: 'not a diagnostic' }, {
      status,
    })
    equal(told.code, 1)
    equal(told.out, [])
    equal(told.notes.length, 1)
    ok(told.notes[0].startsWith(`visualize: HTTP ${status}`))
    ok(!told.notes[0].includes('not a diagnostic'))
  }
})

test('CLI refuses unsafe destinations and incompatible modes before fetching', async () => {
  for (
    let args of [
      { url: 'file:///tmp/visualize' },
      { url: 'https://user:password@platform.test' },
      { what: 'events' },
      { what: 'activity', group: 'tools' },
      { what: 'anatomy', wait: 1 },
    ]
  ) {
    let told = await terminal(args, empty())
    equal(told.code, 1)
    equal(told.sent, [])
    equal(told.out, [])
    equal(told.notes.length, 1)
  }
})

test('CLI overview distinguishes state, unobserved categories and zero duration', async () => {
  let overview = await terminal({}, select(snapshot({ anatomy: parts })))
  equal(overview.code, 0)
  ok(overview.out[0].includes('tools: 2; declared 2, loaded 2, bound 0'))
  let unknown = overview.out[0].split('unobserved: ')[1].split(', ')
  ok(unknown.includes('views'))
  ok(overview.out[0].includes('recording subscriber-only'))
  let value: Capture = {
    ...empty(),
    gap: 3,
    events: [{
      epoch: 'capture:local',
      seq: 1,
      id: 'span:1',
      parent: 'span:0',
      kind: 'query',
      name: 'graph.query',
      stage: 'end',
      time: 0,
      start: 0,
      duration: 0,
      outcome: 'ok',
      counts: { rows: 0 },
    }],
  }
  let activity = await terminal({ what: 'activity' }, value)
  equal(activity.code, 0)
  ok(activity.out[0].includes('omitted records 3'))
  ok(activity.out[0].includes('span span:1 parent span:0 0ms ok'))
  let idle = await terminal({ what: 'activity' }, empty())
  ok(idle.out[0].includes('no recorded events in this capture'))
})
