// Identities written into a vocabulary document, like a lockfile. Every word a
// vocab.json declares carries a `$id` (./namespace.ts): the document, each
// component, each component's properties and each kind. A word that has none
// is given one here, from the `mint` the caller passes, and the text keeps
// everything else as it was written, so the author commits the new ids with
// the word. Nobody writes a `$id` by hand, and nothing refuses a word without
// one: it is held by its label until the tools mint it.
//
// An `extends` entry is not a word of its own but the component it adds to,
// so it is given no `$id`; the properties it adds are words, and are. A kind
// of its own component's name is one word with the component, and shares its
// `$id`. Tools, rules and effects have no identities.

import type { KindDecl } from './kinds.ts'
import type { PropSchema, VocabDoc } from './types.ts'

let urn = (id: string) => `urn:uuid:${id}`

// The paths to every word in `doc` without a `$id`, each with the `$id` to
// give it.
let missing = (doc: VocabDoc, mint: () => string): [string[], string][] => {
  let out: [string[], string][] = []
  let give = (path: string[], schema: { $id?: string }) => {
    if (schema.$id != null) return schema.$id
    let $id = urn(mint())
    out.push([path, $id])
    return $id
  }
  give([], doc)
  let comps: Record<string, string> = {}
  for (
    let [name, def] of Object.entries(doc.$defs ?? {}) as [
      string,
      PropSchema,
    ][]
  ) {
    if (def.component !== true) continue
    if (def.extends !== true) comps[name] = give(['$defs', name], def)
    for (let [prop, schema] of Object.entries(def.properties ?? {})) {
      if (schema && typeof schema == 'object') {
        give(['$defs', name, 'properties', prop], schema)
      }
    }
  }
  for (
    let [name, kind] of Object.entries(doc.kinds ?? {}) as [
      string,
      KindDecl,
    ][]
  ) {
    let own = !kind.is || kind.is.length == 1 && kind.is[0] == name
    if (kind.$id != null) continue
    if (own && comps[name]) out.push([['kinds', name], comps[name]])
    else give(['kinds', name], kind)
  }
  return out
}

// Where each object in a JSON text opens: the offset of its `{`, by the path
// of keys and indexes that leads to it, as `JSON.stringify(path)`.
let opens = (text: string): Map<string, number> => {
  let at = new Map<string, number>()
  let stack: { path: string[]; key?: string; index?: number }[] = []
  let here = (): string[] => {
    let top = stack.at(-1)
    if (!top) return []
    return [...top.path, top.index != null ? String(top.index) : top.key!]
  }
  for (let i = 0; i < text.length; i++) {
    let c = text[i]
    if (c == '"') {
      let j = i + 1
      while (text[j] != '"') j += text[j] == '\\' ? 2 : 1
      let k = j + 1
      while (/\s/.test(text[k])) k++
      if (text[k] == ':') stack.at(-1)!.key = JSON.parse(text.slice(i, j + 1))
      i = j
    } else if (c == '{' || c == '[') {
      let path = here()
      if (c == '{') at.set(JSON.stringify(path), i)
      stack.push(c == '[' ? { path, index: 0 } : { path })
    } else if (c == '}' || c == ']') stack.pop()
    else if (c == ',' && stack.at(-1)?.index != null) stack.at(-1)!.index! += 1
  }
  return at
}

// The text to put after an object's `{` to make `$id` its first member, in the
// object's own layout: on a line of its own where the members are, inline
// where they share the brace's line.
let entry = (text: string, brace: number, $id: string): string => {
  let member = `"$id": ${JSON.stringify($id)}`
  let rest = text.slice(brace + 1)
  let next = rest.search(/\S/)
  if (rest[next] == '}') return ` ${member} `
  let gap = rest.slice(0, next)
  let line = gap.lastIndexOf('\n')
  return line < 0 ? ` ${member},` : `\n${gap.slice(line + 1)}${member},`
}

/** A vocab.json's text with a `$id` minted for every word that has none: the
 * document, its components, their properties and its kinds. Everything else
 * stays as written; a text with nothing to mint comes back unchanged.
 *
 * ```ts
 * import { minted } from '@yaks/vocab/minted'
 * import { equal } from '@yaks/testing'
 *
 * let n = 0
 * let mint = () => `00000000-0000-4000-8000-00000000000${n++}`
 * let doc = JSON.parse(minted('{ "$defs": { "pin": { "component": true } } }', mint))
 * equal(doc.$id, 'urn:uuid:00000000-0000-4000-8000-000000000000')
 * equal(doc.$defs.pin.$id, 'urn:uuid:00000000-0000-4000-8000-000000000001')
 * ```
 */
export let minted = (text: string, mint: () => string): string => {
  let give = missing(JSON.parse(text) as VocabDoc, mint)
  if (!give.length) return text
  let at = opens(text)
  let edits = give
    .map(([path, $id]) => [at.get(JSON.stringify(path))!, $id] as const)
    .sort(([a], [b]) => b - a)
  for (let [brace, $id] of edits) {
    text = text.slice(0, brace + 1) + entry(text, brace, $id) +
      text.slice(brace + 1)
  }
  return text
}
