import { equal, test, throws } from '@yaks/testing'
import { generate, MADE, programs } from './check-types.ts'

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

test('independent host programs start before unrelated generated imports are ready', async () => {
  let receipt = Promise.withResolvers<readonly string[]>()
  let checked: string[] = []
  let catalog = 'bin/compiler-packages.ts'
  let result = programs(
    [
      { made: [catalog], check: () => Promise.resolve(!!checked.push('deno')) },
      { made: [], check: () => Promise.resolve(!!checked.push('workers')) },
    ],
    () => Promise.resolve(true),
    receipt.promise,
  )
  await Promise.resolve()
  await Promise.resolve()
  equal(checked, ['workers'])
  receipt.resolve(MADE[catalog])
  equal(await result, true)
  equal(checked, ['workers', 'deno'])
})

test('hosts share generation and retain failures without blocking independent checks', async () => {
  let checked: string[] = [], generated: string[][] = []
  let catalog = 'bin/compiler-packages.ts'
  let result = await programs([
    { made: [catalog], check: () => Promise.resolve(!!checked.push('deno')) },
    {
      made: [catalog],
      check: () => Promise.resolve(!!checked.push('workers')),
    },
    { made: [], check: () => Promise.resolve(!!checked.push('independent')) },
  ], (args) => {
    generated.push(args)
    return Promise.resolve(false)
  })
  equal(result, false)
  equal(checked, ['independent'])
  equal(generated, [['run', '--no-lock', '-A', catalog]])
})
