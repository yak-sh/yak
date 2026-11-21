// Completed provider evidence is saved before accounting or transcript delivery.
import type { Graph } from '@yaks/graph'
import type { Mark, Reply } from './mod.ts'
import type { Price } from './vocab.ts'

export type ModelResult = { reply: Reply; mark?: Mark }
export type Acknowledgement = {
  provider: string
  mark: Mark
  tariff?: Price
  requestedAt: number
}

export type ModelResults = {
  read(call: string): Promise<ModelResult | undefined>
  save(call: string, result: ModelResult): Promise<void>
  pending?(call: string): Promise<Acknowledgement | undefined>
  acknowledge?(call: string, evidence: Acknowledgement): Promise<void>
}

/** Keep completed answers with their original ask in its own graph. */
export let modelResults = (
  g: Pick<Graph, 'get' | 'apply'>,
): Required<ModelResults> => ({
  read: async (call) => {
    let [ask] = await g.get([call], ['model_result'])
    let body = (ask?.model_result as { body?: string } | undefined)?.body
    return body == null ? undefined : JSON.parse(body)
  },
  pending: async (call) => {
    let [ask] = await g.get([call], ['model_result'])
    let pending = (ask?.model_result as { pending?: string })?.pending
    return pending == null ? undefined : JSON.parse(pending)
  },
  acknowledge: async (call, evidence) => {
    await g.apply([{
      entity: { eid: call },
      model_result: { pending: JSON.stringify(evidence) },
    }], { trusted: true })
  },
  save: async (call, result) => {
    await g.apply([{
      entity: { eid: call },
      model_result: { body: JSON.stringify(result), pending: null },
    }], { trusted: true })
  },
})
