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
}

let quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
let bytes = (base64: string) => Uint8Array.fromBase64(base64.trim())
let encoded = (value: Uint8Array) => value.toBase64()
let live = (status: string) => status == 'running' || status == 'healthy'
let PART = 5 * 1024 * 1024
let HEAD = 'workbench:head'

export let filesystem = (box: Box, root = '/') => {
  let run = async (mode: string, ...args: string[]) => {
    let result = await box.exec(
      `python3 -c ${quote(script)} ${
        [mode, root, ...args].map(quote).join(' ')
      }`,
    )
    if (result.exitCode) throw new Error(`workbench snapshot: ${result.stderr}`)
    return result.stdout.trim()
  }
  return { live: async () => live((await box.getState()).status), run }
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
        await run(
          'write',
          String(offset),
          encoded(new Uint8Array(await object.arrayBuffer())),
        )
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
      for (let offset = 0; offset < size; offset += PART) {
        let content = bytes(await run('read', String(offset), String(PART)))
        if (content.length != Math.min(PART, size - offset)) {
          throw new Error(
            'workbench snapshot is incomplete',
          )
        }
        parts.push(await upload.uploadPart(parts.length + 1, content))
      }
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
