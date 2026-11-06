import { dirname } from 'node:path'

let absent = (e: unknown) => {
  if (!(e instanceof Deno.errors.NotFound)) throw e
}

/** Copies `from` to `to` through a private name, so a reader of `to` never
 * sees half of it. */
let publish = async (from: string, to: string) => {
  Deno.mkdirSync(dirname(to), { recursive: true })
  let own = `${to}.${Deno.pid}.${crypto.randomUUID()}`
  try {
    await Deno.copyFile(from, own)
    await Deno.rename(own, to)
  } finally {
    await Deno.remove(own).catch(absent)
  }
}

/** Give a compiler its last build info privately, and publish its next one
 * atomically. Concurrent checks may finish in either order: the compiler
 * validates the saved versions against the sources and options it reads.
 * A checkout with none starts from `shared`, the last one any checkout
 * published: build info names files relative to itself, so another
 * checkout's spares what the two hold alike. */
export let incremental = async <T>(
  saved: string,
  compile: (info: string) => Promise<T>,
  shared?: string,
): Promise<T> => {
  Deno.mkdirSync(dirname(saved), { recursive: true })
  let own = `${saved}.${Deno.pid}.${crypto.randomUUID()}`
  try {
    try {
      await Deno.copyFile(saved, own)
    } catch (e) {
      absent(e)
      if (shared) await Deno.copyFile(shared, own).catch(absent)
    }
    let result = await compile(own)
    try {
      if (shared) await publish(own, shared)
      await Deno.rename(own, saved)
    } catch (e) {
      absent(e)
    }
    return result
  } finally {
    await Deno.remove(own).catch(absent)
  }
}
