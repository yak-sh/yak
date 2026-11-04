/** Build a closed file fixture once, then give each collection a private copy.
 * Every collector admits its own seed, warming the product equally before its
 * discarded collection. Sharing an image across workers would skip that work.
 * A closed graph file keeps its WAL (@yaks/sqlite/db `open`), so the image is
 * the file and its WAL together. */
type Image = { db: Uint8Array; wal?: Uint8Array }

export let fixture = <T extends readonly unknown[]>(
  build: (path: string, ...args: T) => void | Promise<void>,
) => {
  let images = new Map<string, Promise<Image>>()
  return async (path: string, ...args: T): Promise<void> => {
    let key = JSON.stringify(args)
    let image = images.get(key)
    if (!image) {
      image = (async () => {
        let directory = await Deno.makeTempDir({ prefix: 'bench-fixture-' })
        let source = directory + '/seed.db'
        try {
          await build(source, ...args)
          return {
            db: await Deno.readFile(source),
            wal: await Deno.readFile(source + '-wal').catch(() => undefined),
          }
        } finally {
          await Deno.remove(directory, { recursive: true })
        }
      })()
      images.set(key, image)
      image.catch(() => images.delete(key))
    }
    let { db, wal } = await image
    await Deno.writeFile(path, db)
    if (wal) await Deno.writeFile(path + '-wal', wal)
  }
}
