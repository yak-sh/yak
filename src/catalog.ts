// The spawn catalog as graph data (T-35023). WHICH providers exist, which
// models each one serves, which effort levels a model admits and which of them
// a menu offers are `provider` and `model` ENTITIES — so adding gpt-6-astra is
// a write, not a release. adapters.ts keeps what is genuinely code: the argv a
// provider is launched with and the readers that turn its stream into summary
// columns.
//
// Two halves live here. `catalog(db)` reads the entities back in the ONE shape
// every door already speaks (providers.ts `Provider`, GET /providers), so
// spawn validation, the menu, and `task help spawn` all read the graph through
// one reader. `SEED` is the table this replaced, carried into the graph once by
// db.ts open(): find-or-mint by name, filling only columns that are still
// blank, so it is idempotent and never clobbers an owner's edit.
//
// A fallback transport (codex-cli) `serves` another provider's models rather
// than owning duplicates of them, and carries no menu of its own — the same
// rule providers.ts states for the picker, said once here in data.

import type { Sql } from './store/sql.ts'
import type { Provider } from './providers.ts'

// A list column, said the way alias.slugs and anchor.paths say one: whitespace
// or commas, trimmed, empties dropped.
export let levels = (efforts?: string | null): string[] =>
  (efforts ?? '').split(/[\s,]+/).filter(Boolean)

type Seat = {
  name: string
  transport: 'process' | 'http'
  credential?: string
  fallback?: boolean
  serves?: string
  offered?: boolean
  title: string
  models: Model[]
}
// `label` is the menu name and defaults to the title; `offered` false keeps a
// model accepted but off every menu (an alias the line beside it already
// names). `efforts` is the space-separated allowlist, `effort` the default.
type Model = {
  name: string
  title: string
  label?: string
  efforts?: string
  effort?: string
  offered?: boolean
}

let CODEX_EFFORTS = 'low medium high xhigh max ultra'

// The table as adapters.ts held it on 2026-09-09, model order preserved: a
// provider's first model is what spawnDefault picks when a caller names the
// provider and no model, so the order is behavior, not decoration.
export let SEED: Seat[] = [
  {
    name: 'claude',
    title: 'Claude',
    transport: 'process',
    // Subscription auth rides HOME — no keys in argv or env.
    credential: 'home',
    models: [
      // Opus is pinned to 4-8: the bare `opus` alias is neither offered nor
      // accepted, and opus-5 stays barred. The other lines ride their alias,
      // so the menu needs no edit when a non-opus line ships a new latest.
      { name: 'claude-opus-4-8', title: 'Opus 4.8', label: 'Opus' },
      { name: 'claude-opus-4-8[1m]', title: 'Opus 4.8 1M', label: 'Opus 1M' },
      { name: 'sonnet', title: 'Sonnet', label: 'Sonnet' },
      { name: 'haiku', title: 'Haiku', label: 'Haiku' },
      { name: 'fable', title: 'Fable', label: 'Fable' },
      // Accepted, unoffered: the menu already names these through an alias.
      { name: 'claude-fable-5', title: 'Fable 5', offered: false },
      { name: 'claude-sonnet-5', title: 'Sonnet 5', offered: false },
      { name: 'claude-haiku-4-5', title: 'Haiku 4.5', offered: false },
    ],
  },
  {
    name: 'codex',
    title: 'Codex',
    transport: 'process',
    credential: 'codex-account',
    models: [
      {
        name: 'gpt-5.6-sol',
        title: 'GPT 5.6 Sol',
        label: 'GPT-5.6 Sol',
        efforts: CODEX_EFFORTS,
      },
      {
        name: 'gpt-5.6-terra',
        title: 'GPT 5.6 Terra',
        label: 'GPT-5.6 Terra',
        efforts: CODEX_EFFORTS,
      },
      {
        name: 'gpt-5.6-luna',
        title: 'GPT 5.6 Luna',
        label: 'GPT-5.6 Luna',
        efforts: CODEX_EFFORTS,
      },
      {
        name: 'gpt-6-astra',
        title: 'GPT 6 Astra',
        label: 'GPT-6 Astra',
        efforts: CODEX_EFFORTS,
      },
    ],
  },
  {
    // The permanent CLI transport for codex's models: requestable by name,
    // ranked behind graph-native codex, never a menu entry of its own.
    name: 'codex-cli',
    title: 'Codex CLI',
    transport: 'process',
    credential: 'home',
    fallback: true,
    serves: 'codex',
    models: [],
  },
  {
    // The owner's ollama server: a direct HTTP provider, no installed CLI.
    // Its ids carry no `:cloud` suffix, and it has no launch-time effort knob.
    name: 'ollama',
    title: 'Ollama',
    transport: 'http',
    credential: 'ollama-base',
    models: [
      { name: 'kimi-k2.7-code', title: 'Kimi K2.7 Code' },
      { name: 'glm-5.2', title: 'GLM-5.2' },
      { name: 'gpt-oss:120b', title: 'GPT-OSS 120B' },
      { name: 'kimi-k2.6', title: 'Kimi K2.6' },
      { name: 'deepseek-v4-pro:preview', title: 'DeepSeek V4 Pro Preview' },
      { name: 'mistral-large-3:675b', title: 'Mistral Large 3 675B' },
      { name: 'kimi-k3', title: 'Kimi K3' },
      { name: 'gpt-oss:20b', title: 'GPT-OSS 20B' },
      { name: 'nemotron-3-ultra', title: 'Nemotron 3 Ultra' },
      { name: 'minimax-m2.7', title: 'MiniMax M2.7' },
      { name: 'gemma4:31b', title: 'Gemma 4 31B' },
      { name: 'deepseek-v4-flash:0731', title: 'DeepSeek V4 Flash 0731' },
      { name: 'glm-5.1', title: 'GLM-5.1' },
      { name: 'deepseek-v4-flash:preview', title: 'DeepSeek V4 Flash Preview' },
      { name: 'nemotron-3-nano:30b', title: 'Nemotron 3 Nano 30B' },
      { name: 'minimax-m3', title: 'MiniMax M3' },
      { name: 'nemotron-3-super', title: 'Nemotron 3 Super' },
      { name: 'deepseek-v4-pro:0813', title: 'DeepSeek V4 Pro 0813' },
      { name: 'qwen3.5:397b', title: 'Qwen 3.5 397B' },
    ],
  },
  {
    // The in-repo test rig: still callable by name (tests, API smoke runs),
    // never an offer, so it stays out of every menu and every default.
    name: 'fake',
    title: 'Fake provider',
    transport: 'process',
    offered: false,
    models: [
      { name: 'fake-fast', title: 'Fake Fast', efforts: 'low medium high' },
      { name: 'fake-slow', title: 'Fake Slow', efforts: 'low medium high' },
    ],
  },
]

