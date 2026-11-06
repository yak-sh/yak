import { equal, test, throws } from '@yaks/testing'
import { incremental } from './check-incremental.ts'

// A build info naming `files`, as the compiler writes one.
let info = (...files: string[]) => JSON.stringify({ fileNames: files })

// A pool beside a project directory, and what each compile there saw and
// left; `pooled` lists the pool's build infos by the files they name.
let rig = () => {
  let root = Deno.makeTempDirSync()
  let dir = `${root}/project`, pool = `${root}/pool`
  let compile = (files: string[], next?: string, seen: string[] = []) =>
    incremental(dir, pool, async (path) => {
      seen.push(await Deno.readTextFile(path).catch(() => 'none'))
      if (next === undefined) throw new Error('interrupted')
      await Deno.writeTextFile(path, next)
      return { success: true }
    }, files)
  let pooled = () =>
    [...Deno.readDirSync(pool)].map((e) =>
      JSON.parse(Deno.readTextFileSync(`${pool}/${e.name}`)).fileNames.join()
    ).sort()
  let clean = () => Deno.removeSync(root, { recursive: true })
  return { dir, compile, pooled, clean }
}

test('a compile starts from the build info naming most of its files, and adds what it grew', async () => {
  let { compile, pooled, clean } = rig()
  try {
    let seen: string[] = []
    await compile(['a', 'b'], info('a', 'b'), seen)
    await compile(['x', 'y'], info('x', 'y'), seen)
    await compile(['a', 'b', 'c'], info('a', 'b', 'c'), seen)
    equal(seen, ['none', 'none', info('a', 'b')])
    equal(pooled(), ['a,b,c', 'x,y'])
  } finally {
    clean()
  }
})

test('a smaller program of the same files leaves the pool as it was', async () => {
  let { compile, pooled, clean } = rig()
  try {
    await compile(['a', 'b', 'c'], info('a', 'b', 'c'))
    await compile(['a'], info('a'))
    equal(pooled(), ['a,b,c'])
  } finally {
    clean()
  }
})

test('the pool keeps eight build infos, the newest among them, and an interrupted compile adds none', async () => {
  let { dir, compile, pooled, clean } = rig()
  try {
    for (let i = 0; i < 10; i++) await compile([`f${i}`], info(`f${i}`))
    await throws(() => compile(['z'], undefined), /interrupted/)
    equal([pooled().length, pooled().includes('f9')], [8, true])
    equal([...Deno.readDirSync(dir)], [])
  } finally {
    clean()
  }
})

test('concurrent compiles read private copies and each publishes whole', async () => {
  let { compile, pooled, clean } = rig()
  try {
    await compile(['a'], info('a'))
    let seen: string[] = []
    await Promise.all([
      compile(['a', 'b'], info('a', 'b'), seen),
      compile(['a', 'c'], info('a', 'c'), seen),
    ])
    equal(seen, [info('a'), info('a')])
    equal(pooled().length, 1)
    equal(['a,b', 'a,c'].includes(pooled()[0]), true)
  } finally {
    clean()
  }
})
