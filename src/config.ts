// Runtime configuration: one code catalog and a resolver over three planes.
//
// The catalog is the executable contract — every setting Tasks understands,
// with its label, group, type, default, validation, sensitivity, and help.
// Provider code asks this module for a catalog key; it never reads `Deno.env`
// directly, and the UI can only render settings the catalog names (no arbitrary
// environment editor, D-18092).
//
// Two storage planes hang off the one catalog. A NON-secret override lives on a
// `setting {key, value}` graph entity (types.ts/db.ts) and travels the ordinary
// mutation + broadcast path. A SECRET stays behind the server-only credential
// API (credentials.ts) and never becomes a graph component. This module owns
// the catalog and the non-secret resolver; it holds no secret bytes.
//
// Resolution order for a non-secret value is graph override > process
// environment (deployment compatibility) > catalog default. `resolve` reports
// which plane answered so a UI can tell "reset to default" from "empty value",
// and consumers call it at each operation boundary, so a saved override reaches
// the next use without a tasksd restart. Validation is total on the WRITE side
// (`validate`, run by apply() at the graph boundary); reads stay total and never
// throw, because a value that reached storage already passed validation.

// What a setting IS on the wire. `url` normalizes and constrains to a base URL;
// `text` is free text. (Secrets are `text` too — sensitivity, not type, is what
// routes them off the graph.)
export type SettingType = 'url' | 'text'

// One catalog entry: the whole contract for a single setting.
export type Spec = {
  key: string
  label: string
  group: string
  type: SettingType
  // A secret never becomes a graph component; its bytes live behind
  // credentials.ts. The catalog still names it so both planes render from one
  // list and the UI can group provider accounts, endpoints, and credentials.
  sensitive: boolean
  help: string
  // The value when neither the graph nor the environment overrides it. A secret
  // has none — absence is "not configured", never a shipped credential.
  default?: string
}

// Which plane answered a resolve. `default` also covers "no value anywhere"
// (a setting with no default that nothing overrides) — the effective value is
// then undefined, which the UI reads as unset.
export type Source = 'graph' | 'environment' | 'default'

export type Effective = {
  key: string
  value?: string
  source: Source
  spec: Spec
}

// A validation refusal, carried as a tiny Error so the write boundary can turn
// it into a 400 (client.ts/apply()) with the reason intact — never a raw SQLite
// constraint the caller can't read.
export class Invalid extends Error {}

let invalid = (message: string): never => {
  throw new Invalid(message)
}

