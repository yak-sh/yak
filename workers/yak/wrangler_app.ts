// The part of Wrangler an app can carry without a build step. Resource ids
// come from the directory: accepting an account id from an app would let one
// tenant ask for another tenant's data.
import { migrationMetadata } from './app_migrations.ts'
// The upload wrapper is platform-owned, never the app's `main`.
export let WRAPPER = '__yak_entry.js'
export let WORKER = 'worker.js'

export type ResourceType = 'd1' | 'r2_bucket' | 'vectorize'
export type Bound = {
  name: string
  type: ResourceType
  id: string
  resource: string
}

type Database = { binding: string; database_id?: unknown }
type Bucket = { binding: string; bucket_name?: unknown }
type Index = {
  binding: string
  index_name?: unknown
  dimensions?: number
  metric?: 'cosine' | 'euclidean' | 'dot-product'
  preset?: string
}
export type Config = {
  main?: string
  compatibility_date?: string
  compatibility_flags?: string[]
  vars?: Record<string, unknown>
  d1_databases?: Database[]
  r2_buckets?: Bucket[]
  durable_objects?: { bindings: { name: string; class_name: string }[] }
  migrations?: Record<string, unknown>[]
  ai?: { binding: string }
  vectorize?: Index[]
}
export type Parsed = { config: Config; report: string[]; refused: string[] }
export type Request = {
  name: string
  type: ResourceType
  dimensions?: number
  metric?: Index['metric']
  preset?: string
}

export let HONORED = [
  'main',
  'compatibility_date',
  'compatibility_flags',
  'vars',
  'd1_databases',
  'r2_buckets',
  'durable_objects',
  'migrations',
  'ai',
  'vectorize',
]

let REFUSED: Record<string, string> = {
  KERNEL:
    "KERNEL belongs to yaks.app; choose another binding name, with env.STORE, env.FILES and env.APP for this app's doors",
  script_name:
    'Durable Objects may only belong to this app; use a local class_name and migrations',
  kv_namespaces:
    "KV has a 1000-namespace account cap and app sharing is undecided; use Durable Object storage or the app's store",
  queues:
    "queue provisioning is not available for apps; use wake rows and the app's store",
  crons:
    'user workers in a dispatch namespace receive no cron triggers; use wake rows',
}

let object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v == 'object' && !Array.isArray(v)

let strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s == 'string')

let line = (value: string) =>
  value.replaceAll('\r', '\\r').replaceAll('\n', '\\n')

// Match strings before comments so URLs and quoted comment markers survive.
// Whitespace preserves token boundaries: `1/* comment */2` must stay invalid.
let jsonc = (source: string) =>
  source.replace(
    /"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (s) => s.startsWith('"') ? s : s.replace(/[^\r\n]/g, ' '),
  ).replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, (s) => s == ',' ? '' : s)

export let parse = (source: string): Parsed => {
  let value: unknown
  try {
    value = JSON.parse(jsonc(source))
  } catch {
    return {
      config: {},
      report: [],
      refused: ['refused wrangler config: expected valid JSON or JSONC'],
    }
  }
  return allowlist(value)
}

