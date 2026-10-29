// Claude transcript accounting. Usage is billed once per message id; prompt
// categories are character-weighted estimates because logs lack per-block tokens.
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { basename, dirname, join } from 'node:path'

let operator = 'ac7184a3-f341-4697-a8a7-b4ea0984c0db'
export let options = (args: string[]) => ({
  json: args.includes('--json'),
  positionals: args.filter((arg) => arg !== '--json'),
})
let settings = options(Deno.args)
let since = settings.positionals[0] ?? '2026-10-27T22:00:00Z'
let until = settings.positionals[1] ?? '2026-10-29T04:00:00Z'
let roots = settings.positionals.slice(2)
if (!roots.length) {
  roots = [`${Deno.env.get('HOME')}/.claude/projects`, '/tmp/claude-1000']
}
// Logs are heterogeneous vendor records, interpreted at the read boundary.
// deno-lint-ignore no-explicit-any
type Json = any
type Counts = Record<string, number>
export let summary = (report: Json) => {
  let money = (n: number) => `$${n.toFixed(2)}`
  let share = (n: number) =>
    `${(report.totalCost ? n / report.totalCost * 100 : 0).toFixed(2)}%`
  let costs = Object.entries(report.costs as Counts).sort((a, b) => b[1] - a[1])
  let tasks = Object.entries(report.taskCosts as Counts).sort((a, b) =>
    b[1] - a[1]
  ).slice(0, 3)
  return [
    `${report.since} to ${report.until} (end exclusive)`,
    `API equivalent: ${money(report.totalCost)}`,
    `${report.uniqueMessages} requests; ${report.sessions.length} sessions; ${
      money(
        report.uniqueMessages ? report.totalCost / report.uniqueMessages : 0,
      )
    } per request`,
    `Context tokens: median ${report.context.median}; p90 ${report.context.p90}; max ${report.context.max}`,
    'Billing shares:',
    ...costs.slice(0, 5).map(([name, cost]) =>
      `  ${name}: ${money(cost)} (${share(cost)})`
    ),
    ...(costs.length > 5
      ? [
        `  other: ${
          money(costs.slice(5).reduce((n, [, cost]) => n + cost, 0))
        }`,
      ]
      : []),
    `Operator own: ${money(report.operator.own)} (${
      share(report.operator.own)
    })`,
    `Operator and descendants: ${money(report.operator.cost)} (${
      share(report.operator.cost)
    })`,
    ...(tasks.length
      ? [
        'Top claimed tasks (period costs):',
        ...tasks.map(([id, cost]) => `  ${id}: ${money(cost)}`),
      ]
      : []),
    'Use --json for the full per-session report and command examples.',
  ].join('\n')
}
let add = (a: Counts, b: Counts, weight = 1) => {
  for (let [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v * weight
  return a
}
let sum = (a: Counts) => Object.values(a).reduce((a, b) => a + b, 0)
let files = async function* (path: string): AsyncGenerator<string> {
  try {
    for await (let e of Deno.readDir(path)) {
      let p = join(path, e.name)
      if (e.isDirectory) yield* files(p)
      else if (/\.(jsonl|output)$/.test(p)) yield p
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
}
let lines = async function* (path: string): AsyncGenerator<Json> {
  let stream = createReadStream(path)
  let reader = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (let line of reader) {
      try {
        yield JSON.parse(line)
      } catch { /* interrupted writes / shell output */ }
    }
  } finally {
    reader.close()
    stream.destroy()
  }
}
let rates = (model: string, context: number) => {
  if (model === 'claude-opus-5-5') return [4, 20, 5, 8, .2]
  if (model === 'claude-sonnet-5-5') return [2, 10, 2.5, 4, .1]
  if (model === 'claude-haiku-5-5') {
    return context > 100000 ? [.5, 2.5, .625, 1, .05] : [.1, .5, .125, .2, .01]
  }
  if (
    [
      'claude-opus-4-5',
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-5',
    ].includes(model)
  ) return [5, 25, 6.25, 10, .5]
  if (
    [
      'claude-sonnet-4',
      'claude-sonnet-4-5',
      'claude-sonnet-4-6',
      'claude-sonnet-5',
    ].includes(model)
  ) {
    return model.includes('sonnet-5')
      ? [2, 10, 2.5, 4, .2]
      : [3, 15, 3.75, 6, .3]
  }
  if (['claude-haiku-4-5', 'claude-haiku-4-5-20251001'].includes(model)) {
    return [1, 5, 1.25, 2, .1]
  }
  throw Error(`Unknown model: ${model}`)
}
export let bill = (m: Json) => {
  let u = m.usage, c = u.cache_creation ?? {}
  let t = {
    input: u.input_tokens ?? 0,
    write5m: c.ephemeral_5m_input_tokens ??
      Math.max(
        0,
        (u.cache_creation_input_tokens ?? 0) -
          (c.ephemeral_1h_input_tokens ?? 0),
      ),
    write1h: c.ephemeral_1h_input_tokens ?? 0,
    read: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    thinking: u.output_tokens_details?.thinking_tokens ?? 0,
  }
  let context = t.input + t.write5m + t.write1h + t.read
  let [i, o, w5, w1, hit] = rates(m.model, context)
  let scale = (u.inference_geo === 'us' ? 1.1 : 1) *
    (u.speed === 'fast' ? 2 : 1) / 1e6
  let costs = {
    input: t.input * i * scale,
    write5m: t.write5m * w5 * scale,
    write1h: t.write1h * w1 * scale,
    read: t.read * hit * scale,
    thinking: t.thinking * o * scale,
    output: (t.output - t.thinking) * o * scale,
    search: (u.server_tool_use?.web_search_requests ?? 0) * .01,
  }
  return { tokens: t, costs, cost: sum(costs), context }
}
export let prefer = (prior: Json, next: Json) =>
  !prior ||
  (next.own && !prior.own) ||
  (next.own === prior.own &&
    (next.message.usage.output_tokens > prior.message.usage.output_tokens ||
      (next.message.usage.output_tokens === prior.message.usage.output_tokens &&
        !(next.path.endsWith('.output') && !prior.path.endsWith('.output')))))
export let taskIds = (r: Json): string[] => {
  let m = r.message, ids = new Set<string>()
  let blocks = typeof m?.content === 'string'
    ? [{ type: 'text', text: m.content }]
    : m?.content ?? []
  for (let b of blocks) {
    if (
      r.type === 'user' && b.type === 'text' && /^Work(?: on)? T-/.test(b.text)
    ) {
      for (let id of b.text.split(/[.\n]/, 1)[0].matchAll(/T-\d+/g)) {
        ids.add(id[0])
      }
    }
    if (r.type !== 'assistant' || b.type !== 'tool_use') continue
    let input = b.input ?? {}
    let target = b.name === 'mcp__tasks__claim_take'
      ? input.target
      : b.name === 'mcp__tasks__task_update' && input.status === 'done'
      ? input.task
      : ''
    if (/^T-\d+$/.test(target ?? '')) ids.add(target)
    for (
      let match of (input.command ?? '').matchAll(
        /\byak (?:task (?:claim|done|close)|claim take)\s+(T-\d+)/g,
      )
    ) ids.add(match[1])
  }
  return [...ids]
}
let text = (value: Json): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
    ? value.map((x) => x.text ?? x.thinking ?? JSON.stringify(x)).join('\n')
    : JSON.stringify(value ?? '')
let instructions = (s: string): Counts => {
  let result: Counts = {}
  let rest = s.replace(
    /<available-skills>[\s\S]*?<\/available-skills>|<skills_instructions>[\s\S]*?<\/skills_instructions>/g,
    (x) => {
      result.skills = (result.skills ?? 0) + x.length
      return ''
    },
  )
  result.instructions = rest.length
  return result
}
let names = [
  'agent-briefs',
  'builders-and-builds',
  'business-model',
  'code-style',
  'data-migration',
  'design-docs',
  'effects-and-rules',
  'end-to-end-checks',
  'graph-reads-and-writes',
  'native-sessions',
  'packages-and-plugins',
  'platform-visualize',
  'query-grammar',
  'search-and-embeddings',
  'secrets-and-connections',
  'sharing',
  'skill-writing',
  'testing',
  'ui-building',
  'vocabulary',
  'writing-documentation',
  'yaks-app',
  'yaks-app-business',
]

let environment = (s: string): Counts => {
  let result: Counts = {}
  let start = s.indexOf(
    'The following skills are available for use with the Skill tool:',
  )
  let end = s.indexOf('While bypass permissions mode is active:', start)
  let markers = [
    s.indexOf('# Environment'),
    s.indexOf('The following tools'),
    s.indexOf('The following deferred tools'),
  ].filter((n) => n >= 0)
  let hook = Math.min(...markers)
  result.hooks = hook
  let listing = start < 0 ? '' : s.slice(start, end < 0 ? undefined : end)
  let repo = listing.split('\n').filter((line) =>
    names.some((name) => line.startsWith('- ' + name + ':'))
  ).reduce((n, line) => n + line.length + 1, 0)
  result['repo-skills'] = repo
  result.skills = listing.length - repo
  result['cli-environment'] = s.length - hook - listing.length
  return result
}
let classify = (m: Json, calls: Map<string, Json>): Counts => {
  let result: Counts = {}
  for (
    let b of typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : m.content ?? []
  ) {
    let s = text(b.content ?? b.text ?? b.thinking ?? b)
    if (m.role !== 'assistant') {
      s = s.replace(/^- [a-z-]+:.*$/gm, (line) => {
        if (!names.some((name) => line.startsWith('- ' + name + ':'))) {
          return line
        }
        result['repo-skills'] = (result['repo-skills'] ?? 0) + line.length
        return ''
      })
    }
    if (b.type === 'tool_result') {
      let call = calls.get(b.tool_use_id), name = call?.name ?? 'unknown'
      // PostToolUse feedback is model-visible, in addition to the tool's output.
      s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, (x) => {
        result.hooks = (result.hooks ?? 0) + x.length
        return ''
      })
      if (
        name === 'Bash' &&
        /yak (?:--[^ ]+ [^ ]+ )?admin errors/.test(call?.input?.command ?? '')
      ) {
        s = s.replace(
          /^Resolved[^\n]*[\s\S]*?(?=^Open longest:|^People[’']s letters|$(?![\s\S]))/m,
          (block) => {
            result['admin-resolved'] = (result['admin-resolved'] ?? 0) +
              block.length
            return ''
          },
        )
      }
      let category = name === 'Bash'
        ? (/\b(deno (task )?(test|gate|check)|yak land)\b/.test(
            call?.input?.command ?? '',
          )
          ? 'test-output'
          : 'bash-output')
        : name === 'Read'
        ? 'file-reads'
        : name.startsWith('mcp__')
        ? 'mcp-results'
        : 'other-tool-results'
      result[category] = (result[category] ?? 0) + s.length
    } else if (m.role === 'assistant') {
      result['assistant-history'] = (result['assistant-history'] ?? 0) +
        s.length
    } else if (/Codebase and user instructions are shown below/.test(s)) {
      add(result, instructions(s))
    } else if (
      /^(SessionStart:|SubagentStart hook)/.test(s) &&
      s.includes('# Environment')
    ) {
      add(result, environment(s))
    } else if (
      /^(SessionStart|SubagentStart|PostToolUse):.*hook/.test(
        s,
      )
    ) result.hooks = (result.hooks ?? 0) + s.length
    else if (
      /skill_listing|The following skills|<available-skills>|<skills_instructions>/
        .test(s)
    ) result.skills = (result.skills ?? 0) + s.length
    else {result['user-and-reminders'] = (result['user-and-reminders'] ?? 0) +
        s.length}
  }
  return result
}
if (import.meta.main) {
  let messages = new Map<string, Json>()
  let shapes = new Map<string, Counts>()
  let requests = new Map<string, { chars: Counts; session: string }>()
  let tasks = new Map<string, Set<string>>()
  let outputs = new Map<string, Json>()
  let scanned = 0, duplicates = 0
  let seenPaths = new Set<string>()
  for (let root of roots) {
    for await (let path of files(root)) {
      try {
        path = await Deno.realPath(path)
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) continue
        throw e
      }
      if (seenPaths.has(path)) continue
      seenPaths.add(path)
      // Old files cannot contain new requests; inherited history in new files is
      // still deduplicated globally. Blob histories before the window are retained.
      try {
        if ((await Deno.stat(path)).mtime!.toISOString() < since) continue
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) continue
        throw e
      }
      let blobs = new Map<string, Json>(), calls = new Map<string, Json>()
      let pending: Json[] = [], history: string[] = []
      let session = basename(path).replace(/\.(jsonl|output)$/, '')
      let parent = /\/([^/]+)\/subagents\//.exec(path)?.[1]
      if (path.endsWith('.output')) parent = basename(dirname(dirname(path)))
      let ids = new Set<string>()
      for await (let r of lines(path)) {
        scanned++
        if (r.type === 'api-request-shape') {
          let s = r.shape
          let chars: Counts = {
            'system-prompt': text(s.system).length,
            'tool-schemas': JSON.stringify(s.tools ?? []).length,
          }
          shapes.set(r.shapeHash, chars)
        }
        if (r.type === 'api-request-blob') blobs.set(r.hash, r.message)
        if (r.type === 'api-request') {
          history = [...history.slice(0, r.keep), ...r.tail]
          if (r.timestamp >= since && r.timestamp < until) {
            pending.push({ ...r, hashes: history })
          }
        }
        let m = r.message
        for (let id of taskIds(r)) ids.add(id)
        if (m?.content && Array.isArray(m.content)) {
          for (let b of m.content) {
            if (b.type !== 'tool_use') {
              continue
            }
            calls.set(b.id, b)
          }
        }
        if (
          r.type !== 'assistant' || !m?.usage || !m.id ||
          m.model === '<synthetic>'
        ) continue
        if (r.timestamp < since || r.timestamp >= until) continue
        let prior = messages.get(m.id)
        let own = pending.some((x) => x.id === r.requestRef)
        if (prior) duplicates++
        // Copied fork history is not a second API request. Prefer the file with
        // the actual request record; then the latest final streaming usage.
        if (prefer(prior, { own, message: m, path })) {
          messages.set(m.id, {
            message: m,
            own,
            session,
            parent,
            path,
            ref: r.requestRef,
            effort: r.effort,
            timestamp: r.timestamp,
          })
        }
      }
      tasks.set(session, ids)
      // Blob tool calls can refer to content inherited from an ancestor file.
      for (let m of blobs.values()) {
        for (
          let b of Array.isArray(m.content) ? m.content : []
        ) if (b.type === 'tool_use') calls.set(b.id, b)
      }
      let categories = new Map(
        [...blobs].map(([hash, m]) => [hash, classify(m, calls)]),
      )
      for (let r of pending) {
        let chars = add({}, shapes.get(r.shapeHash) ?? {})
        for (let hash of r.hashes) add(chars, categories.get(hash) ?? {})
        requests.set(r.id, { chars, session })
      }
      // Raw largest output sizes, independent of context repetitions; commands
      // stay local in stdout and are never written into the report artifact.
      for (let [hash, m] of blobs) {
        for (
          let b of Array.isArray(m.content) ? m.content : []
        ) {
          if (b.type !== 'tool_result') continue
          let call = calls.get(b.tool_use_id)
          let s = text(b.content), prior = outputs.get(hash)
          if (call && (!prior || s.length > prior.chars)) {
            outputs.set(hash, {
              tool: call.name,
              chars: s.length,
              command: call.input?.command,
              file: call.input?.file_path,
            })
          }
        }
      }
    }
  }
  let sessions = new Map<string, Json>(),
    total: Counts = {},
    tokens: Counts = {},
    allocation: Counts = {},
    contexts: number[] = []
  let effort: Record<string, number> = {},
    models: Record<string, number> = {},
    coverageCost = 0
  for (let r of messages.values()) {
    let b = bill(r.message), req = requests.get(r.ref)
    let session = sessions.get(r.session) ??
      {
        session: r.session,
        parent: r.parent,
        turns: 0,
        cost: 0,
        tokens: {},
        costs: {},
        context: [],
        tasks: [...(tasks.get(r.session) ?? [])],
        allocation: {},
        firstContext: b.context,
        firstInputCost: b.cost - b.costs.output - b.costs.thinking,
      }
    session.turns++
    session.cost += b.cost
    session.context.push(b.context)
    add(session.tokens, b.tokens)
    add(session.costs, b.costs)
    sessions.set(r.session, session)
    add(total, b.costs)
    add(tokens, b.tokens)
    contexts.push(b.context)
    effort[r.effort ?? 'unspecified'] =
      (effort[r.effort ?? 'unspecified'] ?? 0) +
      b.cost
    models[r.message.model] = (models[r.message.model] ?? 0) + b.cost
    if (req && sum(req.chars)) {
      let inputCost = b.cost - b.costs.output - b.costs.thinking -
        b.costs.search
      add(allocation, req.chars, inputCost / sum(req.chars))
      add(session.allocation, req.chars, inputCost / sum(req.chars))
      coverageCost += inputCost
    }
  }
  let quantiles = (values: number[]) => {
    values.sort((a, b) => a - b)
    return {
      median: values[Math.floor(values.length * .5)] ?? 0,
      p90: values[Math.floor(values.length * .9)] ?? 0,
      max: values.at(-1) ?? 0,
      mean: values.reduce((a, b) => a + b, 0) / values.length,
    }
  }
  let sorted = (entries: [string, number][]) =>
    Object.fromEntries(entries.sort((a, b) => b[1] - a[1]))
  let costs = [...sessions.values()].map((s) => ({
    ...s,
    context: quantiles(s.context),
  })).sort((a, b) => b.cost - a.cost)
  let operatorCosts = costs.filter((s) =>
    s.session === operator || s.parent === operator
  )
  let taskCosts = new Map<string, number>()
  for (let s of costs) {
    if (s.tasks.length === 1) {
      taskCosts.set(s.tasks[0], (taskCosts.get(s.tasks[0]) ?? 0) + s.cost)
    }
  }
  let report = {
    since,
    until,
    scanned,
    uniqueMessages: messages.size,
    duplicateRecords: duplicates,
    totalCost: sum(total),
    costs: sorted(Object.entries(total)),
    tokens,
    context: quantiles(contexts),
    models,
    effort,
    operator: {
      cost: operatorCosts.reduce((a, s) => a + s.cost, 0),
      own: operatorCosts.find((s) => s.session === operator)?.cost ?? 0,
      sessions: operatorCosts.length,
    },
    allocation: {
      inputCostCovered: coverageCost,
      estimate: sorted(Object.entries(allocation)),
    },
    taskCosts: sorted([...taskCosts]),
    sessions: costs,
    largestOutputs: [...outputs.values()].sort((a, b) => b.chars - a.chars)
      .slice(0, 20),
  }
  console.log(settings.json ? JSON.stringify(report, null, 2) : summary(report))
}
