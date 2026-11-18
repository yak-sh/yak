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
  get(
    key: string,
    options: { range: { offset: number; length: number } },
  ): Promise<
    { arrayBuffer(): Promise<ArrayBuffer> } | null
  >
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
  writeFile(
    path: string,
    content: string,
    options: { encoding: 'base64' },
  ): unknown
}

let quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
let live = (status: string) => status == 'running' || status == 'healthy'
let PART = 5 * 1024 * 1024
let HEAD = 'workbench:head'

export let filesystem = (
  box: Box,
  read: () => AsyncIterable<Uint8Array>,
  root = '/',
) => {
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
    write: async (offset: number, content: Uint8Array) => {
      await box.writeFile(
        `${root == '/' ? '' : root}/.yak-recovery/part`,
        content.toBase64(),
        { encoding: 'base64' },
      )
      await run('write', String(offset))
    },
  }
}

/** Rebatch byte streams for multipart storage without buffering an archive. */
export let chunks = async function* (
  source: AsyncIterable<Uint8Array>,
  size: number,
) {
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
  box: ReturnType<typeof filesystem>,
  state: State,
  bucket: Archive,
  id: string,
) => {
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
      for (let offset = 0; head && offset < head.size; offset += PART) {
        let object = await bucket.get(head.key, {
          range: { offset, length: Math.min(PART, head.size - offset) },
        })
        if (!object) throw new Error(`workbench snapshot missing: ${head.key}`)
        await box.write(offset, new Uint8Array(await object.arrayBuffer()))
      }
      if (head) await run('restore')
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
      let key = `workbench/${id}/${crypto.randomUUID()}`
      let upload = await bucket.createMultipartUpload(key + '.tar.gz')
      let parts = []
      let received = 0
      for await (let content of chunks(box.read(), PART)) {
        received += content.length
        parts.push(await upload.uploadPart(parts.length + 1, content))
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
          let page = await bucket.list({ prefix: `workbench/${id}/`, cursor })
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
