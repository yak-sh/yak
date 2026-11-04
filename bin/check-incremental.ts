import { dirname } from 'node:path'

/** Give a compiler its last build info privately, and publish its next one
 * atomically. Concurrent checks may finish in either order: the compiler
 * validates the saved versions against the sources and options it reads. */
export let incremental = async <T>(
  saved: string,
  compile: (info: string) => Promise<T>,
): Promise<T> => {
  Deno.mkdirSync(dirname(saved), { recursive: true })
  let own = `${saved}.${Deno.pid}.${crypto.randomUUID()}`
  try {
    try {
      await Deno.copyFile(saved, own)
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
    let result = await compile(own)
    try {
      await Deno.rename(own, saved)
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
    return result
  } finally {
    await Deno.remove(own).catch((e) => {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    })
  }
}
