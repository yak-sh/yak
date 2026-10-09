// What a release costs the Stores it reaches, measured with the runtime's
// billed SQL cursor counters and told by where the rows went: the schema, the
// description of the vocabulary, search, the spine, the store's own keys, or a
// component's table. Each step of a path is counted apart. Three paths: an
// app's release reaching its Store, a Store waking on new code, and the git
// objects a release writes into yak/git.
import { Store } from './graph.ts'
import type { State } from './graph.ts'
import { GIT_STORE, IDEMPOTENCY } from './door.ts'
import { by, val } from '@yaks/sql'
import { driver } from '@yaks/durable-object'
import { commitOnto, type Writes } from '@yaks/git'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { vocab as gitVocab } from '../../packages/git/testing.ts'
import tasks from '../../apps/village-tasks/vocab.json' with { type: 'json' }
import seed from '../../apps/village-tasks/seed.json' with { type: 'json' }

export type Cost = { read: number; written: number; calls: number }
export type Steps = Record<string, { total: Cost; by: Record<string, Cost> }>

let empty = (): Cost => ({ read: 0, written: 0, calls: 0 })
let plus = (a: Cost, b: Cost) => {
  a.read += b.read
  a.written += b.written
  a.calls += b.calls
}

// The words that describe a vocabulary (@yaks/vocab), and the store's spine.
let DESCRIBED = ['_package', '_comp', '_prop', '_extends', '_before', '_vocab']
let SPINE = ['entity', 'archetype', 'retired', 'created', 'edge']

/** Where a statement's rows go: the table it reads from or writes into,
 * grouped. Joined tables belong to the table driving the statement. */
export let sourceOf = (sql: string): string => {
  if (/^\s*(create|drop|alter|pragma|analyze)\b/i.test(sql)) return 'schema'
  if (/sqlite_(master|schema)|pragma_/i.test(sql)) return 'schema'
  let depth = 0, name = ''
  for (
    let token of sql.matchAll(
      /"(?:[^"]|"")*"|'(?:[^']|'')*'|[()]|\b(?:from|into|update)\b/gi,
    )
  ) {
    let word = token[0]
    if (word == '(') depth++
    else if (word == ')') depth--
    else if (depth == 0 && /^(from|into|update)$/i.test(word)) {
      name = sql.slice(token.index + word.length).match(
        /^\s+"?([A-Za-z0-9_]+)"?/,
      )?.[1] ?? ''
      break
    }
  }
  if (!name) return 'other'
  if (DESCRIBED.includes(name)) return 'descriptions'
  if (/_fts|_text$/.test(name)) return 'search'
  if (/^embedding/.test(name)) return 'embedding'
  if (name == 'yak_kv' || name == 'server_meta') return 'keys'
  if (SPINE.includes(name)) return 'spine'
  return name
}

/** The rows a storage's statements cost from now on, by step and source.
 * `step` names what the statements that follow belong to. */
