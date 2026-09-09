import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import {
  allowlist,
  idReport,
  metadata,
  parse,
  requests,
} from './wrangler_app.ts'
import type { Bound } from './wrangler_app.ts'

let read = (value: unknown) => parse(JSON.stringify(value))

Deno.test('app config: JSONC preserves quoted comment markers and trailing commas in strings', () => {
  let source = `{
    // The app source can use its own filename.
    "main": "app-entry.mjs",
    "compatibility_flags": ["nodejs_compat", /* a comma before a comment */],
    "vars": {
      "URL": "https://example.com/a//b",
      "LITERAL": "/* text */ ,} ,]",
      "QUOTE": "a\\\"//b",
    },
  }`
  assertEquals(parse(source), {
    config: {
      main: 'app-entry.mjs',
      compatibility_flags: ['nodejs_compat'],
      vars: {
        URL: 'https://example.com/a//b',
        LITERAL: '/* text */ ,} ,]',
        QUOTE: 'a"//b',
      },
    },
    report: [],
    refused: [],
  })
  for (let source of ['{', '{} /* unfinished', '{"n":1/* comment */2}']) {
    assertEquals(parse(source).refused, [
      'refused wrangler config: expected valid JSON or JSONC',
    ])
  }
  for (let value of [null, [], 'config', 1]) {
    assertEquals(read(value).refused, [
      'refused wrangler config: expected an object',
    ])
  }
})

Deno.test('app config: each unknown key is reported and removed, including nested settings', () => {
  let parsed = read({
    name: 'ignored-name',
    workers_dev: true,
    build: { command: 'npm run build' },
    d1_databases: [{
      binding: 'DB',
      database_name: 'mine',
      preview_database_id: 'preview',
    }],
    r2_buckets: [{ binding: 'FILES', jurisdiction: 'eu' }],
    durable_objects: {
      bindings: [{
        name: 'ROOM',
        class_name: 'Room',
        environment: 'production',
      }],
    },
    ai: { binding: 'AI', remote: true },
    triggers: { other: ['ignored'] },
  })
  assertEquals(parsed.refused, [])
  assertEquals(
    parsed.report,
    [
      'name',
      'workers_dev',
      'build',
      'build.command',
      'triggers.other',
      'd1_databases[0].database_name',
      'd1_databases[0].preview_database_id',
      'r2_buckets[0].jurisdiction',
      'durable_objects.bindings[0].environment',
      'ai.remote',
    ].map((key) => `ignored ${key}: yaks.app does not use this setting`),
  )
  assertEquals(parsed.config, {
    d1_databases: [{ binding: 'DB' }],
    r2_buckets: [{ binding: 'FILES' }],
    durable_objects: { bindings: [{ name: 'ROOM', class_name: 'Room' }] },
    ai: { binding: 'AI' },
  })
})

Deno.test('app config: refusals name the limitation and the available door, one line each', () => {
  let parsed = read({
    vars: { KERNEL: 'override' },
    kv_namespaces: [{ binding: 'KV' }],
    queues: { producers: [{ binding: 'QUEUE' }] },
    triggers: { crons: ['* * * * *'] },
    durable_objects: {
      bindings: [{
        name: 'ROOM',
        class_name: 'Room',
        script_name: 'someone-else',
      }],
    },
  })
  assertEquals(parsed.refused, [
    "refused kv_namespaces: KV has a 1000-namespace account cap and app sharing is undecided; use Durable Object storage or the app's store",
    "refused queues: queue provisioning is not available for apps; use wake rows and the app's store",
    'refused triggers.crons: user workers in a dispatch namespace receive no cron triggers; use wake rows',
    "refused vars.KERNEL: KERNEL belongs to yaks.app; choose another binding name, with env.STORE, env.FILES and env.APP for this app's doors",
    'refused durable_objects.bindings[0].script_name: Durable Objects may only belong to this app; use a local class_name and migrations',
  ])
  assertEquals(parsed.refused.every((line) => !line.includes('\n')), true)
  assertEquals(parsed.config.vars, {})
  assertEquals(parsed.config.durable_objects, {
    bindings: [{ name: 'ROOM', class_name: 'Room' }],
  })
})

