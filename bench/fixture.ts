/** Build a closed file fixture once, then give each collection a private copy.
 * Every collector admits its own seed, warming the product equally before its
 * discarded collection. Sharing an image across workers would skip that work. */
export let fixture = <T extends readonly unknown[]>(
  build: (path: string, ...args: T) => Promise<void>,
) => {
  let images = new Map<string, Promise<Uint8Array>>()
  return async (path: string, ...args: T): Promise<void> => {
    let key = JSON.stringify(args)
    let image = images.get(key)
    if (!image) {
      image = (async () => {
        let directory = await Deno.makeTempDir({ prefix: 'bench-fixture-' })
        let source = directory + '/seed.db'
        try {
          await build(source, ...args)
          return await Deno.readFile(source)
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
