import { equal, test, throws } from '@yaks/testing'
import { incremental } from './check-incremental.ts'

test('a completed compilation publishes build info and an interrupted one leaves it alone', async () => {
  let dir = Deno.makeTempDirSync()
  let saved = `${dir}/build.tsbuildinfo`
  try {
    await incremental(saved, async (info) => {
      await throws(() => Deno.readTextFileSync(info), /No such file/)
      await Deno.writeTextFile(info, 'first')
      return { success: true }
    })
    let result = await incremental(saved, async (info) => {
      equal(await Deno.readTextFile(info), 'first')
      await Deno.writeTextFile(info, 'diagnostics')
      return { success: false }
    })
    equal(result.success, false)
    await throws(() =>
      incremental(saved, async (info) => {
        equal(await Deno.readTextFile(info), 'diagnostics')
        await Deno.writeTextFile(info, 'failed')
        throw new Error('interrupted')
      }), 'interrupted')
    equal(await Deno.readTextFile(saved), 'diagnostics')
    equal([...Deno.readDirSync(dir)].map((e) => e.name), ['build.tsbuildinfo'])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('concurrent compilations read private snapshots and publish complete build info', async () => {
  let dir = Deno.makeTempDirSync()
  let saved = `${dir}/build.tsbuildinfo`
  Deno.writeTextFileSync(saved, 'prior')
  let first = Promise.withResolvers<void>()
  let second = Promise.withResolvers<void>()
  let started = Promise.withResolvers<void>()
  let paths: string[] = []
  let compile = (done: Promise<void>, next: string) =>
    incremental(saved, async (info) => {
      paths.push(info)
      equal(await Deno.readTextFile(info), 'prior')
      if (paths.length == 2) started.resolve()
      await done
      await Deno.writeTextFile(info, next)
      return { success: true }
    })
  try {
    let a = compile(first.promise, 'first')
    let b = compile(second.promise, 'second')
    await started.promise
    equal(new Set(paths).size, 2)
    equal(paths.map((p) => p.slice(0, p.lastIndexOf('/'))), [dir, dir])
    first.resolve()
    await a
    equal(await Deno.readTextFile(saved), 'first')
    second.resolve()
    await b
    equal(await Deno.readTextFile(saved), 'second')
    equal([...Deno.readDirSync(dir)].map((e) => e.name), ['build.tsbuildinfo'])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('a checkout with no build info starts from the shared one, and every compilation shares its next', async () => {
  let dir = Deno.makeTempDirSync()
  let saved = `${dir}/a/build.tsbuildinfo`
  let shared = `${dir}/shared/deno.tsbuildinfo`
  let compile = (seen: string, next: string) =>
    incremental(saved, async (info) => {
      equal(await Deno.readTextFile(info).catch(() => 'none'), seen)
      await Deno.writeTextFile(info, next)
      return { success: true }
    }, shared)
  try {
    await compile('none', 'first')
    equal(await Deno.readTextFile(shared), 'first')
    Deno.removeSync(saved)
    await compile('first', 'second')
    Deno.writeTextFileSync(shared, 'other checkout')
    await compile('second', 'third')
    equal(await Deno.readTextFile(saved), 'third')
    equal(await Deno.readTextFile(shared), 'third')
    equal([...Deno.readDirSync(`${dir}/shared`)].map((e) => e.name), [
      'deno.tsbuildinfo',
    ])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
