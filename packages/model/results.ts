// Completed provider evidence is saved before accounting or transcript delivery.
import type { Graph } from '@yaks/graph'
import type { Mark, Reply } from './mod.ts'

export type ModelResult = { reply: Reply; mark?: Mark }
export type ModelResults = {
  read(call: string): Promise<ModelResult | undefined>
  save(call: string, result: ModelResult): Promise<void>
}

/** Keep completed answers with their original ask in its own graph. */
export let modelResults = (g: Pick<Graph, 'get' | 'apply'>): ModelResults => ({
  read: async (call) => {
    let [ask] = await g.get([call], ['model_result'])
    let body = (ask?.model_result as { body?: string } | undefined)?.body
    return body == null ? undefined : JSON.parse(body)
  },
  save: async (call, result) => {
    await g.apply([{
      entity: { eid: call },
      model_result: { body: JSON.stringify(result) },
    }], { trusted: true })
  },
})
