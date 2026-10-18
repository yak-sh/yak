/** Stored local operations with populated fixtures and durable readback.
 * Preparation is outside the measured production command/handler boundary. */
import type { Graph } from '@yaks/graph'
import type { Operation } from './operation-commands.ts'
export type OperationContext = {
  graph: Graph
  dir: string
  PERSON: string
  PROJECT: string
  TARGET: string
  SESSION: string
  PERSONA: string
  fresh: (kind: string) => string
  saved: (q: string, mark: string) => Promise<void>
  includes: (text: string, mark: string) => void
}
export let LOCAL_FAMILIES = [
  'design-new',
  'design-decide',
  'effect-retry',
  'effect-drop',
  'claim-check',
  'session-check',
  'session-context',
  'session-brief',
  'session-wrap',
  'memory-source',
  'memory-around',
  'memory-target',
  'memory-thread',
  'memory-session',
  'hooks-install',
]
export let localOperations = async (
  c: OperationContext,
): Promise<Operation[]> => {
  let { graph, dir, PERSON, PROJECT, TARGET, SESSION, fresh, saved, includes } =
    c
  let design = crypto.randomUUID(), effect = crypto.randomUUID()
  let entries = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  let comment = crypto.randomUUID()
  let owned = crypto.randomUUID()
  await graph.apply([
    { entity: { eid: owned }, session: { id: 'owned-wrap-session' } },
    {
      entity: { eid: design },
      design: {},
      proposed: {},
      doc: { title: 'Operation decision' },
      filed: { project: PROJECT },
    },
    ...entries.map((eid, i) => ({
      entity: { eid },
      entry: { session: SESSION },
      content: { body: `Operation context ${i}` },
      $actor: { by: PERSON, via: SESSION },
    })),
    {
      entity: { eid: comment },
      comment: { target: TARGET },
      doc: {
        title: 'Operation thread comment',
        body: 'Operation source words',
      },
      $actor: { by: PERSON, via: SESSION },
    },
  ])
  let fail = async () => {
    effect = crypto.randomUUID()
    await graph.apply([{
      entity: { eid: effect },
      effect: {
        handler: 'session_release',
        target: TARGET,
        comp: 'task',
        kind: 'created',
        state: 'failed',
        attempts: 3,
        error: 'isolated failure',
        at: new Date().toISOString(),
        generation: 0,
      },
    }], { trusted: true })
  }
  return [
    {
      family: 'design-new',
      tool: 'design_new',
      command: ['design', 'new'],
      args: () => ({
        title: fresh('design'),
        body: 'Operation proposed design',
        project: PROJECT,
      }),
      verify: async (text, input) => {
        includes(text, String(input.title))
        await saved(`.design .doc.title="${input.title}" ?proposed`, 'proposed')
      },
    },
    {
      family: 'design-decide',
      tool: 'design_decide',
      command: ['design', 'decide'],
      prepare: async () => {
        await graph.apply([{ entity: { eid: design }, decided: null }])
      },
      args: () => ({ design, verdict: 'approved' }),
      verify: async (text) => {
        includes(text, 'approved')
        await saved(`.entity.eid=${design} ?decided`, 'approved')
      },
    },
    {
      family: 'effect-retry',
      tool: 'effect_retry',
      command: ['effect', 'retry'],
      prepare: fail,
      args: () => ({ of: effect }),
      verify: async (text) => {
        includes(text, 'retried 1')
        await saved(`.entity.eid=${effect} ?effect`, 'pending')
      },
    },
    {
      family: 'effect-drop',
      tool: 'effect_drop',
      command: ['effect', 'drop'],
      prepare: fail,
      args: () => ({ of: effect }),
      verify: async (text) => {
        includes(text, 'dropped 1')
        let [row] = await graph.get([effect])
        if (row?.effect) throw new Error('effect not dropped')
      },
    },
    {
      family: 'claim-check',
      tool: 'claim_check',
      command: ['claim', 'check'],
      prepare: async () => {
        await graph.apply([{
          entity: { eid: TARGET },
          claim: { session: SESSION },
        }])
      },
      args: () => ({}),
      verify: (text) => includes(text, 'no entity is locked'),
    },
    {
      family: 'session-check',
      tool: 'session_check',
      command: ['session', 'check'],
      args: () => ({}),
      verify: (text) => includes(text, 'no transcript has stalled'),
    },
    {
      family: 'session-context',
      tool: 'session_context',
      command: ['session', 'context'],
      args: () => ({ session: SESSION }),
      verify: (text) => includes(text, 'Operation target'),
    },
    {
      family: 'session-brief',
      tool: 'session_brief',
      command: ['session', 'brief'],
      args: () => ({ session: SESSION, text: fresh('session brief') }),
      verify: async (text, input) => {
        includes(text, String(input.text))
        await saved(`.entity.eid=${SESSION} ?brief`, String(input.text))
      },
    },
    {
      family: 'session-wrap',
      tool: 'session_wrap',
      command: ['session', 'wrap'],
      prepare: async () => {
        await graph.apply([{
          entity: { eid: owned },
          session: { ended: false },
        }, { entity: { eid: design }, claim: { session: owned } }])
      },
      args: () => ({ session: owned, brief: fresh('wrapped brief') }),
      verify: async (text, input) => {
        includes(text, 'ended')
        await saved(`.entity.eid=${owned} ?brief`, String(input.brief))
        let [row] = await graph.get([design])
        if (row.claim) throw new Error('wrap retained claim')
      },
    },
    {
      family: 'memory-source',
      tool: 'memory_source',
      command: ['memory', 'source'],
      args: () => ({ said: 'Operation source words', by: PERSON }),
      verify: (text) => includes(text, 'Operation thread comment'),
    },
    {
      family: 'memory-around',
      tool: 'memory_around',
      command: ['memory', 'around'],
      args: () => ({ id: entries[1], before: 1, after: 1 }),
      verify: (text) => {
        includes(text, 'Operation context 0')
        includes(text, 'Operation context 2')
      },
    },
    {
      family: 'memory-target',
      tool: 'memory_target',
      command: ['memory', 'target'],
      args: () => ({ id: comment }),
      verify: (text) => includes(text, 'Operation target'),
    },
    {
      family: 'memory-thread',
      tool: 'memory_thread',
      command: ['memory', 'thread'],
      args: () => ({ id: comment }),
      verify: (text) => {
        includes(text, 'Operation target')
        includes(text, 'Operation thread comment')
      },
    },
    {
      family: 'memory-session',
      tool: 'memory_session',
      command: ['memory', 'session'],
      args: () => ({ id: entries[1] }),
      verify: (text) => {
        includes(text, SESSION)
        includes(text, 'Operation target')
      },
    },
    {
      family: 'hooks-install',
      tool: 'hooks_install',
      command: ['hooks', 'install'],
      prepare: async () => {
        await Deno.writeTextFile(
          `${dir}/hooks.json`,
          JSON.stringify({ operationKeep: true }),
        )
      },
      args: () => ({
        path: `${dir}/hooks.json`,
        yak: '/isolated/yak',
        server: 'http://127.0.0.1:1',
      }),
      verify: async () => {
        let text = await Deno.readTextFile(`${dir}/hooks.json`)
        includes(text, 'operationKeep')
        includes(text, 'SessionStart')
        includes(text, '/isolated/yak')
      },
    },
  ]
}
