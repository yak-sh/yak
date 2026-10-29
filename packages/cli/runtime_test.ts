// Source paths follow a private runtime; data and other checkouts do not.
import { equal, test } from '@yaks/testing'
import { runtimePath, runtimeStack } from './runtime.ts'

test('a runtime remaps source paths without moving neighboring checkouts or data', () => {
  let path = (spec: string) =>
    runtimePath(spec, 'file:///src', 'file:///private')
  equal(
    path('file:///src/packages/tool/tools.ts'),
    'file:///private/packages/tool/tools.ts',
  )
  equal(path('file:///src-other/tool.ts'), 'file:///src-other/tool.ts')
  equal(path('file:///data/yak.db'), 'file:///data/yak.db')
  equal(path('@yaks/task'), '@yaks/task')
  equal(
    runtimeStack(
      'Error\n at file:///private/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
      'file:///src',
      'file:///private',
    ),
    'Error\n at file:///src/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
  )
  equal(
    runtimePath('file:///src/tool.ts', undefined, undefined),
    'file:///src/tool.ts',
  )
})

test('worker inspector launch binds only a local numeric port', async () => {
  let { inspector } = await import('./runtime.ts')
  equal(inspector('19285'), '--inspect=127.0.0.1:19285')
  equal(inspector('0'), '--inspect=127.0.0.1:0')
  for (let value of ['-1', '65536', '0.0.0.0:9229', '9229 --allow-all']) {
    let error = false
    try {
      inspector(value)
    } catch {
      error = true
    }
    equal(error, true)
  }
})
