import { mimeOf } from '@yaks/blob'
import { holding } from '@yaks/blob/stream'
import { CallError } from '@yaks/tools/errors'
import type { Page } from './browser-visit.ts'

export let MOCKUP_ORIGIN = 'https://browse-mockup.invalid'
export let MOCKUP_BYTES = 32 * 1024 * 1024
export let MOCKUP_FILES = 2048

export type MockupFile = { path: string; size: number }
export type MockupAssets = Map<string, Uint8Array>

export let assetPath = (path: string) =>
  path.startsWith('/') &&
  path.slice(1).split('/').every((part) =>
    part && !part.startsWith('.') && !/[\\\0]/.test(part)
  )

// Match URL paths against file names, including paths containing spaces or
// Unicode. Query strings can version an asset without changing its file.
export let mockupPath = (address: string): string | null => {
  try {
    let url = new URL(address)
    if (url.origin != MOCKUP_ORIGIN || url.username || url.password) return null
    let path = url.pathname.split('/').map((part) => {
      let name = decodeURIComponent(part)
      if (name.includes('/')) throw new Error('encoded path separator')
      return name
    }).join('/')
    return path.endsWith('/') ? path + 'index.html' : path
  } catch {
    return null
  }
}

export let mockupTooLarge = () =>
  new CallError(
    'mockup_too_large',
    `A mockup directory must fit in ${
      MOCKUP_BYTES / 1024 ** 2
    } MiB and ${MOCKUP_FILES} files.`,
  )

let invalid = () =>
  new CallError('mockup_files', 'The mockup upload has an invalid file list.')

export let mockupAssets = async (
  files: MockupFile[],
  size: number,
  body?: ReadableStream<Uint8Array>,
): Promise<MockupAssets> => {
  if (size > MOCKUP_BYTES || files?.length > MOCKUP_FILES) {
    throw mockupTooLarge()
  }
  if (!Array.isArray(files)) throw invalid()
  let paths = new Set<string>()
  let total = 0
  for (let file of files) {
    if (
      typeof file?.path != 'string' || !assetPath(file.path) ||
      paths.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0
    ) throw invalid()
    paths.add(file.path)
    total += file.size
  }
  if (size != total) throw invalid()
  let bytes = body
    ? await holding({ stream: body, size }, MOCKUP_BYTES)
    : new Uint8Array()
  if (!(bytes instanceof Uint8Array)) {
    await bytes.stream.cancel()
    throw mockupTooLarge()
  }
  if (bytes.length != size) throw invalid()
  let at = 0
  return new Map(files.map(({ path, size }) => {
    let bytesAt = bytes.subarray(at, at + size)
    at += size
    return [path, bytesAt]
  }))
}

export let serveMockup = (
  page: Page,
  files: MockupAssets,
  error: (e: unknown) => void,
) => {
  page.on('request', (asked) => {
    let address = asked.url()
    let went
    if (!address.startsWith(MOCKUP_ORIGIN + '/')) {
      went = asked.continue()
    } else {
      let path = mockupPath(address) ?? ''
      let body = files.get(path)
      went = asked.respond(
        body
          ? { status: 200, contentType: mimeOf(path), body }
          : { status: 404, contentType: 'text/plain', body: 'File not found' },
      )
    }
    went.catch(error)
  })
  return page.setRequestInterception(true)
}
