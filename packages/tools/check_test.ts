// Check verdicts are measured data, not a failed tool execution.
import { equal, test } from '@yaks/testing'
import { ailing, checked } from './check.ts'

test('check answers carry measured severity without refusing their call', () => {
  let pass = checked('call', 'Graph is coherent', [])
  equal(ailing(pass), false)
  equal(pass[0].finding, undefined)
  let warn = checked('call', 'Graph is coherent', [
    { level: 'warn', text: 'Could not establish the verdict' },
  ])
  equal(warn[0].finding, { level: 'warn' })
  equal(ailing(warn), false)
  let fail = checked('call', 'Graph is coherent', [
    { level: 'warn', text: 'An incomplete measurement' },
    { level: 'fail', text: 'A violated contract' },
  ])
  equal(fail[0].finding, { level: 'fail' })
  equal(ailing(fail), true)
  equal(fail[0].output, { source: 'call' })
  equal(fail[0].refusal, undefined)
})
