import type { Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { statusComputed } from '@yaks/session/status'
import { attemptComputed } from '../../packages/session/attempt.ts'
import { executionComputed } from '@yaks/tools'
import { operatorGraph, operatorVocab } from './operator-store.ts'
import type { Model } from '@yaks/model'

// A test's Operator model, answered by whatever `answer` is when it is asked:
// one Operator per store, its script changed between requests.
export let operatorModel = (answer: Model) => {
  let name = 'test-model'
  let price = { input: 1, output: 0 }
  let model: Model = async (req) => {
    let reply = await answer(req)
    return {
      ...reply,
      usage: { input_tokens: (reply.cost ?? 0) * 1e6, output_tokens: 0 },
    }
  }
  return {
    name,
    price,
    model: Object.assign(model, {
      info: () => Promise.resolve({ name, price, context: 1000 }),
    }),
  }
}

/** Session decisions use the same graph composition over rows in memory. */
export let operatorMemory = (storage: Storage = ram(operatorVocab, {
  computed: { ...statusComputed, ...attemptComputed, ...executionComputed },
})) => ({ ...operatorGraph(storage, []), storage })