// Normalize and constrain a base URL: http/https only, no embedded credentials,
// no query, no fragment. The trailing slash is dropped so a provider appends its
// path against a canonical origin (ollama_cloud.ts adds `/v1`). Idempotent, so
// re-normalizing a stored value is a no-op.
export let normalizeUrl = (raw: string): string => {
  let text = raw.trim()
  if (!text) invalid('Enter a URL.')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return invalid('Enter a valid URL, including https://.')
  }
  if (url.protocol != 'http:' && url.protocol != 'https:') {
    invalid('Use an http or https URL.')
  }
  if (url.username || url.password) {
    invalid('Remove the username or password from the URL.')
  }
  if (url.search) invalid('Remove the query string from the URL.')
  if (url.hash) invalid('Remove the # fragment from the URL.')
  let path = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path}`
}

// The first entries (D-18092): Ollama's shareable base URL and its credential.
// The key is the API surface a consumer asks for and the environment name a
// deployment already sets, so the environment plane is a drop-in fallback.
export let catalog: Spec[] = [
  {
    key: 'OLLAMA_BASE_URL',
    label: 'Ollama base URL',
    group: 'ollama',
    type: 'url',
    sensitive: false,
    default: 'https://ollama.yak.sh/',
    help:
      'Base URL for the Ollama-compatible Responses API. An origin gets the ' +
      'OpenAI-compatible /v1 path appended; a URL already ending in /v1 is ' +
      'used as-is.',
  },
  {
    key: 'OLLAMA_API_KEY',
    label: 'Ollama API key',
    group: 'ollama',
    type: 'text',
    sensitive: true,
    help:
      'Bearer token for the hosted Ollama API. Optional for an unauthenticated ' +
      'endpoint. Stored by the server-only credential store, never in the graph.',
  },
  {
    key: 'DISPATCH_SLOTS',
    label: 'Dispatch slots',
    group: 'dispatch',
    type: 'text',
    sensitive: false,
    default: '2',
    help: 'How many auto-dispatched sessions may run at once (T-21323). The ' +
      'dispatch sweep spawns one session per approved, unblocked open task ' +
      'while live dispatched sessions number fewer than this.',
  },
]

export let byKey: Map<string, Spec> = new Map(catalog.map((s) => [s.key, s]))

export let spec = (key: string): Spec | undefined => byKey.get(key)

// Every non-secret key — the graph plane's whole vocabulary.
export let plainKeys: string[] = catalog.filter((s) => !s.sensitive).map((s) =>
  s.key
)
// Every secret key — the credential store's vocabulary (credentials.ts).
export let secretKeys: string[] = catalog.filter((s) => s.sensitive).map((s) =>
  s.key
)

// Validate and normalize a candidate value for a catalog key, at the WRITE
// boundary. Throws Invalid on an unknown key, a value written to a secret key
// (secrets never enter the graph), or a malformed value; returns the canonical
// form to store. Called by apply() so every door that writes a setting is
// guarded in-transaction.
export let validate = (key: string, value: string): string => {
  let s = byKey.get(key)
  if (!s) invalid(`Unknown setting ${JSON.stringify(key)}.`)
  if (s!.sensitive) {
    invalid(`${key} is a secret and cannot be stored in the graph.`)
  }
  return s!.type == 'url' ? normalizeUrl(value) : value.trim()
}

export type Reader = (key: string) => string | undefined

// The effective value for a catalog key and where it came from. Graph override
// wins, then the environment, then the catalog default. A stored/overriding
// value is taken verbatim — validation already ran on the way in — so this stays
// total and safe on a hot path. An unknown key throws (a programming error, not
// user input).
export let resolve = (
  key: string,
  graph: Reader,
  env: Reader = (name) => Deno.env.get(name),
): Effective => {
  let s = byKey.get(key)
  if (!s) throw new Error(`Unknown setting ${JSON.stringify(key)}.`)
  let over = graph(key)
  if (over != null && over !== '') {
    return { key, value: over, source: 'graph', spec: s }
  }
  let fromEnv = env(key)
  if (fromEnv != null && fromEnv !== '') {
    return { key, value: fromEnv, source: 'environment', spec: s }
  }
  return {
    key,
    ...(s.default == null ? {} : { value: s.default }),
    source: 'default',
    spec: s,
  }
}

// The effective non-secret settings, for the config panel's source report.
// Secrets are omitted on purpose — their state comes from credentials.ts, which
// never returns a value.
export let effective = (
  graph: Reader,
  env: Reader = (name) => Deno.env.get(name),
): Effective[] => plainKeys.map((key) => resolve(key, graph, env))

// One non-secret setting as the config panel reads it over the wire: the
// flattened catalog contract, the resolved value + which plane answered, and the
// existing `setting` entity's eid when one holds an override. `setting.key` is
// UNIQUE, so the eid is what a client save targets — writing a value against it
// rather than minting a second, colliding row for the key. Secrets never appear:
// `sensitive` is always false here, so it is dropped from the shape.
export type SettingRow = {
  key: string
  label: string
  group: string
  type: SettingType
  help: string
  default?: string
  value?: string
  source: Source
  eid?: string
}

// The wire shape for GET /config/settings. Owns the shaping here (server.ts
// stays a thin route) while holding no db handle: the caller injects the graph
// reader and an eid-by-key reader, the two halves of the graph plane. Non-secret
// only, so no secret bytes and no credential state ever cross this door.
export let settingRows = (
  graph: Reader,
  eidOf: (key: string) => string | undefined,
  env: Reader = (name) => Deno.env.get(name),
): SettingRow[] =>
  effective(graph, env).map(({ key, value, source, spec }) => {
    let eid = eidOf(key)
    return {
      key,
      label: spec.label,
      group: spec.group,
      type: spec.type,
      help: spec.help,
      ...(spec.default == null ? {} : { default: spec.default }),
      ...(value == null ? {} : { value }),
      source,
      ...(eid == null ? {} : { eid }),
    }
  })