Deno.test('app config: KERNEL is reserved across binding types and duplicates refuse', () => {
  for (let key of ['d1_databases', 'r2_buckets', 'vectorize', 'services']) {
    let parsed = read({ [key]: [{ binding: 'KERNEL' }] })
    assertEquals(parsed.refused.length, 1, key)
    assertStringIncludes(parsed.refused[0], 'KERNEL belongs to yaks.app')
  }
  for (
    let value of [
      { ai: { binding: 'KERNEL' } },
      {
        durable_objects: { bindings: [{ name: 'KERNEL', class_name: 'Room' }] },
      },
    ]
  ) assertStringIncludes(read(value).refused[0], 'KERNEL belongs to yaks.app')
  assertEquals(
    read({ vars: { DB: 1 }, d1_databases: [{ binding: 'DB' }] }).refused,
    [
      'refused d1_databases[0].binding: binding DB is repeated; choose a different binding name',
    ],
  )
  assertEquals(
    read({ vars: { DATA: { name: 'KERNEL', binding: 'KERNEL' } } }).refused,
    [],
  )
  assertStringIncludes(
    read({ unknown: [[{ nested: true }]] }).report[1],
    'unknown[0][0].nested',
  )
  assertEquals(read({ 'line\nbreak': 1 }).report.length, 1)
  assertEquals(read({ 'line\nbreak': 1 }).report[0].includes('\n'), false)
})

Deno.test('app config: wrong shapes refuse before provisioning or uploading', () => {
  let cases: [unknown, string][] = [
    [{ main: '__yak_entry.js' }, 'main'],
    [{ main: '/lib/entry.js' }, 'main'],
    [{ main: 'lib/../entry.js' }, 'main'],
    [{ main: 'src/server.ts' }, 'main'],
    [{ main: '../entry.js' }, 'main'],
    [{ main: 'metadata' }, 'main'],
    [{ compatibility_date: 'tomorrow' }, 'compatibility_date'],
    [{ compatibility_flags: ['one', 2] }, 'compatibility_flags'],
    [{ vars: [] }, 'vars'],
    [{ vars: { 'bad name': true } }, 'vars.bad name'],
    [{ d1_databases: {} }, 'd1_databases'],
    [{ r2_buckets: [null] }, 'r2_buckets[0]'],
    [
      { vectorize: [{ binding: 'V', dimensions: 0 }] },
      'vectorize[0].dimensions',
    ],
    [
      { vectorize: [{ binding: 'V', dimensions: 1.5 }] },
      'vectorize[0].dimensions',
    ],
    [
      { vectorize: [{ binding: 'V', dimensions: 1537 }] },
      'vectorize[0].dimensions',
    ],
    [{ vectorize: [{ binding: 'V', metric: 'wrong' }] }, 'vectorize[0].metric'],
    [{ vectorize: [{ binding: 'V', preset: '' }] }, 'vectorize[0].preset'],
    [
      { vectorize: [{ binding: 'V', preset: 'model', dimensions: 3 }] },
      'vectorize[0].preset',
    ],
    [{ durable_objects: null }, 'durable_objects'],
    [{ durable_objects: {} }, 'durable_objects.bindings'],
    [
      { durable_objects: { bindings: [{ name: 'DO' }] } },
      'durable_objects.bindings[0].class_name',
    ],
    [{ migrations: ['v1'] }, 'migrations'],
    [{ migrations: [{}] }, 'migrations[0].tag'],
    [{ migrations: [{ tag: '' }] }, 'migrations[0].tag'],
    [{ migrations: [{ tag: 'v1' }, { tag: 'v1' }] }, 'migrations[1].tag'],
    [{ ai: 'AI' }, 'ai'],
    [{ ai: {} }, 'ai.binding'],
    [{ triggers: null }, 'triggers'],
  ]
  for (let [value, path] of cases) {
    let parsed = read(value)
    assertEquals(parsed.refused.length, 1, JSON.stringify(value))
    assertStringIncludes(parsed.refused[0], `refused ${path}:`)
  }
})

Deno.test("app config: migrations stay intact, but cannot transfer another script's data", () => {
  let migrations = [{ tag: 'v1', new_sqlite_classes: ['Room'] }]
  assertEquals(read({ migrations }).config.migrations, migrations)
  let parsed = read({
    migrations: [{
      tag: 'v2',
      transferred_classes: [{
        from_script: 'another-app',
        from: 'Room',
        to: 'Room',
      }],
    }],
  })
  assertEquals(parsed.refused, [
    'refused migrations[0].transferred_classes[0].from_script: Durable Objects may only belong to this app; use a local class_name and migrations',
  ])
})

Deno.test('app config: Vectorize creation options become requests, not upload bindings', () => {
  let parsed = read({
    vectorize: [
      { binding: 'SMALL', dimensions: 384, metric: 'cosine' },
      { binding: 'LARGE', preset: '@cf/baai/bge-large-en-v1.5' },
      { binding: 'EXISTING' },
    ],
  })
  assertEquals(parsed.refused, [])
  assertEquals(requests(parsed.config), [
    { name: 'SMALL', type: 'vectorize', dimensions: 384, metric: 'cosine' },
    { name: 'LARGE', type: 'vectorize', preset: '@cf/baai/bge-large-en-v1.5' },
    { name: 'EXISTING', type: 'vectorize' },
  ])
})

