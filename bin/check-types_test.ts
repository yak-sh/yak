import { equal, test, throws } from '@yaks/testing'
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

test('generated source waits for readiness and makes outputs missing from its receipts', async () => {
  let called: string[][] = []
  let ready = Promise.withResolvers<readonly string[]>()
  let catalog = 'bin/compiler-packages.ts'
  let made = generate([catalog], (args) => {
    called.push(args)
    return Promise.resolve(true)
  }, ready.promise)
  await Promise.resolve()
  equal(called, [])
  ready.resolve([])
  equal(await made, true)
  equal(called, [['run', '--no-lock', '-A', catalog]])
})

test('readiness failures fail generated source preparation without starting a second generator', async () => {
  let called: string[][] = []
  await throws(() =>
    generate(['bin/compiler-packages.ts'], (args) => {
      called.push(args)
      return Promise.resolve(true)
    }, Promise.reject(new Error('asset failed'))), /asset failed/)
  equal(called, [])
})

test('source without generated imports does not wait for unrelated readiness', async () => {
  equal(
    await generate([], () => Promise.resolve(false), new Promise(() => {})),
    true,
  )
})
