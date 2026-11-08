/** The operation corpus is admitted once; every measured collection gets a copy. */
import type { Graph } from '@yaks/graph'

let id = (n: number) => `b66dbec0-632c-4fe8-a5ed-${String(n).padStart(12, '0')}`
export let PERSON = id(1), PROJECT = id(2), TARGET = id(3), SESSION = id(4)
export let PERSONA = id(5), BOARD = id(6)

export let populate = async (
  graph: Graph,
  tasks: number,
): Promise<void> => {
  await graph.apply([
    {
      entity: { eid: PERSON },
      person: {},
      doc: { title: 'Operation person' },
    },
    {
      entity: { eid: PROJECT },
      project: {},
      doc: { title: 'Operation portfolio' },
    },
    {
      entity: { eid: SESSION },
      session: {
        id: 'benchmark-operation-session',
      },
    },
    {
      entity: { eid: PERSONA },
      persona: {},
      filed: { project: PROJECT },
      doc: {
        title: 'Operation persona',
        body: 'operation persona instructions',
      },
    },
    {
      entity: { eid: BOARD },
      board: { query: '.task !completed' },
      doc: { title: 'Operation board' },
    },
    ...Array.from({ length: tasks }, (_, i) => ({
      entity: { eid: i == 0 ? TARGET : crypto.randomUUID() },
      task: {},
      doc: {
        title: i == 0 ? 'Operation target' : `Operation task ${i}`,
        body: 'A populated independent-operation fixture.',
      },
      filed: { project: PROJECT },
    })),
  ])
  // The history read is populated, not the fast empty-log path.
  for (let i = 0; i < 40; i++) {
    await graph.apply([{
      entity: { eid: TARGET },
      doc: { body: `History revision ${i}` },
    }])
  }
}
