import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { ModelError } from '@yaks/model'
import { refusal } from './models.ts'

let FLASH = '@cf/zai-org/glm-5.3-flash'

test('./api/ai/run answers an input the model refuses as the caller’s, 400', () => {
  let schema = "5006: Error: oneOf at '/' not met, 0 matches"
  let [status, code, message] = refusal(
    new ModelError('bad_request', `${FLASH} refused this input: ${schema}`),
  )!
  assertEquals([status, code], [400, 'bad_request'])
  assert(message.includes(schema))
  assertEquals(refusal(new Error('upstream down')), null)
})
