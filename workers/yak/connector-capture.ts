// Records what the connector answers a fixed corpus of MCP requests, both
// protocol eras, signed in and not, well formed and not, as one JSON file:
// two captures from two checkouts diff to what a client would see change.
//
//   deno run -A workers/yak/connector-capture.ts out.json
import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
import { kernel, seed } from './probe.ts'

let k = await kernel()
let { cookie } = await seed(k, [{ slug: 'capture', apps: ['notes'] }])

let MODERN = '2026-07-28'
let envelope = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'capture', version: '0' },
}
let HELLO = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'capture', version: '0' },
}

type Sent = {
  name: string
  path?: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  raw?: string
  signed?: boolean
}

let NAMED: Record<string, string> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
}
let rpc = (method: string, params?: unknown, id: unknown = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
})
let legacy = (
  name: string,
  method: string,
  params?: unknown,
  signed = true,
) => ({ name, body: rpc(method, params), signed })
let modern = (
  name: string,
  method: string,
  params: Record<string, unknown> = {},
  opts: { headers?: boolean; sse?: boolean; signed?: boolean } = {},
): Sent => {
  let named = NAMED[method]
  return {
    name,
    signed: opts.signed ?? true,
    headers: {
      accept: opts.sse === false
        ? 'application/json'
        : 'application/json, text/event-stream',
      ...(opts.headers === false ? {} : {
        'mcp-protocol-version': MODERN,
        'mcp-method': method,
        ...(named ? { 'mcp-name': String(params[named]) } : {}),
      }),
    },
    body: rpc(method, { ...params, _meta: envelope }),
  }
}

