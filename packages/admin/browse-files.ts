import * as fs from '@yaks/file/io'
import {
  assetPath,
  MOCKUP_BYTES,
  MOCKUP_FILES,
  MOCKUP_ORIGIN,
  type MockupFile,
  mockupPath,
  mockupTooLarge,
} from '@yaks/platform/browser-mockup'
import { HTML_BYTES, streamed } from '@yaks/platform/browser-wire'
import { CallError } from '@yaks/tools/errors'
import type { BrowseFile } from './api.ts'

let read = async function* (path: string, size: number) {
  using file = await fs.open(path)
  for (let left = size; left > 0;) {
    let chunk = new Uint8Array(Math.min(left, 64 * 1024))
    let n = await file.read(chunk)
    if (n == null) throw new Error(`The file changed while uploading: ${path}`)
    left -= n
    yield chunk.subarray(0, n)
  }
}

// A path that names nothing is the caller's to correct, as a scratch file
// whose checkout is gone, not a failure of the browse.
let stat = (path: string, refusal: CallError) =>
  fs.stat(path).catch((e) => {
    throw fs.isNotFound(e) ? refusal : e
  })

export let documentAt = async (path: string): Promise<BrowseFile> => {
  let refusal = new CallError('html_file', `No HTML file at ${path}.`)
  let { size, isFile } = await stat(path, refusal)
  if (!isFile) throw new CallError('html_file', 'Choose an HTML file.')
  if (size > HTML_BYTES) {
    throw new CallError(
      'html_too_large',
      `An HTML file must fit in ${HTML_BYTES / 1_000_000} MB.`,
    )
  }
  return () => ({
    size,
    body: size ? streamed(read(path, size)) : undefined,
  })
}

let pageError = () =>
  new CallError('mockup_page', 'Choose a page in the mockup directory.')

export let mockupAt = async (root: string, page: string) => {
  let url = URL.parse(page, MOCKUP_ORIGIN)?.href
  if (!url) throw pageError()
  let entry = mockupPath(url)
  if (!entry || !assetPath(entry)) throw pageError()
  let refusal = new CallError('mockup_directory', 'Choose a mockup directory.')
  if (!(await stat(root, refusal)).isDirectory) throw refusal
  let mockup: MockupFile[] = []
  let size = 0
  let walk = async (dir: string) => {
    for await (let item of fs.readDir(root + dir)) {
      let path = dir + '/' + item.name
      if (!assetPath(path)) continue
      if (item.isDirectory) await walk(path)
      if (!item.isFile) continue
      let file = await fs.lstat(root + path)
      if (!file.isFile) continue
      size += file.size
      if (size > MOCKUP_BYTES || mockup.length >= MOCKUP_FILES) {
        throw mockupTooLarge()
      }
      mockup.push({ path, size: file.size })
    }
  }
  await walk('')
  if (!mockup.some(({ path }) => path == entry)) throw pageError()
  let body = async function* () {
    for (let file of mockup) yield* read(root + file.path, file.size)
  }
  let upload: BrowseFile = () => ({
    size,
    body: size ? streamed(body()) : undefined,
  })
  return { url, mockup, upload }
}
