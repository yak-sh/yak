import { equal, test } from '@yaks/testing'
import { generate, MADE } from './check-types.ts'

test('source imports reuse complete readiness receipts and make the remaining outputs', async () => {
  let called: string[][] = []
  let run = (args: string[]) => {
    called.push(args)
    return Promise.resolve(true)
  }
  let catalog = 'bin/compiler-packages.ts',
    client = 'workers/yak/client-assets.ts'
  equal(await generate([catalog, client], run, MADE[catalog]), true)
  equal(called, [['run', '--no-lock', '-A', client]])
  called.length = 0
  equal(await generate([client], run, MADE[client].slice(0, 1)), true)
  equal(called, [['run', '--no-lock', '-A', client]])
})

test('standalone source preparation makes its imports and keeps generation failures', async () => {
  let called: string[][] = []
  let catalog = 'bin/compiler-packages.ts'
  equal(
    await generate([catalog], (args) => {
      called.push(args)
      return Promise.resolve(false)
    }),
    false,
  )
  equal(called, [['run', '--no-lock', '-A', catalog]])
})
