// Oracle snapshots are ordinary graph entities. The engine's Maps are a
// working value; every completed or failed exchange is committed to the graph.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph/identity'
import { link } from '@yaks/edge'
import type { Item } from '@yaks/model'
import {
  growOracleTree,
  type OracleConversation,
  type OracleNode,
  type OracleTree,
} from './tree.ts'

export type Saved = { root: string; nodes: OracleNode[] }
let id = (tree: string, name: string) => derivedEid(`oracle|${tree}|${name}`)

export let treeBundles = async (
  tree: string,
  title: string,
  saved: Saved,
  conversations: OracleConversation[] = [],
  evidence: { id: string; at: string; words: string }[] = [],
  caller?: string,
): Promise<Bundle[]> => {
  let ids = new Map(
    await Promise.all(
      saved.nodes.map(async (n) =>
        [n.id, await id(tree, n.id)] as [string, string]
      ),
    ),
  )
  let callerId = caller ?? await id(tree, 'caller')
  let nodeId = (key: string) => {
    let found = ids.get(key)
    if (!found && key != 'caller') {
      throw new Error(`Unknown oracle sender: ${key}`)
    }
    return found ?? callerId
  }
  let rows: Bundle[] = [{
    entity: { eid: tree },
    doc: { title },
    oracle_tree: { root: nodeId(saved.root), evidence },
  }]
  if (!caller) {
    rows.push({
      entity: { eid: callerId },
      session: { ended: true },
      doc: { title: `${title}: caller` },
    })
  }
  for (let n of saved.nodes) {
    let last = n.revisions.at(-1)
    rows.push({
      entity: { eid: nodeId(n.id) },
      doc: { title: last?.advert.title ?? n.domain },
      session: { ended: true },
      oracle: {
        tree,
        key: n.id,
        domain: n.domain,
        advert: last?.advert ?? {},
        self: last?.self ?? '',
        shared: last?.shared ?? '',
        tools: n.tools,
        evidence: n.evidence,
        revisions: n.revisions,
      },
    })
    if (n.parent) {
      rows.push(
        await link(
          nodeId(n.id),
          'oracle_child',
          nodeId(n.parent),
          saved.nodes.find((p) => p.id == n.parent)?.children.indexOf(n.id),
        ),
      )
    }
  }
  for (let c of conversations) {
    let session = await id(tree, `conversation|${c.id}`)
    rows.push({
      entity: { eid: session },
      doc: {
        title: `Oracle conversation: ${
          c.items.find((i) => i.kind == 'user')?.text?.slice(0, 100) ?? c.id
        }`,
      },
      session: { ended: true },
      oracle_dialogue: {
        tree,
        from: nodeId(c.from),
        to: nodeId(c.to),
        revision: c.revision,
        turns: c.turns,
        declined: c.declined,
        finished: c.finished,
      },
    })
    rows.push(...await entries(session, c.items))
  }
  return rows
}

let entries = async (session: string, items: Item[]): Promise<Bundle[]> => {
  let ask = await id(session, 'ask')
  let rows: Bundle[] = [{ entity: { eid: ask }, ask: {} }]
  let calls = new Map<string, string>()
  for (let [index, item] of items.entries()) {
    let eid = await id(session, String(index))
    let row: Bundle = { entity: { eid }, entry: { session, seq: index + 1 } }
    if (item.kind == 'call') {
      let tool = identityEid('tool', [item.name])
      rows.push({ entity: { eid: tool }, tool: { name: item.name } })
      let args: unknown
      try {
        args = JSON.parse(item.args)
      } catch {
        args = { text: item.args }
      }
      row.call = { id: item.id, to: tool, args, source: ask }
      row.execution = { by: session }
      row.content = { body: item.args }
      calls.set(item.id, eid)
    } else if (item.kind == 'result') {
      row.result = { call: calls.get(item.id) }
      row.content = { body: item.output }
    } else if (item.kind != 'image') {
      if (item.kind == 'assistant') row.output = { source: ask }
      if (item.kind == 'instruction') {
        row.prompt = { scope: 'local', source: 'oracle' }
      }
      row.content = { body: item.text }
    }
    if (item.kind == 'image') {
      throw new Error('Oracle transcripts require text items')
    }
    rows.push(row)
  }
  for (let [call, eid] of calls) {
    if (!items.some((i) => i.kind == 'result' && i.id == call)) {
      rows.push({
        entity: { eid: await id(session, `unfinished|${call}`) },
        result: { call: eid },
        exception: {},
        content: {
          body: 'Oracle conversation ended before this tool returned.',
        },
      })
    }
  }
  return rows
}

export let loadTree = async (
  g: Pick<Graph, 'get' | 'read'>,
  tree: string,
): Promise<Saved> => {
  let [head] = await g.get([tree], ['oracle_tree'])
  if (!head?.oracle_tree) throw new Error('Oracle tree not found')
  let rows = await g.read(`.oracle.tree=${tree} *`)
  let edges = await g.read(
    `.oracle_child .edge.from.oracle.tree=${tree} * .order=edge.ord`,
  )
  let nodes = rows.map((row) => {
    let o = row.oracle as Comp
    let parent = (edges.find((e) =>
      (e.edge as Comp)?.from == row.entity.eid
    )?.edge as Comp | undefined)?.to
    return {
      id: String(o.key),
      domain: String(o.domain),
      ...(parent == null ? {} : {
        parent: String(
          (rows.find((r) =>
            r.entity.eid == parent
          )?.oracle as Comp)?.key,
        ),
      }),
      children: edges.filter((e) => (e.edge as Comp)?.to == row.entity.eid).map(
        (e) =>
          String(
            (rows.find((r) => r.entity.eid == (e.edge as Comp).from)
              ?.oracle as Comp)?.key,
          ),
      ),
      evidence: o.evidence,
      tools: o.tools,
      revisions: o.revisions,
    } as OracleNode
  })
  let root = rows.find((r) => r.entity.eid == (head.oracle_tree as Comp).root)
  if (!root) throw new Error('Oracle root missing')
  return { root: String((root.oracle as Comp).key), nodes }
}

export let graphTree = async (
  g: Pick<Graph, 'get' | 'read' | 'apply'>,
  options: Parameters<typeof growOracleTree>[0] & {
    tree: string
    title: string
    retained?: boolean
    caller?: string
  },
): Promise<OracleTree & { save: () => Promise<void> }> => {
  let { tree: eid, title, retained, caller, ...opts } = options
  let saved = retained ? await loadTree(g, eid) : opts.resume
  let [head] = retained ? await g.get([eid], ['oracle_tree']) : []
  let evidence = (head?.oracle_tree as Comp | undefined)?.evidence as {
    id: string
    at: string
    words: string
  }[] | undefined
  let rows = evidence?.map((e) => ({
    entity: { eid: e.id },
    created: { at: e.at },
    content: { body: e.words },
  })) ?? opts.rows
  let tree = await growOracleTree({ ...opts, rows, resume: saved })
  let save = async () => {
    await g.apply(
      await treeBundles(
        eid,
        title,
        { root: tree.root, nodes: [...tree.nodes.values()] },
        [...tree.conversations.values()],
        tree.evidence,
        caller,
      ),
    )
  }
  let wrap =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      try {
        return await fn(...args)
      } finally {
        await save()
      }
    }
  await save()
  return {
    ...tree,
    save,
    query: wrap(tree.query),
    converse: wrap(tree.converse),
    question: () => wrap(tree.question()),
  }
}
