// The runtime configuration core: the catalog, URL validation/normalization,
// the graph > environment > default resolver with its source report, and the
// apply() boundary that validates a `setting` write in-transaction.
Deno.env.set('DB_PATH', ':memory:')
let { apply, settingValue, snapshot } = await import('./db.ts')
let {
  Invalid,
  catalog,
  effective,
  normalizeUrl,
  resolve,
  secretKeys,
  validate,
} = await import('./config.ts')
let { assertEquals, assertThrows } = await import('@std/assert')
let { bareDb } = await import('./testdb.ts')

bareDb()
let fresh = () => bareDb()
let uid = () => crypto.randomUUID()
// A reader over a plain map, for the pure resolver tests.
let from = (m: Record<string, string>) => (k: string) => m[k]
let none = () => undefined

Deno.test('normalizeUrl: canonicalizes a base URL and drops the trailing slash', () => {
  assertEquals(normalizeUrl('https://ollama.yak.sh/'), 'https://ollama.yak.sh')
  assertEquals(
    normalizeUrl('  https://host.example/v1  '),
    'https://host.example/v1',
  )
  assertEquals(normalizeUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434')
})

Deno.test('normalizeUrl: refuses non-http, credentials, query, and fragment', () => {
  for (
    let bad of [
      '',
      'not a url',
      'ftp://host',
      'file:///etc/passwd',
      'https://user:pass@host',
      'https://host?token=abc',
      'https://host#frag',
    ]
  ) assertThrows(() => normalizeUrl(bad), Invalid)
})

Deno.test('validate: normalizes a url key, refuses unknown and secret keys', () => {
  assertEquals(validate('OLLAMA_BASE_URL', 'https://host/'), 'https://host')
  assertThrows(() => validate('NOPE', 'x'), Invalid)
  // A secret never enters the graph — validate() refuses to store it there.
  assertThrows(() => validate('OLLAMA_API_KEY', 'sk-secret'), Invalid)
})

Deno.test('resolve: graph override wins over environment and default', () => {
  let r = resolve(
    'OLLAMA_BASE_URL',
    from({ OLLAMA_BASE_URL: 'https://graph' }),
    from({ OLLAMA_BASE_URL: 'https://env' }),
  )
  assertEquals(r.value, 'https://graph')
  assertEquals(r.source, 'graph')
})

Deno.test('resolve: environment answers when the graph is empty', () => {
  let r = resolve(
    'OLLAMA_BASE_URL',
    none,
    from({ OLLAMA_BASE_URL: 'https://env' }),
  )
  assertEquals(r.value, 'https://env')
  assertEquals(r.source, 'environment')
})

Deno.test('resolve: the catalog default is the last resort, and is reported as such', () => {
  let r = resolve('OLLAMA_BASE_URL', none, none)
  assertEquals(r.value, 'https://ollama.yak.sh/')
  assertEquals(r.source, 'default')
})

Deno.test('resolve: an empty override is a reset — the fallback shows through', () => {
  let r = resolve(
    'OLLAMA_BASE_URL',
    from({ OLLAMA_BASE_URL: '' }),
    from({
      OLLAMA_BASE_URL: 'https://env',
    }),
  )
  assertEquals(r.value, 'https://env')
  assertEquals(r.source, 'environment')
})

Deno.test('resolve: a secret key with no default reports unset, never a value', () => {
  let r = resolve('OLLAMA_API_KEY', none, none)
  assertEquals(r.value, undefined)
  assertEquals(r.source, 'default')
})

Deno.test('effective: reports only non-secret settings', () => {
  let keys = effective(none, none).map((e) => e.key)
  for (let k of secretKeys) assertEquals(keys.includes(k), false)
  assertEquals(keys.includes('OLLAMA_BASE_URL'), true)
})

Deno.test('apply: a setting write is validated, normalized, and read back', () => {
  let db = fresh()
  let eid = uid()
  let out = apply(db, [{
    eid,
    name: 'setting',
    comp: { key: 'OLLAMA_BASE_URL', value: 'https://host.example/' },
  }])
  // The echoed batch carries the canonical form.
  assertEquals(
    (out.find((c) => c.name == 'setting')!.comp as { value: string }).value,
    'https://host.example',
  )
  assertEquals(settingValue(db, 'OLLAMA_BASE_URL'), 'https://host.example')
  // Reading through the resolver's graph plane sees the committed override.
  assertEquals(
    resolve('OLLAMA_BASE_URL', (k) => settingValue(db, k)).source,
    'graph',
  )
})

Deno.test('apply: a value-only patch re-validates against the row key', () => {
  let db = fresh()
  let eid = uid()
  apply(db, [{
    eid,
    name: 'setting',
    comp: { key: 'OLLAMA_BASE_URL', value: 'https://one/' },
  }])
  apply(db, [{ eid, name: 'setting', comp: { value: 'https://two/' } }])
  assertEquals(settingValue(db, 'OLLAMA_BASE_URL'), 'https://two')
})

Deno.test('apply: a malformed value bounces the whole batch', () => {
  let db = fresh()
  assertThrows(() =>
    apply(db, [{
      eid: uid(),
      name: 'setting',
      comp: { key: 'OLLAMA_BASE_URL', value: 'ftp://nope' },
    }])
  )
  assertEquals(settingValue(db, 'OLLAMA_BASE_URL'), undefined)
})

Deno.test('apply: an unknown key is refused at the boundary', () => {
  let db = fresh()
  assertThrows(() =>
    apply(db, [{
      eid: uid(),
      name: 'setting',
      comp: { key: 'MADE_UP', value: 'x' },
    }])
  )
})

Deno.test('apply: a secret key can never reach the graph', () => {
  let db = fresh()
  assertThrows(() =>
    apply(db, [{
      eid: uid(),
      name: 'setting',
      comp: { key: 'OLLAMA_API_KEY', value: 'sk-secret' },
    }])
  )
  // And nothing about it is in the snapshot.
  assertEquals(JSON.stringify(snapshot(db)).includes('sk-secret'), false)
})

Deno.test('apply: a second override of one key bounces on the unique constraint', () => {
  let db = fresh()
  apply(db, [{
    eid: uid(),
    name: 'setting',
    comp: { key: 'OLLAMA_BASE_URL', value: 'https://one' },
  }])
  assertThrows(() =>
    apply(db, [{
      eid: uid(),
      name: 'setting',
      comp: { key: 'OLLAMA_BASE_URL', value: 'https://two' },
    }])
  )
  // The first override stands; the racing writer's value never landed.
  assertEquals(settingValue(db, 'OLLAMA_BASE_URL'), 'https://one')
})

Deno.test('catalog: keys are unique and Ollama is present', () => {
  let keys = catalog.map((s) => s.key)
  assertEquals(new Set(keys).size, keys.length)
  assertEquals(keys.includes('OLLAMA_BASE_URL'), true)
  assertEquals(keys.includes('OLLAMA_API_KEY'), true)
})
