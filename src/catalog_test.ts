// The spawn catalog read back out of the graph it was seeded into: the shape
// every door speaks, the menu rules (an alias accepted but unoffered, a
// fallback transport carrying models but no menu, the test rig callable but
// unlisted), and the validation gate spawning reads.
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from '@std/assert'
import { spawnDefault } from './providers.ts'

Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./live_db.ts')
let { catalog, known, levels, trouble } = await import('./catalog.ts')
let { apply } = await import('./db.ts')
let { uuid } = await import('./types.ts')

let ps = known(db)
let of = (name: string) => ps.find((p) => p.name == name)!
let ask = (o: { provider?: string; model?: string; effort?: string }) =>
  trouble(known(db), o)

Deno.test('spawnDefault: model-only Astra routes through the graph catalog by readiness', () => {
  assertEquals(spawnDefault(known(db), { model: 'gpt-6-astra' }), {
    provider: 'codex',
    model: 'gpt-6-astra',
  })
  assertEquals(
    spawnDefault(known(db, (name) => name != 'codex'), {
      model: 'gpt-6-astra',
    }),
    { provider: 'codex-cli', model: 'gpt-6-astra' },
  )
})

Deno.test('spawnDefault: an unserved model reports the available graph providers', () => {
  let table = known(db)
  let error = assertThrows(
    () => spawnDefault(table, { model: 'unserved-model' }),
    Error,
  )
  assertEquals(
    error.message,
    `no provider serves model: unserved-model; available providers: ${
      table.map((p) => p.name).join(', ')
    }`,
  )
  assertThrows(
    () => spawnDefault([], { model: 'unserved-model' }),
    Error,
    'no provider serves model: unserved-model; available providers: (none)',
  )
})

Deno.test('catalog: one row per provider, allowlists only — no argv', () => {
  assertEquals(
    catalog(db).map((p) => p.name),
    ['claude', 'codex', 'codex-cli', 'ollama'],
  )
  // The test rig is known and callable, but never listed.
  assertEquals(ps.map((p) => p.name).includes('fake'), true)
  assertEquals(of('fake').offered, false)
  for (let p of ps) assertEquals('argv' in p, false)
  // Every friendly-named offer fronts an allowlisted model.
  for (let p of ps) {
    for (let m of Object.keys(p.labels ?? {})) {
      assertEquals(p.models.includes(m), true)
    }
  }
})

Deno.test('catalog: a readiness probe stamps ready per provider', () => {
  let stamped = known(db, (name) => name != 'codex')
  assertEquals(stamped.find((p) => p.name == 'codex')?.ready, false)
  assertEquals(stamped.find((p) => p.name == 'codex-cli')?.ready, true)
  assertEquals(stamped.find((p) => p.name == 'claude')?.ready, true)
})

Deno.test('claude: opus-5 and the bare opus alias are barred; 4-8 leads', () => {
  // A non-opus line rides its alias (latest is wanted); opus does not.
  assertEquals(ask({ provider: 'claude', model: 'sonnet' }), null)
  assertEquals(ask({ provider: 'claude', model: 'claude-opus-4-8' }), null)
  // The 1M-context variant is the same pin, accepted alongside the base.
  assertEquals(ask({ provider: 'claude', model: 'claude-opus-4-8[1m]' }), null)
  // The ban is a rejection, never a silent downgrade — both spellings that
  // reach claude-opus-5 are refused: the pinned id and the alias for it.
  assertNotEquals(ask({ provider: 'claude', model: 'claude-opus-5' }), null)
  assertNotEquals(ask({ provider: 'claude', model: 'opus' }), null)
  let claude = of('claude')
  assertEquals(claude.models.includes('claude-opus-5'), false)
  assertEquals(claude.models.includes('opus'), false)
  // claude-opus-4-8 leads, so an explicit Claude request defaults to it, and
  // the menu offers it as Opus.
  assertEquals(claude.models[0], 'claude-opus-4-8')
  assertEquals(Object.keys(claude.labels!)[0], 'claude-opus-4-8')
  assertEquals(claude.labels!['claude-opus-4-8'], 'Opus')
  // An alias the menu already names through another spelling stays accepted.
  assertEquals(claude.models.includes('claude-fable-5'), true)
  assertEquals('claude-fable-5' in claude.labels!, false)
  assertEquals(ask({ provider: 'claude', model: 'claude-fable-5' }), null)
})

