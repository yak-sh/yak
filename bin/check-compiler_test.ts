import { equal, test, throws } from '@yaks/testing'
import { compiler, GO } from './check-compiler.ts'

test('compiler hosts compile at once and retain both answers', async () => {
  let finish = Promise.withResolvers<void>()
  let calls: { args: string[]; env: Record<string, string> }[] = []
  let compile = compiler(async (args, env) => {
    calls.push({ args, env })
    await finish.promise
    return args[0]
  })
  let deno = compile(['deno']), workers = compile(['workers'])
  equal(calls, [{ args: ['deno'], env: GO }, { args: ['workers'], env: GO }])
  finish.resolve()
  equal(await Promise.all([deno, workers]), ['deno', 'workers'])
})

test('a failed native compilation leaves the other its answer and preserves the caller override', async () => {
  let calls: Record<string, string>[] = []
  let compile = compiler((args, env) => {
    calls.push(env)
    return args[0] == 'deno'
      ? Promise.reject(new Error('compiler stopped'))
      : Promise.resolve({ success: false, diagnostics: 'worker type error' })
  }, { GOMAXPROCS: '3', KEEP: 'yes' })
  let deno = compile(['deno']), workers = compile(['workers'])
  await throws(() => deno, /compiler stopped/)
  equal(await workers, { success: false, diagnostics: 'worker type error' })
  equal(calls, Array(2).fill({ ...GO, GOMAXPROCS: '3', KEEP: 'yes' }))
})