let guide = 'https://yaks.app/docs.md'
let corpus: Sent[] = [
  legacy('initialize', 'initialize', HELLO),
  legacy('initialize 2025-03-26', 'initialize', {
    ...HELLO,
    protocolVersion: '2025-03-26',
  }),
  legacy('initialize 2025-11-25', 'initialize', {
    ...HELLO,
    protocolVersion: '2025-11-25',
  }),
  legacy('initialize unknown version', 'initialize', {
    ...HELLO,
    protocolVersion: '1999-01-01',
  }),
  legacy('initialize anonymous', 'initialize', HELLO, false),
  {
    name: 'initialized notification',
    body: { jsonrpc: '2.0', method: 'notifications/initialized' },
  },
  legacy('ping', 'ping'),
  legacy('tools/list', 'tools/list'),
  legacy('tools/list anonymous', 'tools/list', undefined, false),
  {
    ...legacy('tools/list mixed', 'tools/list', undefined, false),
    path: '/mcp?auth=mixed',
  },
  legacy('graph_schema', 'tools/call', { name: 'graph_schema', arguments: {} }),
  legacy('about', 'tools/call', { name: 'about', arguments: {} }),
  legacy('app_list', 'tools/call', { name: 'app_list', arguments: {} }),
  legacy('mail_list', 'tools/call', {
    name: 'mail_list',
    arguments: { space: 'capture', app: 'notes' },
  }),
  legacy('mail_list bad direction', 'tools/call', {
    name: 'mail_list',
    arguments: { space: 'capture', app: 'notes', direction: 'up' },
  }),
  legacy('mail_list wrong type', 'tools/call', {
    name: 'mail_list',
    arguments: { space: 'capture', app: 'notes', limit: 'ten' },
  }),
  legacy('graph_query', 'tools/call', {
    name: 'graph_query',
    arguments: { q: '.app' },
  }),
  legacy('unknown tool', 'tools/call', { name: 'nope', arguments: {} }),
  legacy('tools/call no name', 'tools/call', { arguments: {} }),
  legacy('tools/call no params', 'tools/call'),
  legacy('tools/call bad args', 'tools/call', {
    name: 'graph_query',
    arguments: { q: 7 },
  }),
  {
    ...legacy(
      'mixed about',
      'tools/call',
      { name: 'about', arguments: {} },
      false,
    ),
    path: '/mcp?auth=mixed',
  },
  legacy('resources/list', 'resources/list'),
  legacy('resources/templates/list', 'resources/templates/list'),
  legacy('resources/read', 'resources/read', { uri: guide }),
  legacy('resources/read unknown', 'resources/read', { uri: 'nope://x' }),
  legacy('prompts/list', 'prompts/list'),
  legacy('prompts/get', 'prompts/get', { name: 'app-ideas', arguments: {} }),
  legacy('prompts/get unknown', 'prompts/get', { name: 'nope' }),
  legacy('logging/setLevel', 'logging/setLevel', { level: 'error' }),
  legacy('completion', 'completion/complete', {
    ref: { type: 'ref/prompt', name: 'app-ideas' },
    argument: { name: 'x', value: '' },
  }),
  legacy('unknown method', 'nope/nope'),
  legacy('server/discover legacy', 'server/discover'),
  { name: 'batch', body: [rpc('ping')] },
  { name: 'empty batch', body: [] },
  { name: 'not json', raw: '{nope' },
  { name: 'not rpc', body: { hello: 1 } },
  { name: 'response posted', body: { jsonrpc: '2.0', id: 1, result: {} } },
  { name: 'string id', body: rpc('ping', undefined, 'abc') },
  { name: 'get', method: 'GET', headers: { accept: 'application/json' } },
  { name: 'delete', method: 'DELETE' },
  modern('discover', 'server/discover'),
  modern('discover json', 'server/discover', {}, { sse: false }),
  modern('discover anonymous', 'server/discover', {}, { signed: false }),
  modern('discover no headers', 'server/discover', {}, { headers: false }),
  modern('modern ping', 'ping'),
  modern('modern tools/list', 'tools/list'),
  modern('modern tools/list json', 'tools/list', {}, { sse: false }),
  modern('modern graph_schema', 'tools/call', {
    name: 'graph_schema',
    arguments: {},
  }),
  modern('modern about', 'tools/call', { name: 'about', arguments: {} }),
  modern('modern about no headers', 'tools/call', {
    name: 'about',
    arguments: {},
  }, { headers: false }),
  modern('modern unknown tool', 'tools/call', { name: 'nope', arguments: {} }),
  modern('modern resources/list', 'resources/list'),
  modern('modern resources/templates/list', 'resources/templates/list'),
  modern('modern resources/read', 'resources/read', { uri: guide }),
  modern('modern prompts/list', 'prompts/list'),
  modern('modern prompts/get', 'prompts/get', {
    name: 'app-ideas',
    arguments: {},
  }),
  modern('modern logging/setLevel', 'logging/setLevel', { level: 'error' }),
  modern('modern initialize', 'initialize', HELLO),
  modern('modern unknown method', 'nope/nope'),
  {
    ...modern('modern name mismatch', 'tools/call', {
      name: 'about',
      arguments: {},
    }),
    headers: {
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/call',
      'mcp-name': 'graph_query',
    },
  },
  {
    name: 'modern method mismatch',
    headers: {
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/call',
    },
    body: rpc('tools/list', { _meta: envelope }),
  },
  {
    name: 'modern header without envelope',
    headers: {
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/list',
    },
    body: rpc('tools/list'),
  },
  {
    name: 'modern bad envelope',
    headers: { accept: 'application/json, text/event-stream' },
    body: rpc('tools/list', {
      _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN },
    }),
  },
  {
    name: 'modern unsupported version',
    headers: { accept: 'application/json, text/event-stream' },
    body: rpc('tools/list', {
      _meta: {
        ...envelope,
        'io.modelcontextprotocol/protocolVersion': '2027-01-01',
      },
    }),
  },
  {
    name: 'modern notification',
    headers: {
      'mcp-protocol-version': MODERN,
      'mcp-method': 'notifications/cancelled',
    },
    body: {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 9, _meta: envelope },
    },
  },
  {
    name: 'modern header on legacy initialize',
    headers: { 'mcp-protocol-version': MODERN },
    body: rpc('initialize', HELLO),
  },
  legacy('resources/read no uri', 'resources/read', {}),
  legacy('prompts/get no name', 'prompts/get', {}),
  legacy('prompts/get bad arguments', 'prompts/get', {
    name: 'app-ideas',
    arguments: [1],
  }),
  legacy('tools/call array arguments', 'tools/call', {
    name: 'about',
    arguments: [],
  }),
  legacy('tools/call numeric name', 'tools/call', { name: 7 }),
  legacy('initialize no clientInfo', 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
  }),
  legacy('logging/setLevel bad level', 'logging/setLevel', { level: 'loud' }),
  legacy('ping with params', 'ping', { _meta: {} }),
  {
    ...legacy('mixed prompts/list', 'prompts/list', undefined, false),
    path: '/mcp?auth=mixed',
  },
  {
    ...legacy('mixed resources/list', 'resources/list', undefined, false),
    path: '/mcp?auth=mixed',
  },
  {
    ...legacy('mixed initialize', 'initialize', HELLO, false),
    path: '/mcp?auth=mixed',
  },
  {
    ...legacy('mixed app_list', 'tools/call', {
      name: 'app_list',
      arguments: {},
    }, false),
    path: '/mcp?auth=mixed',
  },
  modern('modern resources/read unknown', 'resources/read', {
    uri: 'nope://x',
  }),
  modern('modern resources/read no uri', 'resources/read', {}),
  modern('modern prompts/get unknown', 'prompts/get', { name: 'nope' }),
  modern('modern tools/call no name', 'tools/call', { arguments: {} }),
  modern('modern subscriptions/listen', 'subscriptions/listen', {
    notifications: { toolsListChanged: true },
  }),
  modern('modern completion', 'completion/complete', {
    ref: { type: 'ref/prompt', name: 'app-ideas' },
    argument: { name: 'x', value: '' },
  }),
  {
    ...modern('modern mixed tools/list', 'tools/list', {}, { signed: false }),
    path: '/mcp?auth=mixed',
  },
  {
    name: 'modern clientInfo wrong type',
    headers: {
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/list',
    },
    body: rpc('tools/list', {
      _meta: { ...envelope, 'io.modelcontextprotocol/clientInfo': 'me' },
    }),
  },
  {
    name: 'modern capabilities wrong type',
    headers: {
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/list',
    },
    body: rpc('tools/list', {
      _meta: { ...envelope, 'io.modelcontextprotocol/clientCapabilities': 1 },
    }),
  },
  {
    name: 'modern version not a string',
    headers: { 'mcp-method': 'tools/list' },
    body: rpc('tools/list', {
      _meta: { ...envelope, 'io.modelcontextprotocol/protocolVersion': 7 },
    }),
  },
  {
    name: 'modern missing method header',
    headers: { 'mcp-protocol-version': MODERN, 'mcp-name': 'about' },
    body: rpc('tools/call', { name: 'about', arguments: {}, _meta: envelope }),
  },
  {
    name: 'modern base64 name',
    headers: {
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/call',
      'mcp-name': '=?base64?YWJvdXQ=?=',
    },
    body: rpc('tools/call', { name: 'about', arguments: {}, _meta: envelope }),
  },
  {
    name: 'modern batch',
    body: [rpc('tools/list', { _meta: envelope })],
  },
  {
    name: 'wrong content type',
    headers: {
      'content-type': 'text/plain',
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/list',
    },
    body: rpc('tools/list', { _meta: envelope }),
  },
]