Deno.test('codex: the celestial line, Sol first, gpt-6-astra beside it', () => {
  let codex = of('codex')
  assertEquals(codex.models, [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-6-astra',
  ])
  assertEquals(codex.efforts, [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
  ])
  assertEquals(codex.labels!['gpt-6-astra'], 'GPT-6 Astra')
})

Deno.test('codex-cli carries codex models but no menu of its own', () => {
  let fallback = of('codex-cli')
  assertEquals(fallback.models, of('codex').models)
  assertEquals(fallback.efforts, of('codex').efforts)
  assertEquals(fallback.labels, {})
  assertEquals(fallback.fallback, true)
})

Deno.test('ollama: direct model ids, no :cloud suffix, no process adapter', () => {
  let ollama = of('ollama')
  assertEquals(ollama.models[0], 'kimi-k2.7-code')
  assertEquals(ollama.models.includes('gpt-oss:120b'), true)
  assertEquals(ollama.models.some((m) => m.endsWith(':cloud')), false)
  assertEquals(ollama.models.some((m) => m.endsWith('-cloud')), false)
  assertEquals(ollama.labels!['kimi-k2.7-code'], 'Kimi K2.7 Code')
  assertEquals(ask({ provider: 'ollama', model: 'kimi-k2.7-code' }), null)
})

Deno.test('trouble: unknown provider/model/effort each name the valid ones', () => {
  assertMatch(
    ask({ provider: 'oracle', model: 'x' })!,
    /unknown provider: oracle — have .*claude/,
  )
  assertMatch(
    ask({ provider: 'claude', model: 'gpt-9' })!,
    /unknown model: gpt-9 — claude has .*opus/,
  )
  assertMatch(
    ask({ provider: 'codex', model: 'gpt-5.6-sol', effort: 'heroic' })!,
    /unknown effort: heroic — codex has .*high/,
  )
  assertEquals(
    ask({ provider: 'codex', model: 'gpt-5.6-sol', effort: 'high' }),
    null,
  )
})

// T-15352: a provider with no launch-effort knob (empty allowlist) IGNORES an
// effort rather than rejecting it — so switching a spawn onto claude never dies
// on an inherited/passed effort.
Deno.test('trouble: an empty effort allowlist ignores effort, never rejects', () => {
  assertEquals(of('claude').efforts, [])
  assertEquals(
    ask({ provider: 'claude', model: 'haiku', effort: 'high' }),
    null,
  )
  assertEquals(
    ask({ provider: 'ollama', model: 'kimi-k3', effort: 'high' }),
    null,
  )
})

Deno.test('levels: the effort list reads whitespace or commas', () => {
  assertEquals(levels('low medium  high'), ['low', 'medium', 'high'])
  assertEquals(levels('low, high'), ['low', 'high'])
  assertEquals(levels(''), [])
  assertEquals(levels(null), [])
})

// The point of the whole change: a new model is a WRITE, not a release.
Deno.test('a new model is a graph write, offered the moment it lands', () => {
  let eid = uuid()
  let codex = ps.find((p) => p.name == 'codex')!
  let host = (db.prepare(`
    select e.eid as eid from provider p
      join entity e on e.id = p.entity
     where p.name = 'codex'`).get() as { eid: string }).eid
  apply(db, [
    { eid, name: 'doc', comp: { title: 'GPT 7 Nova' } },
    {
      eid,
      name: 'model',
      comp: {
        name: 'gpt-7-nova',
        provider: host,
        label: 'GPT-7 Nova',
        efforts: 'low high',
        effort: 'high',
      },
    },
  ])
  let after = known(db).find((p) => p.name == 'codex')!
  assertEquals(after.models.includes('gpt-7-nova'), true)
  assertEquals(after.labels!['gpt-7-nova'], 'GPT-7 Nova')
  assertEquals(after.defaults!['gpt-7-nova'], 'high')
  assertEquals(ask({ provider: 'codex', model: 'gpt-7-nova' }), null)
  // The fallback transport picks it up too — it serves codex's models.
  assertEquals(
    known(db).find((p) => p.name == 'codex-cli')!.models.includes('gpt-7-nova'),
    true,
  )
  assertEquals(codex.models.includes('gpt-7-nova'), false) // the old read stands
})