type Seen = {
  provider: string
  fallback: number | null
  offered: number | null
  serves: string | null
  model: string | null
  label: string | null
  efforts: string | null
  effort: string | null
  model_offered: number | null
}

// Menu-offered models lead, each group in entity order — so a provider's FIRST
// model is the one it defaults to (providers.ts spawnDefault), and the menu
// reads in the order the models were filed. Entity order alone would rank an
// alias the menu never shows ahead of the line it stands for.
let ROWS = `
  select p.name as provider, p.fallback, p.offered, sp.name as serves,
         m.name as model, m.label, m.efforts, m.effort,
         m.offered as model_offered
    from provider p
    join entity pe on pe.id = p.entity
    left join provider sp on sp.entity = p.serves
    left join model m on m.provider = p.entity
    left join entity me on me.id = m.entity
   order by pe.num, coalesce(m.offered, 1) = 0, me.num`

type Seat_ = Provider & { serves?: string; defaults: Record<string, string> }

// Every provider the graph knows, offered or not — the allowlist a launcher
// checks a request against. The menu (`catalog`) is this minus the unoffered.
export let known = (db: Sql, ready?: (name: string) => boolean): Provider[] => {
  let seats = new Map<string, Seat_>()
  for (let r of db.prepare(ROWS).all() as unknown as Seen[]) {
    let p = seats.get(r.provider)
    if (!p) {
      p = {
        name: r.provider,
        models: [],
        efforts: [],
        labels: {},
        defaults: {},
        ...(r.fallback ? { fallback: true } : {}),
        ...(r.serves ? { serves: r.serves } : {}),
        ...(r.offered === 0 ? { offered: false } : {}),
      }
      seats.set(r.provider, p)
    }
    if (!r.model) continue
    p.models.push(r.model)
    for (let e of levels(r.efforts)) {
      if (!p.efforts!.includes(e)) p.efforts!.push(e)
    }
    if (r.effort) p.defaults[r.model] = r.effort
    // A fallback transport carries no menu: the same models are offered once,
    // through the provider it serves.
    if (r.model_offered !== 0 && r.label && !r.fallback) {
      p.labels![r.model] = r.label
    }
  }
  // A fallback transport runs the models of the provider it serves rather than
  // owning a second copy of each.
  for (let p of seats.values()) {
    let host = p.serves ? seats.get(p.serves) : undefined
    if (!host) continue
    p.models = [...host.models]
    p.efforts = [...host.efforts!]
    p.defaults = { ...host.defaults }
  }
  return [...seats.values()].map(({ serves: _serves, ...p }) => ({
    ...p,
    ...(ready ? { ready: ready(p.name) } : {}),
  }))
}

// The catalog every door offers — the shape GET /providers has always served.
// A provider marked `offered = false` stays callable by name but never listed;
// the in-repo `fake` rig is the whole of it today.
export let catalog = (db: Sql, ready?: (name: string) => boolean) =>
  known(db, ready).filter((p) => p.offered !== false)

// A start request weighed against the graph — the friendly gate a sugar tool
// answers BEFORE it mints a session, so a bad model is a clear error naming the
// valid ones, never a doomed husk on the board. Null means it will launch. The
// created(session) effect re-checks in-transaction for the raw wire; this is
// the early door. `all` must include the unoffered providers (`fake`), so the
// gate accepts everything the launcher accepts.
export let trouble = (
  all: Provider[],
  { provider, model, effort }: {
    provider?: string
    model?: string
    effort?: string
  },
): string | null => {
  let p = all.find((x) => x.name == provider)
  if (!p) {
    return `unknown provider: ${provider} — have ${
      all.map((x) => x.name).join(', ')
    }`
  }
  if (!model || !p.models.includes(model)) {
    return `unknown model: ${model} — ${provider} has ${p.models.join(', ')}`
  }
  // No effort list means the provider has no launch-time effort knob (claude
  // takes no --effort flag), so an effort that reaches it — passed, inherited,
  // or mirrored off a task hint — is a no-op, not a failure. Only a provider
  // that DOES offer efforts rejects an unknown one, so a real typo (codex +
  // 'heroic') still errors clearly.
  let efforts = p.efforts ?? []
  if (effort && efforts.length && !efforts.includes(effort)) {
    return `unknown effort: ${effort} — ${provider} has ${efforts.join(', ')}`
  }
  return null
}
