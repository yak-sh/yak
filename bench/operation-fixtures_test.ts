import { equal, test } from '@yaks/testing'
import { remainingFixtures } from './operation-fixtures.ts'
let controls: string[] = []
if (remainingFixtures(true, true)) controls.push('repository')
let remaining: string[] = []
if (remainingFixtures(true, false)) remaining.push('repository')
test('control collection never initializes the unrelated repository fixture', () => {
  equal(controls, [])
  equal(remaining, ['repository'])
})
