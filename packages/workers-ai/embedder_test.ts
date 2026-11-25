// Workers AI as an embedder: the binding answers many texts in one run.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { Refused, retries, Unanswered } from '@yaks/embedding'
import { embedder as workersAi } from './embedder.ts'

retries.waits = [0, 0]

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
  assertEquals(
    (error as Error).message,
    '@yaks/embedding: workers-ai did not answer',
  )
  assertEquals((error as Unanswered).context, {
    model: 'm',
    texts: '1',
    tries: '3',
  })
  assertEquals([refused.runs.length, down.runs.length], [1, 3])
})

test('a text too big for the model is asked again as its opening half', async () => {
  let sent: number[] = []
  let ai = {
    run: (_: string, input: unknown) => {
      let [text] = (input as { text: string[] }).text
      sent.push(text.length)
      return text.length > 300
        ? Promise.reject(new Error('AiError: 3030: input too big'))
        : Promise.resolve({ data: [[1, 0]] })
    },
  }
  let v = await workersAi({ model: 'm', ai }).embed('x'.repeat(1000))
  assertEquals([round(v), sent], [[1, 0], [1000, 500, 250]])
})

test('an oversized input fits the model window before the first call', async () => {
  let { ai, runs } = binding()
  let embed = workersAi({ model: 'm', ai, context: 8192 })
  let text = '🚲'.repeat(7000)
  await embed.embed(text)
  let [[, input]] = runs as [string, { text: string[] }][]
  let sent = input.text[0]
  let fittedBytes = new TextEncoder().encode(sent).length
  assertEquals(runs.length, 1)
  assertEquals(sent, '🚲'.repeat(1843))
  assertEquals(fittedBytes < 8192, true)
})

test('a rejected batch isolates its texts and retries an oversized text once', async () => {
  let sent: number[][] = []
  let ai = {
    run: (_: string, input: unknown) => {
      let { text } = input as { text: string[] }
      let sizes = text.map((t) => t.length)
      sent.push(sizes)
      return text.length > 1 || sizes[0] > 100
        ? Promise.reject(new Error('AiError: 3030: input too big'))
        : Promise.resolve({ data: [[sizes[0], 1]] })
    },
  }
  let e = workersAi({ model: 'm', ai, context: 8192 })
  let [short, long] = await Promise.all([
    e.embed('Read title'),
    e.embed('x'.repeat(200)),
  ])
  assertEquals([Array.from(short), Array.from(long)], [[10, 1], [100, 1]])
  assertEquals(sent, [[10, 200], [10], [200], [100]])
  await assertRejects(() => e.embed('x'.repeat(3000)), Refused)
  assertEquals(sent.slice(-2), [[3000], [1500]])
})
