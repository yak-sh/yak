// Check verdicts are measured data, not a failed tool execution.
import { equal, test } from '@yaks/testing'
import { ailing, checked } from './check.ts'

let check = { verb: 'check' }

test('check answers carry measured severity without refusing their call', () => {
  let pass = checked('call', 'Graph is coherent', [])
  equal(ailing(check, pass), false)
  equal(pass[0].finding, undefined)
  let warn = checked('call', 'Graph is coherent', [
    { level: 'warn', text: 'Could not establish the verdict' },
  ])
  equal(warn[0].finding, { level: 'warn' })
  equal(ailing(check, warn), false)
  let fail = checked('call', 'Graph is coherent', [
    { level: 'warn', text: 'An incomplete measurement' },
    { level: 'fail', text: 'A violated contract' },
  ])
  equal(fail[0].finding, { level: 'fail' })
  equal(ailing(check, fail), true)
  equal(ailing({ verb: 'query' }, fail), false)
  equal(fail[0].output, { source: 'call' })
  equal(fail[0].refusal, undefined)
})