// Keeping reports separate lets a deploy describe every ignored setting even
// when another setting refuses the worker upload.
export let allowlist = (value: unknown): Parsed => {
  let config: Config = {}
  let report: string[] = []
  let refused: string[] = []
  let no = (path: string, reason: string) =>
    refused.push(`refused ${line(path)}: ${reason}`)
  if (!object(value)) {
    no('wrangler config', 'expected an object')
    return { config, report, refused }
  }
  let names = new Set<string>()
  let name = (v: unknown, path: string): v is string => {
    if (v == 'KERNEL') {
      no(path, REFUSED.KERNEL)
      return false
    }
    if (typeof v != 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v)) {
      no(
        path,
        'expected a binding name of 1 to 64 letters, digits or underscores, starting with a letter or underscore',
      )
      return false
    }
    if (names.has(v)) {
      no(path, `binding ${v} is repeated; choose a different binding name`)
      return false
    }
    names.add(v)
    return true
  }
  let ignored = (v: unknown, path: string) => {
    report.push(`ignored ${line(path)}: yaks.app does not use this setting`)
    if (path.endsWith('.binding') && v == 'KERNEL') no(path, REFUSED.KERNEL)
    children(v, path)
  }
  let children = (v: unknown, path: string) => {
    if (object(v)) {
      for (let [k, child] of Object.entries(v)) ignored(child, `${path}.${k}`)
    } else if (Array.isArray(v)) {
      for (let [i, child] of v.entries()) children(child, `${path}[${i}]`)
    }
  }
  let keys = (v: Record<string, unknown>, allowed: string[], path = '') => {
    for (let [key, child] of Object.entries(v)) {
      if (!allowed.includes(key)) ignored(child, path + key)
    }
  }
  let rows = (v: unknown, path: string) => {
    if (!Array.isArray(v)) {
      no(path, 'expected an array of bindings')
      return []
    }
    return v.flatMap((row, i) => {
      if (object(row)) return [{ row, path: `${path}[${i}].` }]
      no(`${path}[${i}]`, 'expected a binding object')
      return []
    })
  }
  keys(value, [...HONORED, 'kv_namespaces', 'queues', 'triggers'])
  for (let key of ['kv_namespaces', 'queues']) {
    if (key in value) no(key, REFUSED[key])
  }
  if ('triggers' in value) {
    if (!object(value.triggers)) no('triggers', 'expected an object')
    else {
      keys(value.triggers, ['crons'], 'triggers.')
      if ('crons' in value.triggers) no('triggers.crons', REFUSED.crons)
    }
  }
  if ('main' in value) {
    let main = typeof value.main == 'string'
      ? value.main.replace(/^(?:\.\/)+/, '')
      : value.main
    if (
      typeof main != 'string' ||
      !/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs)$/
        .test(main) ||
      main.split('/').some((part) => part == '.' || part == '..') ||
      main == WRAPPER
    ) {
      no(
        'main',
        'expected an app-relative JavaScript source path (.js or .mjs); directories are allowed, __yak_entry.js is reserved for the platform',
      )
    } else config.main = main
  }
  if ('compatibility_date' in value) {
    if (
      typeof value.compatibility_date != 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.compatibility_date)
    ) no('compatibility_date', 'expected YYYY-MM-DD')
    else config.compatibility_date = value.compatibility_date
  }
  if ('compatibility_flags' in value) {
    if (!strings(value.compatibility_flags)) {
      no('compatibility_flags', 'expected an array of strings')
    } else config.compatibility_flags = value.compatibility_flags
  }
  if ('vars' in value) {
    if (!object(value.vars)) no('vars', 'expected an object')
    else {
      config.vars = Object.fromEntries(
        Object.entries(value.vars).filter(([key]) => name(key, `vars.${key}`)),
      )
    }
  }
  for (let kind of ['d1_databases', 'r2_buckets', 'vectorize'] as const) {
    if (!(kind in value)) continue
    let id = {
      d1_databases: 'database_id',
      r2_buckets: 'bucket_name',
      vectorize: 'index_name',
    }[kind]
    let found: Index[] = []
    for (let { row, path } of rows(value[kind], kind)) {
      keys(row, [
        'binding',
        id,
        ...(kind == 'vectorize' ? ['dimensions', 'metric', 'preset'] : []),
      ], path)
      if (!name(row.binding, path + 'binding')) continue
      let binding: Index = { binding: row.binding }
      if (id in row) Object.assign(binding, { [id]: row[id] })
      if (kind == 'vectorize') {
        if ('dimensions' in row) {
          if (
            typeof row.dimensions != 'number' ||
            !Number.isInteger(row.dimensions) || row.dimensions < 1 ||
            row.dimensions > 1536
          ) no(path + 'dimensions', 'expected an integer from 1 to 1536')
          else binding.dimensions = row.dimensions
        }
        if ('metric' in row) {
          if (
            row.metric !== 'cosine' && row.metric !== 'euclidean' &&
            row.metric !== 'dot-product'
          ) no(path + 'metric', 'expected cosine, euclidean or dot-product')
          else binding.metric = row.metric
        }
        if ('preset' in row) {
          if (typeof row.preset != 'string' || !row.preset.trim()) {
            no(path + 'preset', 'expected a nonempty Vectorize preset')
          } else binding.preset = row.preset
          if ('dimensions' in row || 'metric' in row) {
            no(
              path + 'preset',
              'use a preset or dimensions and metric, not both',
            )
          }
        }
      }
      found.push(binding)
    }
    config[kind] = found
  }
  if ('durable_objects' in value) {
    if (!object(value.durable_objects)) {
      no('durable_objects', 'expected an object')
    } else {
      let base = 'durable_objects.'
      keys(value.durable_objects, ['bindings'], base)
      let bindings: { name: string; class_name: string }[] = []
      for (
        let { row, path } of rows(
          value.durable_objects.bindings,
          base + 'bindings',
        )
      ) {
        keys(row, ['name', 'class_name', 'script_name'], path)
        if ('script_name' in row) no(path + 'script_name', REFUSED.script_name)
        if (!name(row.name, path + 'name')) continue
        if (typeof row.class_name != 'string' || !row.class_name.trim()) {
          no(path + 'class_name', 'expected a local Durable Object class name')
        } else bindings.push({ name: row.name, class_name: row.class_name })
      }
      config.durable_objects = { bindings }
    }
  }
  if ('migrations' in value) {
    if (!Array.isArray(value.migrations) || !value.migrations.every(object)) {
      no('migrations', 'expected an array of Durable Object migrations')
    } else {
      config.migrations = value.migrations
      let tags = new Set<string>()
      for (let [i, migration] of value.migrations.entries()) {
        if (typeof migration.tag != 'string' || !migration.tag.trim()) {
          no(`migrations[${i}].tag`, 'expected a nonempty migration tag')
        } else if (tags.has(migration.tag)) {
          no(`migrations[${i}].tag`, 'migration tags must be unique')
        } else tags.add(migration.tag)
        if (!Array.isArray(migration.transferred_classes)) continue
        for (let [j, transfer] of migration.transferred_classes.entries()) {
          if (object(transfer) && 'from_script' in transfer) {
            no(
              `migrations[${i}].transferred_classes[${j}].from_script`,
              REFUSED.script_name,
            )
          }
        }
      }
    }
  }
  if ('ai' in value) {
    if (!object(value.ai)) no('ai', 'expected a binding object')
    else {
      keys(value.ai, ['binding'], 'ai.')
      if (name(value.ai.binding, 'ai.binding')) {
        config.ai = { binding: value.ai.binding }
      }
    }
  }
  return { config, report, refused }
}

