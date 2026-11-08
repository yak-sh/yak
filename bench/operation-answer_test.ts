import { checked } from '@yaks/tools/check'
import { equal, test, throws } from '@yaks/testing'
import { cliAnswer } from './operation-answer.ts'

let operation = (noun: string, verb = 'check') => ({
  tool: `${noun}_${verb}`,
  command: [noun, verb],
})
let finding = JSON.stringify({
  result: checked('call', 'every governed entity is reachable from a project', [
    {
      level: 'fail',
      text: 'N-2 (persona) is under no project',
    },
  ]),
})

for (let noun of ['project', 'board', 'storage', 'archetype', 'effect']) {
  test(`${noun} check timing accepts a completed check with data findings`, () => {
    equal(cliAnswer(operation(noun), 1, finding), finding)
  })
}

test('a successful check response remains measurable', () => {
  let text = JSON.stringify({ result: checked('call', 'all is well', []) })
  equal(cliAnswer(operation('project'), 0, text), text)
})

test('a finding cannot hide a command failure or a refused call', async () => {
  await throws(() => cliAnswer(operation('project'), 2, finding))
  await throws(() => cliAnswer(operation('graph', 'query'), 1, finding))
  for (let comp of ['refusal', 'exception']) {
    let { result } = JSON.parse(finding)
    result.push({
      entity: { eid: 'error' },
      [comp]: {},
      content: { body: 'no' },
    })
    await throws(() =>
      cliAnswer(operation('project'), 1, JSON.stringify({ result }))
    )
  }
})

test('an incomplete or malformed failed response cannot earn a sample', async () => {
  for (let text of ['', 'not JSON', '{}', '{"result":[]}', '{"result":{}}']) {
    await throws(() => cliAnswer(operation('project'), 1, text, 'failed'))
  }
})
