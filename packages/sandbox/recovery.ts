import { script } from './recovery-script.ts'

type Head = { key: string; size: number; at: string }
type State = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<unknown>
  delete(key: string): Promise<unknown>
}
type Archive = {
  createMultipartUpload(key: string): Promise<{
    uploadPart(part: number, bytes: Uint8Array): Promise<{
      partNumber: number
      etag: string
    }>
    complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>
  }>
  put(key: string, content: string): Promise<unknown>
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string }[]
    truncated: boolean
    cursor?: string
  }>
  delete(keys: string[]): Promise<unknown>
}
type Box = {
  getState(): Promise<{ status: string }>
  exec(command: string): Promise<{
    exitCode: number
    stdout: string
    stderr: string
  }>
}
type Filesystem = {
  live(): Promise<boolean>
  run(mode: string, ...args: string[]): Promise<string>
  read(): AsyncIterable<Uint8Array>
  restore(name: string, size: number): Promise<string>
}
type Recovery = {
  prepare(): Promise<void>
  save(): Promise<void>
  use<T>(act: () => Promise<T>): Promise<T>
  stop<T>(act: () => Promise<T>): Promise<T>
  purge(stop: () => Promise<unknown>): Promise<void>
  reset(): void
}

let quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
let live = (status: string) => status == 'running' || status == 'healthy'
export let RECOVERY_HOST = 'workbench-recovery.internal'
export let ARCHIVE_PATH = '/.yak-recovery/snapshot.tar.gz'
let prefix = (id: string) => `workbench/${id}/`
let archiveName = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.tar\.gz$/

type Download = {
  get(key: string): Promise<
    {
      body: ReadableStream<Uint8Array>
      size: number
    } | null
  >
}

/** A container can stream only its own archives through its outbound proxy. */
export let snapshot = async (
  bucket: Download,
  id: string,
  request: Request,
): Promise<Response> => {
  if (request.method != 'GET') return new Response(null, { status: 405 })
  let name = new URL(request.url).pathname.slice(1)
  if (!id || !archiveName.test(name)) return new Response(null, { status: 404 })
  let found = await bucket.get(prefix(id) + name)
  return found
    ? new Response(found.body, {
      headers: { 'Content-Length': String(found.size) },
    })
    : new Response(null, { status: 404 })
}

let PART = 5 * 1024 * 1024
// R2 answers a part it could not store with an internal error (10001) and
// asks for it again, so a part is sent up to three times before a save fails.
let TRIES = 3

let stored = async (
  upload: Awaited<ReturnType<Archive['createMultipartUpload']>>,
  part: number,
  bytes: Uint8Array,
) => {
  for (let tried = 1;; tried++) {
    try {
      return await upload.uploadPart(part, bytes)
    } catch (error) {
      if (tried >= TRIES) throw error
    }
  }
}
let HEAD = 'workbench:head'

export let filesystem = (
  box: Box,
  read: () => AsyncIterable<Uint8Array>,
  root = '/',
): Filesystem => {
  let run = async (mode: string, ...args: string[]) => {
    let result = await box.exec(
      `python3 -c ${quote(script)} ${
        [mode, root, ...args].map(quote).join(' ')
      }`,
    )
    if (result.exitCode) throw new Error(`workbench snapshot: ${result.stderr}`)
    return result.stdout.trim()
  }
  return {
    live: async () => live((await box.getState()).status),
    run,
    read,
    restore: (name: string, size: number) =>
      run('restore', `http://${RECOVERY_HOST}/${name}`, String(size)),
  }
}

/** Rebatch byte streams for multipart storage without buffering an archive. */
export let chunks = async function* (
  source: AsyncIterable<Uint8Array>,
  size: number,
): AsyncIterable<Uint8Array<ArrayBuffer>> {
  let buffer = new Uint8Array(size)
  let used = 0
  for await (let chunk of source) {
    for (let offset = 0; offset < chunk.length;) {
      let length = Math.min(size - used, chunk.length - offset)
      buffer.set(chunk.subarray(offset, offset + length), used)
      offset += length
      used += length
      if (used == size) {
        yield buffer
        buffer = new Uint8Array(size)
        used = 0
      }
    }
  }
  if (used) yield buffer.subarray(0, used)
}

/** Recoverable workbench files, independent of the container SDK. Immutable
 * archives and receipts have no expiry; the DO holds only the current head.
 * A failed archive or head write leaves the container running. */
export let recovery = (
  box: Filesystem,
  state: State,
  bucket: Archive,
  id: string,
): Recovery => {
  let { run } = box
  let prepared: Promise<void> | undefined
  let checkpoint: Promise<void> | undefined
  let tail = Promise.resolve()
  let locked = <T>(act: () => Promise<T>) => {
    let result = tail.then(act, act)
    tail = result.then(() => {}, () => {})
    return result
  }
  let prepare = () =>
    prepared ??= (async () => {
      let made = await run(await box.live() ? 'existing' : 'fresh')
      if (made != 'fresh') return
      let head = await state.get<Head>(HEAD)
      if (head) {
        let name = head.key.slice(prefix(id).length)
        if (!head.key.startsWith(prefix(id)) || !archiveName.test(name)) {
          throw new Error('workbench snapshot key is invalid')
        }
        let started = Date.now()
        let phases = await box.restore(name, head.size)
        console.info('workbench restored', {
          bytes: head.size,
          ms: Date.now() - started,
          phases,
        })
      }
      await run('ready')
    })().catch((error) => {
      prepared = undefined
      throw error
    })
  let save = () =>
    checkpoint ??= (async () => {
      if (!await box.live()) return
      await prepare()
      let size = Number(await run('save'))
      if (!Number.isSafeInteger(size) || size <= 0) {
        throw new Error(
          'workbench snapshot size is invalid',
        )
      }
      let key = prefix(id) + crypto.randomUUID()
      let upload = await bucket.createMultipartUpload(key + '.tar.gz')
      let parts = []
      let received = 0
      for await (let content of chunks(box.read(), PART)) {
        received += content.length
        parts.push(await stored(upload, parts.length + 1, content))
      }
      if (received != size) throw new Error('workbench snapshot is incomplete')
      await upload.complete(parts)
      let head = { key: key + '.tar.gz', size, at: new Date().toISOString() }
      await bucket.put(key + '.json', JSON.stringify(head))
      await state.put(HEAD, head)
    })().finally(() => {
      checkpoint = undefined
    })
  return {
    prepare,
    save,
    use: <T>(act: () => Promise<T>) =>
      locked(async () => {
        await prepare()
        return await act()
      }),
    stop: <T>(act: () => Promise<T>) =>
      locked(async () => {
        await save()
        let result = await act()
        prepared = undefined
        return result
      }),
    // The caller reaches this only after the person confirms their purge.
    // Stop first so no command can create unarchived state during removal.
    purge: (stop: () => Promise<unknown>) =>
      locked(async () => {
        await stop()
        let cursor: string | undefined
        do {
          let page = await bucket.list({ prefix: prefix(id), cursor })
          if (page.objects.length) {
            await bucket.delete(page.objects.map(({ key }) => key))
          }
          cursor = page.truncated ? page.cursor : undefined
        } while (cursor)
        await state.delete(HEAD)
        prepared = undefined
      }),
    reset: () => {
      prepared = undefined
    },
  }
}
