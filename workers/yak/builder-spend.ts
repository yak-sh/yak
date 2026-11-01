// A builder turn reserves the same dollars as every other model consumer.
import { affordable, charged, ModelError } from '@yaks/model'
import type { Answer, Ask, Model } from './builder.ts'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { reserved } from './model-spend.ts'

export let turn = async (
  env: Env,
  space: Space,
  model: Model,
  ask: Ask,
): Promise<Answer> => {
  let info = await model.info?.()
  let price = info?.price ?? model.price
  let input = info?.context ?? model.context
  let hold = await reserved(
    env,
    space,
    (remaining) =>
      model.quote
        ? model.quote(ask, remaining)
        : price && input != null
        ? affordable(price, input, remaining, ask.tokens)
        : null,
  )
  let submitted = false
  let answer: Answer
  try {
    answer = await model.ask({
      ...ask,
      tokens: hold.value.tokens,
      onSubmit: () => {
        if (submitted) {
          throw new ModelError(
            'submitted',
            'This turn already spent its reservation',
          )
        }
        submitted = true
        return Promise.resolve()
      },
    })
  } catch (error) {
    if (!submitted) {
      await hold.settle(0, false)
    }
    throw error
  }
  let usage = answer.usage
  let cost = charged(
    {
      cost: answer.cost,
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cached_tokens: usage.cached,
      },
    },
    price,
    hold.value.dollars,
  )
  await hold.settle(cost.dollars, cost.reported)
  return answer
}
