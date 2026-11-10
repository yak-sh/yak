import {
  compose,
  cover,
  type Draft,
  fragment,
  merge,
  type Read,
} from './composition.ts'
import { inspect, type Inspected, preflight } from './inspection.ts'
import { count, type Product } from './layout.ts'
import { DocumentInputError, supplied } from './document-errors.ts'
export { DocumentInputError } from './document-errors.ts'

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
  /** The page drawn as a PNG, and whether it carries colored ink. */
  preview(
    pdf: Uint8Array,
    page: number,
  ): Promise<{ image: Uint8Array; color: boolean }>
}
export type Preparation = {
  specification: Product
  draft: Draft
  parts: Artifact[]
  collated?: Artifact[]
  content?: number
  interior?: Artifact
  cover?: Artifact
  inspected?: { interior: Inspected[]; cover: Inspected[] }
  pages: Page[]
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
    let { image: bytesPage, color } = await io.preview(bytes, page.number)
    if (role == 'interior' && spec.coloring && color) {
      throw new DocumentInputError(
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

export let start = (spec: Product, draft: Draft): Preparation => {
  if (!!draft.interior != !!draft.cover) {
    throw new DocumentInputError('Upload both interior and cover PDFs')
  }
  if (!draft.interior && !!draft.markdown == !!draft.pages?.length) {
    throw new DocumentInputError('Choose Markdown or ordered page artwork')
  }
  if (!draft.interior && draft.pages?.length) {
    try {
      count(spec, draft.pages.length)
    } catch (error) {
      throw new DocumentInputError((error as Error).message)
    }
  }
  return {
    specification: structuredClone(spec),
    draft: structuredClone(draft),
    parts: [],
    pages: [],
  }
}

/** Each call completes one bounded stage. Only immutable artifact references
 * cross the checkpoint; no PDF document or decoded bitmap survives a step. */
export let advance = async (
  state: Preparation,
  io: DocumentIO,
): Promise<Preparation | Manifest> => {
  let spec = state.specification, draft = state.draft
  if (
    !state.interior && (!draft.pages?.length || draft.interior || draft.cover)
  ) {
    let output = await compose(spec, draft, io.read)
    let check = async () => {
      let interior = await inspect(output.interior),
        cover = await inspect(output.cover)
      preflight(spec, interior, cover)
      return { interior, cover }
    }
    let { interior, cover } = draft.interior
      ? await supplied(check)
      : await check()
    return {
      ...state,
      content: output.content ?? interior.length,
      interior: await artifact(io, output.interior, interior.length),
      cover: await artifact(io, output.cover, cover.length),
      inspected: { interior, cover },
    }
  }
  if (state.content == null && draft.pages?.length) {
    let offset = state.parts.reduce((n, part) => n + part.pages, 0)
    let pages = draft.pages.slice(offset, offset + 4)
    let bytes = await fragment(spec, { ...draft, pages }, io.read)
    await inspect(bytes)
    let parts = [...state.parts, await artifact(io, bytes, pages.length)]
    return {
      ...state,
      parts,
      ...offset + pages.length == draft.pages.length
        ? { content: draft.pages.length }
        : {},
    }
  }
  if (!state.interior) {
    let selected = state.parts.slice(0, 8)
    let final = state.parts.length == 1 && !state.collated?.length
    let bytes = await merge(
      spec,
      await Promise.all(selected.map((part) => io.read(part.blob))),
      final,
    )
    let pages = await inspect(bytes)
    let part = await artifact(io, bytes, pages.length)
    if (final) return { ...state, interior: part, parts: [] }
    let collated = [...state.collated ?? [], part],
      remaining = state.parts.slice(8)
    return remaining.length
      ? { ...state, parts: remaining, collated }
      : { ...state, parts: collated, collated: [] }
  }
  if (!state.cover) {
    let bytes = await cover(spec, draft, state.interior.pages, io.read)
    await inspect(bytes)
    return { ...state, cover: await artifact(io, bytes, 1) }
  }
  if (!state.inspected) {
    let interior = await inspect(await io.read(state.interior.blob)),
      cover = await inspect(await io.read(state.cover.blob))
    preflight(spec, interior, cover)
    return { ...state, inspected: { interior, cover } }
  }
  let count = state.inspected.interior.length + state.inspected.cover.length
  if (state.pages.length < count) {
    let pending = [
      ...state.inspected.interior.map((page) => ({
        page,
        role: 'interior' as const,
      })),
      ...state.inspected.cover.map((page) => ({
        page,
        role: 'cover' as const,
      })),
    ].slice(state.pages.length, state.pages.length + 4)
    let bytes = new Map<string, Uint8Array>(), pages: Page[] = []
    for (let { page, role } of pending) {
      let blob = state[role]!.blob
      if (!bytes.has(blob)) bytes.set(blob, await io.read(blob))
      pages.push(
        ...await previews(
          io,
          spec,
          bytes.get(blob)!,
          [page],
          role,
          state.content!,
        ),
      )
    }
    return { ...state, pages: [...state.pages, ...pages] }
  }
  let files = { interior: state.interior, cover: state.cover }
  return {
    revision: await digest({
      specification: spec,
      title: draft.title,
      interior: files.interior.hash,
      cover: files.cover.hash,
      pages: state.pages.map(({ blob: _blob, ...page }) => page),
    }),
    specification: spec,
    title: draft.title,
    ...files,
    pages: state.pages,
  }
}

/** In-process convenience; deployed callers persist between advance calls. */
export let prepare = async (
  spec: Product,
  draft: Draft,
  io: DocumentIO,
): Promise<Manifest> => {
  let state: Preparation | Manifest = start(spec, draft)
  while (!('revision' in state)) {
    state = await advance(state, io)
  }
  return state
}
