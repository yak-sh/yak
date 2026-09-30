// Workers AI as an embedder: the binding answers many texts in one run.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { Refused } from './embedder.ts'
import { workersAi } from './workers-ai.ts'

// A stand-in binding: a vector per text, [length, 1, 0, 0], and every run it
// was asked for.
let binding = (fail?: string) => {
  let runs: unknown[] = []
  let ai = {
    run: (model: string, input: unknown) => {
      runs.push([model, input])
      if (fail) return Promise.reject(new Error(fail))
      let text = (input as { text: string[] }).text
      return Promise.resolve({ data: text.map((t) => [t.length, 1, 0, 0]) })
    },
  }
  return { ai, runs }
}

let round = (v: Float32Array) => [...v].map((x) => Math.round(x * 100) / 100)

test('texts asked together ride one run, cut to the width asked for', async () => {
  let { ai, runs } = binding()
  let e = workersAi({ model: '@cf/m', dim: 2, ai })
  let [a, b] = await Promise.all([e.embed('abc'), e.embed('abcd')])
  assertEquals([round(a), round(b)], [[0.95, 0.32], [0.97, 0.24]])
  assertEquals(runs, [['@cf/m', { text: ['abc', 'abcd'] }]])
  assertEquals(e.model, '@cf/m#2')
})

test('an input the model will not take is Refused; an outage is not', async () => {
  let refused = binding('AiError: 3010: Invalid input for the model')
  let down = binding('AiError: 3040: Capacity temporarily exceeded')
  let e = (ai: typeof down.ai) => workersAi({ model: 'm', ai })
  await assertRejects(() => e(refused.ai).embed('x'), Refused)
  let error = await assertRejects(() => e(down.ai).embed('x'))
  assertEquals(error instanceof Refused, false)
})
