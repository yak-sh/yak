// Axe results cross the browser boundary as data; every affected element
// stays available even when the chat report abbreviates a long result.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { audit, report } from './accessibility.ts'

let violation = (id: string, elements: string[]) => ({
  id,
  help: 'Give the element an accessible name',
  impact: 'critical',
  nodes: elements.map((html) => ({ html, target: ['#field'] })),
})

test('accessibility reports each affected element and separates manual review', async () => {
  let calls: string[] = []
  let result = await audit({
    evaluate: (source) => {
      calls.push(source)
      return Promise.resolve(
        calls.length == 1 ? undefined : {
          violations: [violation('label', ['<input id="field">', '<input>'])],
          incomplete: [
            violation('color-contrast', ['<p>Text on an image</p>']),
          ],
        },
      )
    },
  })
  assertEquals(result.problems.length, 2)
  assertEquals(result.problems[0], {
    rule: 'label',
    element: '<input id="field">',
    target: ['#field'],
    fix: 'Give the element an accessible name',
    impact: 'critical',
  })
  assertEquals(result.review[0].rule, 'color-contrast')
  assertStringIncludes(calls[0], 'axe.version')
  let text = report(result)
  assertStringIncludes(text, '2 problems; 1 elements need manual review')
  assertStringIncludes(text, 'label: ["#field"] <input id="field">')
  assertStringIncludes(text, 'Give the element an accessible name')
})

test('a long accessibility report keeps all findings as data and says what chat omits', async () => {
  let result = await audit({
    evaluate: (source) =>
      Promise.resolve(
        source.includes('axe.run(document')
          ? {
            violations: [violation('label', Array(40).fill('<input>'))],
            incomplete: [],
          }
          : undefined,
      ),
  })
  assertEquals(result.problems.length, 40)
  assertStringIncludes(
    report(result),
    '10 more problems in accessibility.problems',
  )
})
