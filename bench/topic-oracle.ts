// Query-driven oracle measurements keep the native session host in charge of
// execution. Questions, graph changes and complete transcripts are retained;
// answer and structure judgements belong in a separate grading packet.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { runs } from '@yaks/oracle/tools'
import { kindOf, ordered, seqOf, statusOf, textOf } from '@yaks/session'

export type TopicCase = {
  id: string
  text: string
  followups?: string[]
}
export type TopicHost = {
  query: (oracle: string, text: string) => Promise<string>
  send: (session: string, text: string) => Promise<unknown>
  idle: (session: string) => Promise<void>
  transcript: (session: string) => Promise<Bundle[]>
}
export type TopicState = {
  nodes: Bundle[]
  edges: Bundle[]
  contexts: Bundle[]
}
export let nativeTopics = (
  graph: Graph,
  host: Omit<TopicHost, 'query'>,
  actor: string,
  model?: string,
): TopicHost => ({
  ...host,
  query: async (oracle, text) => {
    let [row] = await runs().oracle_query({
      entity: { eid: crypto.randomUUID() },
      call: { args: { oracle, text, ...model ? { model } : {} } },
      $actor: { by: actor },
    }, graph)
    return row.entity.eid
  },
})

let part = (row: Bundle, name: string): Comp => (row[name] ?? {}) as Comp

// The experiment owns an isolated graph. Include unplaced topics as well as
// connected ones so a failed placement cannot disappear from the measurement.
let topicGraph = async (g: Graph, root: string) => {
  let [first] = await g.get([root], ['topic'])
  if (!first?.topic) return { nodes: [], edges: [] }
  let nodes = await g.read('.topic .limit=129')
  if (nodes.length > 128) throw new Error('Topic observation limit exceeded')
  let ids = nodes.map((row) => row.entity.eid)
  let held = new Set(ids)
  let joined = ids.join(',')
  let edges = ids.length
    ? await g.read(`(.edge.from=${joined}|.edge.to=${joined}) *`)
    : []
  return {
    nodes,
    edges: edges.filter((row) =>
      held.has(String(part(row, 'edge').from)) &&
      held.has(String(part(row, 'edge').to))
    ),
  }
}

/** oracle_read owns the retained context shape. Preserve its answer whole
 * rather than projecting one guessed arrangement of directional contexts. */
export let topicState = async (
  g: Graph,
  root: string,
): Promise<TopicState> => {
  let { nodes, edges } = await topicGraph(g, root)
  let retained = await Promise.all(nodes.map((row) =>
    runs().oracle_read({
      entity: { eid: crypto.randomUUID() },
      call: { args: { oracle: row.entity.eid } },
    }, g)
  ))
  return {
    nodes: retained.map((rows) => rows[0]),
    edges,
    contexts: retained.flatMap((rows) => rows.slice(1)),
  }
}

let dialogues = async (g: Graph, root: string) => {
  let { nodes } = await topicGraph(g, root)
  return nodes.length
    ? await g.read(
      `.oracle_dialogue.to=${nodes.map((row) => row.entity.eid).join(',')} *`,
    )
    : []
}

export let changedTopics = (before: TopicState, after: TopicState) => {
  let old = new Map(
    [...before.nodes, ...before.edges, ...before.contexts].map((
      row,
    ) => [row.entity.eid, row]),
  )
  let rows = [...after.nodes, ...after.edges, ...after.contexts]
  let live = new Set(rows.map((row) => row.entity.eid))
  return {
    added: rows.filter((row) => !old.has(row.entity.eid)),
    updated: rows.filter((row) =>
      old.has(row.entity.eid) &&
      JSON.stringify(old.get(row.entity.eid)) != JSON.stringify(row)
    ),
    removed: [...old.keys()].filter((eid) => !live.has(eid)),
  }
}

export let topicTotals = (entries: Bundle[]) => {
  let asks = entries.filter((row) => row.ask)
  let sum = (comp: string, prop: string) => {
    let values = asks.map((row) => part(row, comp)[prop])
    return values.length && values.every((v) => typeof v == 'number')
      ? values.reduce<number>((n, v) => n + Number(v), 0)
      : null
  }
  return {
    requests: asks.length,
    failures: entries.filter((row) => row.exception).length,
    inputTokens: sum('usage', 'input_tokens'),
    outputTokens: sum('usage', 'output_tokens'),
    cachedTokens: sum('usage', 'cached_tokens'),
    dollars: sum('cost', 'dollars'),
  }
}

export let topicAnswer = (rows: Bundle[]) => {
  let all = ordered(rows)
  if (statusOf(all) != 'settled') return null
  let inputs = all.filter((row) => kindOf(row) == 'input')
  let results = all.filter((row) => row.result)
  let boundary = Math.max(0, ...[...inputs, ...results].map(seqOf))
  let byId = new Map(all.map((row) => [row.entity.eid, row]))
  let answer = all.findLast((row) => {
    if (kindOf(row) != 'output' || row.reasoning || !textOf(row).trim()) {
      return false
    }
    let ask = byId.get(String(part(row, 'output').source))
    let through = ask && byId.get(String(part(ask, 'ask').through))
    return through && seqOf(through) >= boundary
  })
  return answer ? textOf(answer) : null
}

