import { equal, test } from '@yaks/testing'
import { diagnostic } from './diagnostic.ts'
let esc = String.fromCharCode(27)
let stderr = 'fixture inventory\n' + esc + '[31merror' + esc +
  '[0m: Uncaught Refused: bundle 0 needs an entity\n  throw new Misfit(\n' +
  esc + '[31m ^' + esc + '[0m\n' +
  Array.from({ length: 20 }, (_, i) => ' at frame ' + i).join('\n') +
  '\noperation-controls failed (1)'
test('collector diagnostic keeps the causal refusal and strips terminal colour', () => {
  let said = diagnostic(stderr, 1)
  equal(
    said.startsWith('error: Uncaught Refused: bundle 0 needs an entity'),
    true,
  )
  equal(said.includes(esc), false)
  equal(diagnostic('', 124), 'exit 124')
})