export let requests = (config: Config): Request[] => [
  ...(config.d1_databases ?? []).map(({ binding }) => ({
    name: binding,
    type: 'd1' as const,
  })),
  ...(config.r2_buckets ?? []).map(({ binding }) => ({
    name: binding,
    type: 'r2_bucket' as const,
  })),
  ...(config.vectorize ?? []).map((
    { binding, dimensions, metric, preset },
  ) => ({
    name: binding,
    type: 'vectorize' as const,
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(metric !== undefined ? { metric } : {}),
    ...(preset !== undefined ? { preset } : {}),
  })),
]

export let idReport = (config: Config, bound: Bound[]) => {
  let report: string[] = []
  for (
    let [key, type, id] of [
      ['d1_databases', 'd1', 'database_id'],
      ['r2_buckets', 'r2_bucket', 'bucket_name'],
      ['vectorize', 'vectorize', 'index_name'],
    ] as const
  ) {
    for (let [i, row] of (config[key] ?? []).entries()) {
      if (!(id in row)) continue
      let held = bound.find((b) => b.name == row.binding && b.type == type)
      report.push(
        `ignored ${key}[${i}].${id}: ${row.binding} uses ${
          held?.resource ?? "the app's provisioned resource"
        }`,
      )
    }
  }
  return report
}

export let metadata = (
  config: Config = {},
  bound: Bound[] = [],
  tag?: string,
  service = 'yak',
) => {
  let bindings: Record<string, unknown>[] = [
    { type: 'service', name: 'KERNEL', service },
  ]
  for (let [name, value] of Object.entries(config.vars ?? {})) {
    bindings.push(
      typeof value == 'string'
        ? { type: 'plain_text', name, text: value }
        : { type: 'json', name, json: value },
    )
  }
  for (let request of requests(config)) {
    let held = bound.find((b) =>
      b.name == request.name && b.type == request.type
    )
    if (!held) {
      throw new Error(`binding ${request.name} has no provisioned resource`)
    }
    let id =
      { d1: 'id', r2_bucket: 'bucket_name', vectorize: 'index_name' }[held.type]
    bindings.push({ type: held.type, name: held.name, [id]: held.id })
  }
  for (let binding of config.durable_objects?.bindings ?? []) {
    bindings.push({ type: 'durable_object_namespace', ...binding })
  }
  if (config.ai) bindings.push({ type: 'ai', name: config.ai.binding })
  let migrations = migrationMetadata(config.migrations, tag)
  return {
    main_module: WRAPPER,
    compatibility_date: config.compatibility_date ?? '2025-05-08',
    ...(config.compatibility_flags
      ? { compatibility_flags: config.compatibility_flags }
      : {}),
    bindings,
    ...(migrations ? { migrations } : {}),
    // Provisioned bindings are resent from the directory on every upload.
    // Keeping them here would leave a removed config binding attached; only
    // secrets have values that the platform deliberately never reads back.
    keep_bindings: ['secret_text'],
    limits: { cpu_ms: 50, subrequests: 50 },
  }
}
