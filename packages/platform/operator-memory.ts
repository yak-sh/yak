import type { Bundle, Comp, Graph, NamedTool } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import { token } from '@yaks/graph/guard'
import { line, sub } from '@yaks/query'
import type { Meta } from '@yaks/sqlite'

/** Where an Operator store keeps the cursor of its memory ownership pass. */
export let MEMORY_OWNERS = 'operator:memory-owners'

let ref = (row: Bundle | undefined, name: string, field: string) =>
  (row?.[name] as Comp | undefined)?.[field] as string | undefined

/** Bind the Operator's save to the person whose conversation is running: a
 * new memory is theirs unless shared is true, and a save naming an id moves
 * it between them and the space only when shared is given. */
export let memoryAudience = (tool: NamedTool, person: string): NamedTool => ({
  ...tool,
  description: tool.description +
    ' Each new save is private to the person in this conversation unless shared is true. With id, shared true or false moves that memory to the space or back to this person; leaving shared out keeps whom it is for.',
  inputSchema: {
    ...tool.inputSchema,
    properties: {
      ...tool.inputSchema?.properties as Record<string, unknown>,
      shared: {
        type: 'boolean',
        description:
          'Share with the space only if the person asks you to or it is plainly about the space itself. For words in a private entry, use said to save just the agreed words in a separate memory.',
      },
    },
  },
  run: async (call, graph) => {
    let asked = argsOf(call).shared
    let shared = asked === true
    let patches = await tool.run(call, graph)
    return await Promise.all(patches.map(async (patch) => {
      let eid = patch.entity.eid
      let [row] = eid.startsWith('$') ? [] : await graph.get([eid])
      if (!eid.startsWith('$') && !row) throw new Refused(`no memory: ${eid}`)
      if (shared && row?.owner && graph.vocab.kindOf(row) != 'memory') {
        throw new Refused(
          'Use said to save the shared words separately from their private source.',
        )
      }
      // A memory already kept for someone stays theirs or the space's when
      // the save leaves shared out: a patch of its context is no move.
      if (asked == null && row?.operator_memory) return patch
      return {
        ...patch,
        operator_memory: shared
          ? row?.operator_memory ? { person: null } : {}
          : { person },
        ...row && {
          $was: {
            operator_memory: { '': token(row.operator_memory) },
            owner: { '': token(row.owner) },
            ...patch.$was,
          },
        },
      }
    }))
  },
})

// Follow a save's session, including forks that only name their parent.
let conversations = (g: Graph) => {
  let read = new Map<string, Promise<Bundle[]>>()
  return async (eid?: string) => {
    let seen = new Set<string>()
    while (eid && !seen.has(eid)) {
      seen.add(eid)
      if (!read.has(eid)) {
        read.set(
          eid,
          Promise.resolve(g.get([eid], ['operator_session', 'spawned'])),
        )
      }
      let [row] = await read.get(eid)!
      let person = ref(row, 'operator_session', 'person')
      if (person) return person
      eid = ref(row, 'spawned', 'parent')
    }
  }
}

/** Recover the owner of one page of legacy memories from the session that
 * marked them, falling back to the session that created the words. */
export let memoryOwnerBackfill = async (
  { g, marks, waiting }: {
    g: Graph
    marks?: Pick<Meta, 'get' | 'set'>
    waiting?: () => number
  },
): Promise<boolean> => {
  let at = marks?.get(MEMORY_OWNERS)
  if (!marks || at == 'done') return false
  if (waiting?.()) return true
  let size = 50
  let rows = await g.read(
    line`.memory&!owner&!operator_memory${
      sub(at ? line`&.entity.eid>${at}` : line``)
    }&.order=entity.eid&.limit=${size}&.fields=entity.eid,memory.via,created.via`,
  )
  let personOf = conversations(g)
  let patches = await Promise.all(rows.map(async (row) => {
    let person = await personOf(ref(row, 'memory', 'via')) ??
      await personOf(ref(row, 'created', 'via'))
    return person
      ? [{
        entity: row.entity,
        operator_memory: { person },
        $was: { operator_memory: { '': null }, owner: { '': null } },
      }]
      : []
  }))
  if (waiting?.()) return true
  let writes = patches.flat()
  if (writes.length) await g.apply(writes, { trusted: true, stamp: false })
  let more = rows.length == size
  marks.set(MEMORY_OWNERS, more ? rows.at(-1)!.entity.eid : 'done')
  return more
}
