// Reading a declaration file. Two calls: YAML as a value, and a markdown
// file's frontmatter as a bundle with the document under it.
//
// JSON needs no second door — every JSON file is a YAML file — so a loader
// written against `read` keeps its `.json` callers and gains `.yml` for free,
// which is what makes YAML the warm path rather than a second one.
//
// A refusal names the FILE. A loader is usually reading a dozen of them and
// the parser only knows the text it was handed, so the name is passed in and
// spent on the one sentence that has to say which file was wrong.
import { parse } from '@std/yaml'
import type { Bundle } from '@yaks/graph'

// What a refusal calls the language. A file spelled `.json` is JSON to
// whoever wrote it, whatever the parser reading it happens to be — being told
// their JSON is not YAML would send them looking in the wrong place.
let lang = (file: string) => file.endsWith('.json') ? 'JSON' : 'YAML'

/**
 * YAML — and JSON, which YAML reads — as a value. `file` is what a refusal
 * calls the text.
 *
 * ```ts
 * read('doc:\n  title: Lemon cake\n')  // { doc: { title: 'Lemon cake' } }
 * read('[{"doc": {"title": "Hi"}}]')   // [ { doc: { title: 'Hi' } } ]
 * ```
 */
export let read = (text: string, file = 'yaml'): unknown => {
  try {
    return parse(text)
  } catch (e) {
    throw new Error(`${file} is not ${lang(file)}: ${(e as Error).message}`)
  }
}

// A passage's named holes. The other half of a locale: a declaration file says
// the words, and the code says the one or two things it could not know — which
// app, which person, which pages there are today.
let HOLE = /\{\{([\w-]+)\}\}/g

/**
 * `fill('Publish {{app}}', {app: 'recipes'})` — a hole nothing is said for is
 * left standing, so a slot the caller forgot reads as the slot it is rather
 * than as an empty sentence.
 */
export let fill = (text: string, slots: Record<string, string> = {}) =>
  text.replace(HOLE, (had, name) => slots[name] ?? had)

/**
 * What a content file holds: the bundle at the top, and the document under it.
 *
 * `meta` is PARTIAL because two ordinary files have no `entity` in them — one
 * that carries no frontmatter at all (`{}`), and one whose frontmatter names
 * only components, which is a bundle nobody has said the identity of yet.
 * Whether that is allowed is the loader's question, not this door's.
 */
export type Front = { meta: Partial<Bundle>; body: string }

// The block, and everything after it. `---` on its own first line opens it and
// `---` on its own line closes it; anything else is a document that happens to
// start with a rule.
let BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * A markdown file, split: the frontmatter as a BUNDLE — `{entity: {eid},
 * <comp>: {…}}`, the same wire an apply takes — and the body under it.
 *
 * ```ts
 * front('---\ndoc:\n  title: Hi\n---\n\nwords\n')
 * // { meta: { doc: { title: 'Hi' } }, body: 'words\n' }
 * ```
 *
 * A reference in there names an entity by eid or by `$alias`, never by a path,
 * so nothing here resolves anything: what comes back is the bundle as written,
 * and whoever applies it resolves the aliases the way every other apply does.
 */
export let front = (text: string, file = 'file'): Front => {
  let hit = BLOCK.exec(text)
  if (!hit) return { meta: {}, body: text }
  let meta = read(hit[1], `${file} frontmatter`)
  if (meta == null) return { meta: {}, body: text.slice(hit[0].length) }
  if (typeof meta != 'object' || Array.isArray(meta)) {
    throw new Error(
      `${file} frontmatter is not a bundle — ` +
        '{entity: {eid: $a}, doc: {title: "…"}}',
    )
  }
  return { meta: meta as Bundle, body: text.slice(hit[0].length) }
}
