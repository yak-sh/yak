import type { Bundle, Comp, Graph } from '@yaks/graph'
import { human } from '@yaks/id'
import { line } from '@yaks/query'
import { asksOn, asksSaid, CLAIM } from '@yaks/session'

/** The current task spec and feedback, shared by new and continuing runs. */
export let briefs = async (
  graph: Graph,
  tasks: Bundle[],
): Promise<string[]> => {
  let on = await asksOn(graph, tasks.map((b) => b.entity.eid))
  return await Promise.all(tasks.map(async (task) => {
    let name = human(graph.vocab)(task)
    let doc = task.doc as Comp | undefined
    let asks = on.get(task.entity.eid) ?? []
    return [
      `The task is your spec. Read \`yak graph show ${name} --json\` for its current body.`,
      doc?.title,
      doc?.body,
      asks.length &&
      [
        'Asked of this work so far, oldest first. Later feedback can revise earlier requests.',
        ...await asksSaid(graph, asks),
      ].join('\n'),
      'Before you ship, reread the task and its feedback (\`yak session context\`). Check each requested outcome against the result, including behavior the work should carry forward.',
    ].filter(Boolean).join('\n\n')
  }))
}

export let continuing = async (
  graph: Graph,
  session: string,
): Promise<string[]> =>
  await briefs(
    graph,
    await graph.read(line`.${CLAIM}.session=${session}&.task&*`),
  )
