/** Bounded, file-at-a-time tree-sitter emitter and explicit edit identity map. */
import Parser from 'web-tree-sitter'
// Reach the grammar package through the import map even on an empty npm cache.
import 'tree-sitter-wasms/package.json' with { type: 'json' }
import { createRequire } from 'node:module'
import type { Bundle } from '@yaks/graph'

export type Node = {
  file: string
  parent: string | null
  ordinal: number
  kind: string
  start: number
  end: number
}
export type Emitted = { entity: { eid: string }; node: Node }
export type FileTree = {
  nodes: Emitted[]
  references: Bundle[]
  errors: number
}
let parsers = new Map<string, Parser>()

/** npm ships both runtime and grammar wasm; no lifecycle script or compiler. */
export async function init() {
  let require = createRequire(import.meta.url)
  await Parser.init({
    locateFile: () => require.resolve('web-tree-sitter/tree-sitter.wasm'),
  })
  for (let language of ['typescript', 'tsx', 'javascript']) {
    let parser = new Parser()
    parser.setLanguage(
      await Parser.Language.load(
        require.resolve(`tree-sitter-wasms/out/tree-sitter-${language}.wasm`),
      ),
    )
    parsers.set(language, parser)
  }
}

/** Offsets are UTF-8 bytes, not web-tree-sitter's UTF-16 string indexes. */
function byteOffsets(source: string) {
  let offsets = new Uint32Array(source.length + 1)
  let bytes = 0
  for (let i = 0; i < source.length;) {
    let cp = source.codePointAt(i)!
    offsets[i] = bytes
    let width = cp > 0xffff ? 2 : 1
    if (width == 2) offsets[i + 1] = bytes
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    i += width
    offsets[i] = bytes
  }
  return offsets
}

export function emit(file: string, source: string): FileTree {
  let language = /\.tsx$/.test(file)
    ? 'tsx'
    : /\.ts$/.test(file)
    ? 'typescript'
    : 'javascript'
  let tree = parsers.get(language)!.parse(source)
  let offsets = byteOffsets(source)
  let nodes: Emitted[] = []
  let identifiers = new Map<string, string[]>()
  let errors = 0
  let cursor = tree.walk()
  let parents: { eid: string; next: number }[] = []
  try {
    while (true) {
      let syntax = cursor.currentNode()
      let eid = `${file}#${nodes.length}`
      let parent = parents.at(-1)
      nodes.push({
        entity: { eid },
        node: {
          file,
          parent: parent?.eid ?? null,
          ordinal: parent ? parent.next++ : 0,
          kind: syntax.type,
          start: offsets[syntax.startIndex],
          end: offsets[syntax.endIndex],
        },
      })
      if (syntax.type == 'ERROR' || syntax.isMissing()) errors++
      if (syntax.type == 'identifier' || syntax.type == 'type_identifier') {
        let text = syntax.text
        let group = identifiers.get(text) ?? []
        group.push(eid)
        identifiers.set(text, group)
      }
      if (cursor.gotoFirstChild()) {
        parents.push({ eid, next: 0 })
        continue
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) {
          // Deliberately modest resolver: file-local same-spelling occurrences,
          // pointing to the first occurrence. Not lexical/TypeScript resolution.
          let references: Bundle[] = []
          for (let group of identifiers.values()) {
            for (let source of group.slice(1)) {
              references.push({
                entity: { eid: `ref:${source}` },
                reference: { source, target: group[0] },
              })
            }
          }
          return { nodes, references, errors }
        }
        parents.pop()
      }
    }
  } finally {
    cursor.delete()
    tree.delete()
  }
}

/** Replace a numeric literal by an expression, retaining unrelated subtree IDs.
 * Matching uses kind and transformed byte spans, never parser handles. Ancestors
 * spanning the replacement retain identity too; new syntax gets new IDs. */
export function edit(file: string, source: string, before: FileTree) {
  let literal = before.nodes.find((n) => n.node.kind == 'number')
  if (!literal) throw new Error(`no numeric literal in ${file}`)
  let { start, end } = literal.node
  let bytes = new TextEncoder().encode(source)
  let decode = new TextDecoder()
  let replacement = `(${decode.decode(bytes.slice(start, end))} + 1)`
  let changed = decode.decode(bytes.slice(0, start)) + replacement +
    decode.decode(bytes.slice(end))
  let after = emit(file, changed)
  let shift = new TextEncoder().encode(replacement).length - (end - start)
  let key = (n: Node) => `${n.kind}:${n.start}:${n.end}`
  let matches = new Map<string, string[]>()
  for (let row of before.nodes) {
    let n = row.node
    if (n.start >= start && n.end <= end) continue
    if (n.start < end && n.end > start && !(n.start <= start && n.end >= end)) {
      continue
    }
    let moved = {
      ...n,
      start: n.start >= end ? n.start + shift : n.start,
      end: n.end >= end ? n.end + shift : n.end,
    }
    let group = matches.get(key(moved)) ?? []
    group.push(row.entity.eid)
    matches.set(key(moved), group)
  }
  let ids = new Map<string, string>()
  for (let [i, row] of after.nodes.entries()) {
    ids.set(
      row.entity.eid,
      matches.get(key(row.node))?.shift() ?? `${file}#edit-${i}`,
    )
  }
  for (let row of after.nodes) {
    row.entity.eid = ids.get(row.entity.eid)!
    if (row.node.parent) row.node.parent = ids.get(row.node.parent)!
  }
  for (let row of after.references) {
    let ref = row.reference as { source: string; target: string }
    ref.source = ids.get(ref.source)!
    ref.target = ids.get(ref.target)!
    row.entity.eid = `ref:${ref.source}`
  }
  let old = new Map<string, Bundle>(
    [...before.nodes, ...before.references].map((r) => [r.entity.eid, r]),
  )
  let next = [...after.nodes, ...after.references]
  let live = new Set(next.map((r) => r.entity.eid))
  let writes: Bundle[] = next.filter((r) =>
    JSON.stringify(r) != JSON.stringify(old.get(r.entity.eid))
  )
  // Reference rows are removed before their sources. References use death:keep:
  // identity rows survive as tombstones, just as normal graph deletions do.
  let deletes = [...old.keys()].filter((id) => !live.has(id)).map((eid) => ({
    entity: { eid },
    $delete: true,
  }))
  return {
    after,
    changed,
    writes: [...writes, ...deletes],
    retained: next.length - writes.length,
  }
}
