// The Sessions switch reads and edits the follower's persisted home mute.
// A RAM graph exercises both the metadata route and remount recovery.
import '../browse/testing.ts'
import { signal } from '@preact/signals'
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { projectDoc } from '@yaks/project'
import { inspectIo } from '../browse/components/inspect.tsx'
import { mount } from '../browse/components/mount.ts'
import { until } from '../browse/testing.ts'
import { healDoc } from './vocab.ts'
import { AutoSpawn } from './control.tsx'
import { routes } from './routes.ts'

let vocab = loadVocab([kernelDoc, projectDoc, healDoc], [kernelKeywords])
let g = graph({ vocab, storage: ram(vocab) })
let project = '2c96905a-f566-44bb-88e4-ddf17a959d95'
let other = '6f6740b9-1a9b-4e69-b4c4-b56f072780a4'
await g.apply([
  { entity: { eid: project }, project: {}, nofix: {} },
  { entity: { eid: other }, project: {}, nofix: {} },
])
let route = routes({ graph: g }, { project, provider: 'openai' })[0]
let response = await route.handle(new Request('http://probe/heal/control'))
let control = await response.json()
let row = (await g.get([project]))[0]
let turn = signal(0)
let io = {
  ...inspectIo,
  ask: () => {
    turn.value
    return { home: { rows: [row], ready: true } }
  },
  apply: async (rows: Parameters<typeof g.apply>[0]) => {
    await g.apply(rows)
    row = (await g.get([project]))[0]
    turn.value++
  },
}
let drawn = mount(<AutoSpawn io={io} control={control} />)
let button = () => drawn.root.querySelector('button')!
let initially = button().getAttribute('aria-checked')
button().click()
await until(() => button().getAttribute('aria-checked') == 'true')
let enabled = !(await g.get([project]))[0].nofix
button().click()
await until(() => button().getAttribute('aria-checked') == 'false')
let disabled = !!(await g.get([project]))[0].nofix
let explanation = drawn.root.textContent ?? ''
drawn.free()
drawn = mount(<AutoSpawn io={io} control={control} />)
let restored = button().getAttribute('aria-checked')
drawn.free()
let otherMuted = !!(await g.get([other]))[0].nofix

test('the Sessions switch persists off/on and restores off after remount', () => {
  equal(control, { project, configured: true })
  equal(initially, 'false')
  equal(enabled, true)
  equal(disabled, true)
  equal(restored, 'false')
  equal(otherMuted, true)
  equal(explanation.includes('Existing sessions continue.'), true)
  equal(explanation.includes('pending tracker bugs start again'), true)
})
