// Command discovery and the graph's vocabulary honor the same config selection.
import { equal, test } from '@yaks/testing'
import { derive } from './derive.ts'
import { words } from './words.ts'
import type { Config } from './config.ts'

let config = {
  plugins: [{ use: '@yaks/task', words: ['task', 'cancelled', 'task_new'] }],
}
let selected = await words(config)
let discovered = await derive(config)
let empty = await words({ plugins: [{ use: '@yaks/task', words: [] }] })
let full = await words({ plugins: ['@yaks/task'] })
let restricted = await derive({
  plugins: [{ use: '@yaks/task', facets: ['vocab'] }],
}, true)
let excluded: Config = {
  plugins: [{ use: '@yaks/task', facets: [], words: ['task'] }],
}
let absent = await words(excluded)
let undiscovered = await derive(excluded, true)

test('command discovery and graph declarations offer only chosen plugin tools', () => {
  let taskTools = (tools: { name: string }[]) =>
    tools.filter((t) => t.name.startsWith('task_')).map((t) => t.name)
  equal(taskTools(selected.tools()), ['task_new'])
  equal(taskTools(discovered.tools), ['task_new'])
  equal(discovered.owners.task_new, '@yaks/task')
  equal(discovered.owners.task_update, undefined)
})

test('an empty selection takes no plugin words and does not affect whole-facet consumers', () => {
  equal(empty.vocab.comp('task'), undefined)
  equal(selected.vocab.comp('blocked'), undefined)
  equal(!!selected.vocab.comp('task'), true)
  equal(!!full.vocab.comp('blocked'), true)
})

test('command discovery keeps selected words without offering excluded runtime facets', () => {
  equal(restricted.facets['@yaks/task'], ['vocab'])
  equal(restricted.tools.some((t) => t.name == 'task_new'), false)
  equal(restricted.controls, [{ plugin: '@yaks/task', value: null }])
  equal(absent.vocab.comp('task'), undefined)
  equal(undiscovered.vocabs, [{
    plugin: '@yaks/task',
    value: null,
    factories: false,
  }])
})