// What varies run to run says nothing about the protocol: ids, times and
// the space a run made.
let steady = (text: string) =>
  text
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      '<uuid>',
    )
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>')
    .replace(/\b1[789]\d{11}\b/g, '<ms>')
    .replace(/probe[0-9a-f]+@/g, 'probe@')

let read = async (r: Response) => {
  let type = r.headers.get('content-type') ?? ''
  if (type.includes('text/event-stream')) {
    let reader = r.body!.getReader()
    let text = ''
    let bytes = new TextDecoder()
    // A stream that stays open (a listen) is read for what it sends first.
    let stop = setTimeout(() => reader.cancel(), 1500)
    try {
      for (;;) {
        let { done, value } = await reader.read()
        if (done) break
        text += bytes.decode(value, { stream: true })
      }
    } catch { /* cancelled */ }
    clearTimeout(stop)
    return { sse: steady(text) }
  }
  let text = await r.text()
  try {
    return { json: JSON.parse(steady(text)) }
  } catch {
    return { text: steady(text) }
  }
}

let heard: Record<string, unknown> = {}
for (let sent of corpus) {
  let headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(sent.signed === false ? {} : { cookie }),
    ...sent.headers,
  }
  let r = await k.at(k.host, sent.path ?? '/mcp', {
    method: sent.method ?? 'POST',
    headers,
    ...(sent.method && sent.method != 'POST' ? {} : {
      body: sent.raw ?? JSON.stringify(sent.body),
    }),
  })
  heard[sent.name] = {
    status: r.status,
    type: r.headers.get('content-type'),
    session: r.headers.has('mcp-session-id'),
    challenge: r.headers.has('www-authenticate'),
    ...(await read(r)),
  }
}
io.writeTextFileSync(system.args[0], JSON.stringify(heard, null, 2) + '\n')
system.exit(0)
