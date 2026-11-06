// A compiler's build info holds what it last checked of each file of one
// program. Programs differ by change: a change to packages/sql reaches some
// 1,000 files, one to workers/yak 3,400. A store holding only the last
// program would hold whichever was checked last, and each change elsewhere
// would check thousands of files again (20-30 s of CPU). So a platform keeps
// a pool of them, shared by every checkout of the repository: a compile
// starts from the one holding most of its files, and adds what it learned
// where that keeps the most.

/** A build info in the pool, and the files it names, relative to itself. */
export type Held = { path: string; files: Set<string> }

/// best([{ path: 'a', files: new Set(['x']) }, { path: 'b', files: new Set(['x', 'y']) }], ['x', 'y', 'z'])?.path -> 'b'
/// best([{ path: 'a', files: new Set(['x']) }], ['y']) -> undefined
/** Of the build infos held (newest first), the one naming most of `files`,
 * or none naming any. */
export let best = (held: Held[], files: string[]): Held | undefined => {
  let score = (h: Held) => files.filter((f) => h.files.has(f)).length
  let top = held.reduce<Held | undefined>(
    (a, h) => !a || score(h) > score(a) ? h : a,
    undefined,
  )
  return top && score(top) ? top : undefined
}

/// placed(undefined, new Set(['x'])) -> 'new'
/// placed(undefined, new Set()) -> 'none'
/// placed({ path: 'a', files: new Set(['x', 'y']) }, new Set(['x', 'y', 'z'])) -> 'over'
/// placed({ path: 'a', files: new Set(['x', 'y', 'z']) }, new Set(['x'])) -> 'none'
/// placed({ path: 'a', files: new Set(['x', 'y']) }, new Set(['y', 'z'])) -> 'new'
/**
 * Where a compile's next build info goes, given the one it started from: over
 * that one when it names nearly everything that one did (it grew); nowhere
 * when it names nothing, or little that one did not (a smaller program of
 * the same files, whose few changed files a later compile checks again);
 * and otherwise beside the rest.
 */
export let placed = (
  from: Held | undefined,
  next: Set<string>,
  nearly = 0.95,
): 'over' | 'none' | 'new' => {
  if (!next.size) return 'none'
  if (!from) return 'new'
  let shared = [...next].filter((f) => from.files.has(f)).length
  if (shared >= nearly * from.files.size) return 'over'
  if (shared >= nearly * next.size) return 'none'
  return 'new'
}

let absent = (e: unknown) => {
  if (!(e instanceof Deno.errors.NotFound)) throw e
}

/** The files a build info names, or none when it is not one. */
let named = async (path: string): Promise<Set<string>> => {
  try {
    let { fileNames } = JSON.parse(await Deno.readTextFile(path))
    return new Set(Array.isArray(fileNames) ? fileNames : [])
  } catch {
    return new Set()
  }
}

/** Copies `from` to `to` through a private name, so a reader of `to` never
 * sees half of it. */
let publish = async (from: string, to: string) => {
  let own = `${to}.${Deno.pid}.${crypto.randomUUID()}`
  try {
    await Deno.copyFile(from, own)
    await Deno.rename(own, to)
  } finally {
    await Deno.remove(own).catch(absent)
  }
}

/**
 * Give a compiler, in `dir`, the build info of `pool` naming most of `files`
 * (relative to `dir`, as build info names them) privately, and add its next
 * one to the pool (`placed`) atomically, keeping the newest `keep`.
 * Concurrent compiles may finish in either order: the compiler validates the
 * saved versions against the sources and options it reads, and build info
 * names files relative to itself, so another checkout's spares what the two
 * hold alike. A compile that throws adds nothing.
 */
export let incremental = async <T>(
  dir: string,
  pool: string,
  compile: (info: string) => Promise<T>,
  files: string[] = [],
  keep = 8,
): Promise<T> => {
  Deno.mkdirSync(dir, { recursive: true })
  Deno.mkdirSync(pool, { recursive: true })
  let entries = [...Deno.readDirSync(pool)]
    .filter((e) => e.isFile && e.name.endsWith('.tsbuildinfo'))
    .map((e) => `${pool}/${e.name}`)
    .flatMap((path) => {
      try {
        return [{ path, at: Deno.statSync(path).mtime?.getTime() ?? 0 }]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.at - a.at)
  let held = await Promise.all(
    entries.map(async ({ path }) => ({ path, files: await named(path) })),
  )
  let from = best(held, files)
  let own = `${dir}/build.${Deno.pid}.${crypto.randomUUID()}.tsbuildinfo`
  try {
    if (from) await Deno.copyFile(from.path, own).catch(absent)
    let result = await compile(own)
    let where = placed(from, await named(own))
    try {
      if (where == 'over') await publish(own, from!.path)
      if (where == 'new') {
        await publish(own, `${pool}/${crypto.randomUUID()}.tsbuildinfo`)
        for (let { path } of entries.slice(keep - 1)) {
          await Deno.remove(path).catch(absent)
        }
      }
    } catch (e) {
      absent(e)
    }
    return result
  } finally {
    await Deno.remove(own).catch(absent)
  }
}
