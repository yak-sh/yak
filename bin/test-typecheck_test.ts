import { equal, test } from '@yaks/testing'
import { join } from 'node:path'
import { typecheck } from './test-typecheck.ts'

let directory = await Deno.makeTempDir()
let first = join(directory, 'first')
let second = join(directory, 'second')
for (let root of [first, second]) {
  await Deno.mkdir(root)
  await Deno.writeTextFile(join(root, 'source.ts'), root)
}
let cache = join(directory, 'cache')
let check = { name: 'types', args: ['check', '--doc', 'source.ts'] }
let called: string[][] = []
let releases: (() => void)[] = []
let opened: (() => void)[] = []
let entered = [0, 1].map(() => new Promise<void>((go) => opened.push(go)))
let run = async (check: { args: string[] }) => {
  let index = called.length
  called.push(check.args)
  equal(await Deno.readTextFile(check.args.at(-1)!), [first, second][index])
  equal(await Deno.readTextFile(check.args.at(-2)!), 'export {}\n')
  opened[index]()
  await new Promise<void>((go) => releases.push(go))
  equal(await Deno.readTextFile(check.args.at(-1)!), [first, second][index])
  if (index == 0) throw Error('failed check')
  return true
}
let a = typecheck(check, run, { root: first, directory: cache })
  .then(() => '', (e: Error) => e.message)
await entered[0]
using probe = await Deno.open(join(cache, 'check-types.lock'), { write: true })
let whileFirst = await probe.tryLock(true)
let b = typecheck(check, run, { root: second, directory: cache })
releases[0]()
let failure = await a
await entered[1]
let whileSecond = await probe.tryLock(true)
releases[1]()
let success = await b
let released = await probe.tryLock(true)
await probe.unlock()
await Deno.remove(directory, { recursive: true })

test('type checks hold stable module URLs until completion and release a failed reader', () => {
  equal(whileFirst, false)
  equal(whileSecond, false)
  equal(released, true)
  equal(failure, 'failed check')
  equal(success, true)
  equal(called[0], called[1])
})