export let meter = (storage: State['storage']) => {
  let sql = storage.sql.exec.bind(storage.sql)
  let steps: Steps = {}
  let at: Steps[string] | null = null
  let shapes = new Map<string, Cost & { step: string }>()
  let step = ''
  storage.sql.exec = (query, ...args) => {
    let cursor = sql(query, ...args)
    let rows = cursor.toArray()
    if (at) {
      if (cursor.rowsRead == null || cursor.rowsWritten == null) {
        throw new Error('release cost needs SQL cursor counters')
      }
      let cost = {
        read: cursor.rowsRead,
        written: cursor.rowsWritten,
        calls: 1,
      }
      plus(at.total, cost)
      plus(at.by[sourceOf(query)] ??= empty(), cost)
      let key = `${step}\0${query}`
      let shape = shapes.get(key) ??
        (shapes.set(key, { ...empty(), step }), shapes.get(key)!)
      plus(shape, cost)
    }
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  return {
    /** Count what follows as `name`; `null` stops counting. */
    step: (name: string | null) => {
      step = name ?? ''
      at = name == null ? null : (steps[name] ??= { total: empty(), by: {} })
    },
    steps,
    /** What every step cost together. */
    total: () => {
      let all = empty()
      for (let s of Object.values(steps)) plus(all, s.total)
      return all
    },
    /** The costliest statements, for finding where a source's rows went. */
    top: (n = 15) =>
      [...shapes].map(([key, cost]) => ({
        sql: key.split('\0')[1].slice(0, 240),
        ...cost,
      })).sort((a, b) => b.read + b.written - a.read - a.written).slice(0, n),
    stop: () => {
      storage.sql.exec = sql
    },
  }
}

let HEADERS = {
  'x-store': 'probe/release-cost',
  'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  'x-yak-role': 'owner',
  'x-yak-access': 'private',
}

// A Store's door as the kernel asks it (door.ts): `base` and the request's own
// headers, a key of its own, a body posted as JSON, and a refusal thrown.
let door = (store: () => Store, base: Record<string, string>) =>
async (
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
) => {
  let res = await store().fetch(
    new Request(`https://store${path}`, {
      headers: { ...base, ...headers, [IDEMPOTENCY]: crypto.randomUUID() },
      ...(body === undefined ? {} : {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    }),
  )
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`)
  return await res.json()
}

let context = (storage: State['storage']) => ({
  storage,
  getWebSockets: () => [],
  acceptWebSocket: () => {},
})

/**
 * A small app's first release and the release after it, which changes no
 * word, each as tools.ts `published` sends it to the app's Store: the serving
 * release's reads, the candidate's declarations and seed, the notice, the
 * first request that selects the candidate, and the alarm it arms.
 */
export let releaseCost = async (storage: State['storage']) => {
  let store = new Store(context(storage), {}, [])
  let ask = door(() => store, HEADERS)
  let as = (release: string, base?: string, kernel = false) => ({
    'x-yak-release': release,
    ...(base == null ? {} : { 'x-yak-base-release': base }),
    ...(kernel ? { 'x-yak-kernel': '1' } : {}),
  })
  let release = async (from: string, to: string) => {
    let m = meter(storage)
    try {
      m.step('serving reads')
      await ask('/vocab', as(from))
      await ask('/uses', as(from))
      m.step('candidate vocab')
      await ask('/vocab', as(to, from), tasks)
      m.step('candidate declarations')
      await ask('/uses', as(to, from), {})
      if (from == '0') {
        m.step('candidate seed')
        await ask('/seed', as(to, from), seed)
      }
      m.step('candidate declarations')
      await ask('/vocab', as(to, from))
      await ask('/uses', as(to, from))
      await ask('/tools', as(to, from), {})
      await ask('/vocab', as(to, from))
      m.step('notice')
      await ask('/released', as(from, undefined, true), {
        version: Number(to),
      })
      await ask(
        '/query?q=' + encodeURIComponent('.exception&?doc&!archived'),
        as(from),
      )
      m.step('selected')
      await ask('/query?q=.village_task', as(to))
      m.step('alarm')
      await store.alarm()
      m.step(null)
      return { total: m.total(), steps: m.steps, top: m.top(10) }
    } finally {
      m.stop()
    }
  }
  return { first: await release('0', '1'), again: await release('1', '2') }
}

/**
 * A Store waking on new code that changed nothing it holds, beside `history`
 * retained entities: the first request after the deploy, and the alarm.
 */
export let wakeCost = async (storage: State['storage'], history: number) => {
  let ctx = context(storage)
  let store = new Store(ctx, {}, [])
  let ask = door(() => store, HEADERS)
  let kernel = { 'x-yak-kernel': '1' }
  await ask('/vocab', kernel, {
    $defs: {
      note: {
        component: true,
        index: [['label']],
        properties: { label: { type: 'string' } },
      },
    },
  })
  for (let start = 0; start < history; start += 500) {
    await ask(
      '/apply',
      kernel,
      Array.from({ length: Math.min(500, history - start) }, (_, i) => ({
        entity: { eid: `history-${start + i}` },
        note: { label: `kept ${start + i}` },
        doc: { title: `Retained document ${start + i}`, body: 'lemon orchard' },
      })),
    )
  }
  await storage.deleteAlarm?.()
  // The stamp the code before this one left: what a deploy finds.
  driver(storage).query({
    t: 'update',
    table: 'yak_kv',
    set: { v: val('previous release') },
    where: by({ k: 'schema' }),
  })
  let m = meter(storage)
  try {
    m.step('wake')
    store = new Store(ctx, {}, [])
    await ask('/query?q=' + encodeURIComponent('.note .limit=1'), kernel)
    m.step('alarm')
    await store.alarm()
    m.step(null)
    return { history, total: m.total(), steps: m.steps, top: m.top(10) }
  } finally {
    m.stop()
  }
}

let hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * yak/git across an app's first release of `paths` and the next, which
 * changes six of them, beside `others` objects of another app: the store is
 * every app's.
 */
export let gitCost = async (
  storage: State['storage'],
  paths: string[],
  others: number,
) => {
  let store = new Store(context(storage), {}, [])
  let ask = door(() => store, { 'x-store': GIT_STORE })
  let objects = {
    read: (q) => ask('/query?q=' + encodeURIComponent(String(q))),
    apply: (b) => ask('/apply', { 'x-yak-kernel': '1' }, b),
  } as Writes
  let refs = graph({ vocab: gitVocab, storage: ram(gitVocab) })
  let held = new Map<string, Uint8Array>()
  let bytes = {
    has: (sha: string) => held.has(sha),
    get: (sha: string) => held.get(sha),
    put: (sha: string, b: Uint8Array) => void held.set(sha, b),
  }
  let file = async (text: string) => {
    let b = new TextEncoder().encode(text)
    let sha = await hex(b)
    held.set(sha, b)
    return sha
  }
  let who = {
    name: 'probe',
    email: 'probe@yaks.app',
    at: '2026-10-08T00:00:00Z',
  }
  // Each commit's manifest, as the directory's deploy rows say it.
  let made = new Map<string, Record<string, string>>()
  let land = async (app: string, files: Record<string, string>, n: number) => {
    let c = await commitOnto({ refs, objects, bytes }, {
      app,
      files: { ...files },
      author: who,
      committer: who,
      message: `deploy ${n}\n`,
      was: (commit) => made.get(commit) ?? null,
    })
    made.set(c.oid, { ...files })
  }
  let theirs: Record<string, string> = {}
  for (let i = 0; i < others; i++) {
    theirs[`lib/${i % 20}/file${i}.js`] = await file(`other ${i}`)
  }
  if (others) await land('a0000000-0000-4000-8000-000000000001', theirs, 1)
  let mine: Record<string, string> = {}
  for (let p of paths) mine[p] = await file(`first ${p}`)
  let m = meter(storage)
  try {
    m.step('first release')
    await land('b0000000-0000-4000-8000-000000000002', mine, 1)
    for (let p of paths.slice(0, 6)) mine[p] = await file(`second ${p}`)
    m.step('six files changed')
    await land('b0000000-0000-4000-8000-000000000002', mine, 2)
    m.step(null)
    return { others, steps: m.steps, top: m.top(10) }
  } finally {
    m.stop()
  }
}