let settled = async (
  g: Graph,
  host: TopicHost,
  root: string,
  baseline: Set<string>,
) => {
  for (let pass = 0; pass < 128; pass++) {
    let rows = (await dialogues(g, root))
      .filter((row) => !baseline.has(row.entity.eid))
    let pending = []
    for (let row of rows) {
      let state = statusOf(await host.transcript(row.entity.eid))
      if (!['settled', 'failed', 'stopped'].includes(state)) pending.push(row)
    }
    if (!pending.length) return rows
    if (rows.length > 128) {
      throw new Error('Topic workload dialogue limit exceeded')
    }
    for (let row of pending) await host.idle(row.entity.eid)
  }
  throw new Error('Topic workload did not settle within its observation limit')
}

/** A host uses the ordinary oracle_query tool and native send/idle/transcript
 * doors. No model loop, credential lookup or parallel oracle engine lives here.
 * The caller owns an isolated graph and persists each returned observation.
 */
export let runTopics = async (options: {
  graph: Graph
  host: TopicHost
  root: string
  cases: TopicCase[]
  mode: 'scripted' | 'model'
  save: (observation: unknown) => Promise<void>
}) => {
  let { graph: g, host, root } = options
  let initial = await topicState(g, root)
  if (
    initial.nodes.length != 1 || initial.nodes[0].entity.eid != root ||
    !initial.nodes[0].topic || initial.edges.length
  ) throw new Error('Topic workload starts with one root topic and no children')
  if (
    !options.cases.length ||
    new Set(options.cases.map((c) => c.id)).size != options.cases.length ||
    options.cases.some((c) =>
      !c.id || !c.text.trim() || c.followups?.some((text) => !text.trim())
    )
  ) {
    throw new Error(
      'Topic workload needs distinct cases with nonempty questions',
    )
  }
  let existing = await dialogues(g, root)
  let baseline = new Set(existing.map((row) => row.entity.eid))
  let seen = new Set<string>()
  let previous = new Set<string>()
  let measured: Bundle[] = []
  let began = performance.now()
  let results = []
  for (let c of options.cases) {
    let turns = []
    let session: string | undefined
    for (let text of [c.text, ...c.followups ?? []]) {
      let before = await topicState(g, root)
      let started = performance.now()
      let error: string | null = null
      let answer: string | null = null
      let entries: Bundle[] = []
      try {
        if (session) await host.send(session, text)
        else session = await host.query(root, text)
        await host.idle(session)
        await settled(g, host, root, baseline)
        entries = await host.transcript(session)
        answer = topicAnswer(entries)
        if (answer == null) error = 'Native turn has no completed final answer'
      } catch (e) {
        error = String(e)
        if (session) entries = await host.transcript(session)
      }
      let receiving = (await dialogues(g, root))
        .filter((row) => !baseline.has(row.entity.eid))
      // Re-read receiving forks to include descendant research/routing work.
      let transcripts = await Promise.all(receiving.map(async (row) => ({
        session: row.entity.eid,
        entries: await host.transcript(row.entity.eid),
      })))
      let unfinished = transcripts.find((t) =>
        (t.session == session || !previous.has(t.session)) &&
        statusOf(t.entries) != 'settled'
      )
      if (unfinished) {
        error ??= `Native dialogue ${unfinished.session} is ${
          statusOf(unfinished.entries)
        }`
      }
      receiving.forEach((row) => previous.add(row.entity.eid))
      let fresh = [...entries, ...transcripts.flatMap((t) => t.entries)]
        .filter((row) => {
          if (seen.has(row.entity.eid)) return false
          seen.add(row.entity.eid)
          return true
        })
      measured.push(...fresh)
      let calls = fresh.filter((row) => row.call)
      let tools = await g.get(
        [...new Set(calls.map((row) => String(part(row, 'call').to)))],
        ['tool'],
      )
      let names = new Map(
        tools.map((row) => [row.entity.eid, String(part(row, 'tool').name)]),
      )
      let after = await topicState(g, root)
      turns.push({
        text,
        session,
        answer,
        error,
        before,
        after,
        changes: changedTopics(before, after),
        dialogues: receiving,
        transcripts,
        calls: calls.map((row) => ({
          name: names.get(String(part(row, 'call').to)),
          row,
        })),
        totals: topicTotals(fresh),
        wallMs: performance.now() - started,
      })
      await options.save({
        workload: 'query-grown-topic-oracles',
        mode: options.mode,
        initial,
        totals: topicTotals(measured),
        cases: [...results, { id: c.id, turns }],
        wallMs: performance.now() - began,
      })
      if (error) break
    }
    results.push({ id: c.id, turns })
  }
  return results
}
