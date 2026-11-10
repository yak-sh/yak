import { compose, type Draft, type Read } from './composition.ts'
import { monochrome } from './artwork.ts'
import { inspect, type Inspected, preflight } from './inspection.ts'
import type { Product } from './layout.ts'

export type Artifact = { blob: string; hash: string; pages: number }
export type Page = Inspected & {
  role: 'interior' | 'cover'
  blob: string
  hash: string
  blank: boolean
}
export type Manifest = {
  revision: string
  specification: Product
  title: string
  interior: Artifact
  cover: Artifact
  pages: Page[]
}
export type DocumentIO = {
  read: Read
  put(bytes: Uint8Array, mime: string): Promise<string>
  preview(pdf: Uint8Array, page: number): Promise<Uint8Array>
}
export type { Draft, PageSource } from './composition.ts'
export type { Product } from './layout.ts'

export let hash = async (bytes: Uint8Array) => {
  let value = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(value)].map((n) => n.toString(16).padStart(2, '0'))
    .join('')
}
let digest = (value: unknown) =>
  hash(new TextEncoder().encode(JSON.stringify(value)))

let artifact = async (
  io: DocumentIO,
  bytes: Uint8Array,
  pages: number,
): Promise<Artifact> => ({
  blob: await io.put(bytes, 'application/pdf'),
  hash: await hash(bytes),
  pages,
})
let previews = async (
  io: DocumentIO,
  spec: Product,
  bytes: Uint8Array,
  inspected: Inspected[],
  role: Page['role'],
  content: number,
) => {
  let pages: Page[] = []
  // One composed page at a time: a book never holds every decoded bitmap.
  for (let page of inspected) {
    let bytesPage = await io.preview(bytes, page.number)
    if (role == 'interior' && spec.coloring && !monochrome(bytesPage)) {
      throw new Error(
        'Coloring interior page ' + page.number + ' contains colored ink',
      )
    }
    pages.push({
      ...page,
      role,
      blank: role == 'interior' && page.number > content,
      blob: await io.put(bytesPage, 'image/png'),
      hash: await hash(bytesPage),
    })
  }
  return pages
}

export let prepare = async (
  spec: Product,
  draft: Draft,
  io: DocumentIO,
): Promise<Manifest> => {
  let output = await compose(spec, draft, io.read)
  let interior = await inspect(output.interior),
    cover = await inspect(output.cover)
  preflight(spec, interior, cover)
  let pages = [
    ...await previews(
      io,
      spec,
      output.interior,
      interior,
      'interior',
      output.content ?? interior.length,
    ),
    ...await previews(io, spec, output.cover, cover, 'cover', 1),
  ]
  let files = {
    interior: await artifact(io, output.interior, interior.length),
    cover: await artifact(io, output.cover, cover.length),
  }
  let revision = await digest({
    specification: spec,
    title: draft.title,
    interior: files.interior.hash,
    cover: files.cover.hash,
    pages: pages.map(({ blob: _blob, ...page }) => page),
  })
  return {
    revision,
    specification: structuredClone(spec),
    title: draft.title,
    ...files,
    pages,
  }
}