Deno.test('app metadata: no config keeps the current entry, compatibility date, kernel and limits', () => {
  assertEquals(metadata(), {
    main_module: '__yak_entry.js',
    compatibility_date: '2025-05-08',
    bindings: [{ type: 'service', name: 'KERNEL', service: 'yak' }],
    keep_bindings: ['secret_text'],
    limits: { cpu_ms: 50, subrequests: 50 },
  })
})

Deno.test('app metadata: every allowed binding uses its own shape and only graph resource ids', () => {
  let migrations = [{ tag: 'v1', new_sqlite_classes: ['Room'] }]
  let parsed = read({
    main: 'custom.js',
    compatibility_date: '2026-09-01',
    compatibility_flags: ['nodejs_compat'],
    vars: {
      TEXT: 'hello',
      NUMBER: 42,
      JSON: { nested: [true, null] },
      BOOL: false,
    },
    d1_databases: [{ binding: 'DB', database_id: 'someone-elses-database' }],
    r2_buckets: [{ binding: 'BUCKET', bucket_name: 'someone-elses-bucket' }],
    vectorize: [{ binding: 'INDEX', index_name: 'someone-elses-index' }],
    durable_objects: { bindings: [{ name: 'ROOM', class_name: 'Room' }] },
    migrations,
    ai: { binding: 'AI' },
  })
  let bound: Bound[] = [
    { name: 'DB', type: 'd1', id: 'our-database-id', resource: 'app-123-db' },
    {
      name: 'BUCKET',
      type: 'r2_bucket',
      id: 'app-123-bucket',
      resource: 'app-123-bucket',
    },
    {
      name: 'INDEX',
      type: 'vectorize',
      id: 'app-123-index',
      resource: 'app-123-index',
    },
    {
      name: 'REMOVED',
      type: 'd1',
      id: 'kept-database-id',
      resource: 'app-123-removed',
    },
  ]
  assertEquals(parsed.refused, [])
  assertEquals(metadata(parsed.config, bound), {
    main_module: '__yak_entry.js',
    compatibility_date: '2026-09-01',
    compatibility_flags: ['nodejs_compat'],
    bindings: [
      { type: 'service', name: 'KERNEL', service: 'yak' },
      { type: 'plain_text', name: 'TEXT', text: 'hello' },
      { type: 'json', name: 'NUMBER', json: 42 },
      { type: 'json', name: 'JSON', json: { nested: [true, null] } },
      { type: 'json', name: 'BOOL', json: false },
      { type: 'd1', name: 'DB', id: 'our-database-id' },
      { type: 'r2_bucket', name: 'BUCKET', bucket_name: 'app-123-bucket' },
      { type: 'vectorize', name: 'INDEX', index_name: 'app-123-index' },
      { type: 'durable_object_namespace', name: 'ROOM', class_name: 'Room' },
      { type: 'ai', name: 'AI' },
    ],
    migrations: { new_tag: 'v1', steps: [{ new_sqlite_classes: ['Room'] }] },
    keep_bindings: ['secret_text'],
    limits: { cpu_ms: 50, subrequests: 50 },
  })
  assertEquals(idReport(parsed.config, bound), [
    'ignored d1_databases[0].database_id: DB uses app-123-db',
    'ignored r2_buckets[0].bucket_name: BUCKET uses app-123-bucket',
    'ignored vectorize[0].index_name: INDEX uses app-123-index',
  ])
  assertThrows(
    () => metadata(parsed.config, []),
    Error,
    'binding DB has no provisioned resource',
  )
  assertThrows(
    () => metadata(parsed.config, [{ ...bound[0], type: 'vectorize' }]),
    Error,
    'binding DB has no provisioned resource',
  )
})

Deno.test('app allowlist: caller data is not mutated', () => {
  let value = {
    main: 'custom.js',
    vars: { URL: 'https://example.com' },
    ignored: true,
  }
  let before = structuredClone(value)
  allowlist(value)
  assertEquals(value, before)
})

Deno.test('main selects the app source, including directories and explicit worker.js', () => {
  for (
    let main of [
      'worker.js',
      'entry.js',
      'dist/server.mjs',
      'src/server.js',
      '.output/server/index.mjs',
    ]
  ) {
    assertEquals(read({ main }).refused, [])
    assertEquals(read({ main }).config.main, main)
    assertEquals(read({ main: './' + main }).config.main, main)
    assertEquals(metadata(read({ main }).config).main_module, '__yak_entry.js')
  }
  for (
    let main of [
      '',
      null,
      1,
      'dist//server.js',
      'dist/../../server.js',
      'dist\\server.js',
      'https://example.com/server.js',
      'server.js?x',
      './__yak_entry.js',
    ]
  ) {
    assertStringIncludes(read({ main }).refused[0], 'refused main:')
  }
})
