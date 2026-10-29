/** Build a closed file fixture once, then give each collection a private copy.
 * Paired workers sharing a private archive can share its immutable seed too. */
export let fixture = <T extends readonly unknown[]>(
  build: (path: string, ...args: T) => Promise<void>,
  name?: string,
) => {
  let images = new Map<string, Promise<Uint8Array>>()
  let shared = async (key: string): Promise<URL | undefined> => {
    if (!name) return
    let directory = new URL('../.git', import.meta.url)
    try {
      if (!(await Deno.stat(directory)).isDirectory) return
      if (
        !(await Deno.stat(new URL('../.git/bench-archive', import.meta.url)))
          .isFile
      ) {
        return
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return
      throw error
    }
    let hash = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(key),
      ),
    )
    let suffix = [...hash].map((n) => n.toString(16).padStart(2, '0')).join('')
    return new URL(
      `../.git/bench-fixtures/${name}-${suffix}.db`,
      import.meta.url,
    )
  }
  return async (path: string, ...args: T): Promise<void> => {
    let key = JSON.stringify(args)
    let image = images.get(key)
    if (!image) {
      image = (async () => {
        let kept = await shared(key)
        if (kept) {
          try {
            return await Deno.readFile(kept)
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error
          }
        }
        let directory = await Deno.makeTempDir({ prefix: 'bench-fixture-' })
        let source = directory + '/seed.db'
        try {
          await build(source, ...args)
          let bytes = await Deno.readFile(source)
          if (kept) {
            await Deno.mkdir(new URL('.', kept), { recursive: true })
            let pending = new URL(kept.href + '.' + crypto.randomUUID())
            await Deno.writeFile(pending, bytes)
            await Deno.rename(pending, kept)
          }
          return bytes
        } finally {
          await Deno.remove(directory, { recursive: true })
        }
      })()
      images.set(key, image)
      image.catch(() => images.delete(key))
    }
    await Deno.writeFile(path, await image)
  }
}
