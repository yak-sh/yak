// Reading a declaration file. Two calls: YAML as a value, and a markdown
// file's frontmatter as a bundle with the document under it.
//
// JSON needs no second function — every JSON file is also a YAML file — so a
// loader written against `read` keeps its `.json` callers and gains `.yml` for
// free.
//
// An error names the FILE. A loader is usually reading a dozen of them and the
// parser only knows the text it was given, so the name is passed in and used in
// the one message that has to say which file was wrong.
import { parse } from '@std/yaml'
import type { Bundle } from '@yaks/graph'

// What an error message calls the language. A file named `.json` is JSON to
// whoever wrote it, whichever parser happens to read it — being told their JSON
// is not YAML would send them looking in the wrong place.
let lang = (file: string) => file.endsWith('.json') ? 'JSON' : 'YAML'

/**
 * YAML — and JSON, which the YAML parser also reads — as a value. `file` is the
 * name an error message uses for the text.
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

// Named placeholders in a passage of text. The other half of a translation
// file: the file holds the wording, and the code supplies the one or two values
// it could not know — which app, which person, which pages exist today.
let HOLE = /\{\{([\w-]+)\}\}/g

/**
 * `fill('Publish {{app}}', {app: 'recipes'})` — a placeholder with no value
 * given is left as it is, so a value the caller forgot shows up as the named
 * placeholder rather than as a gap in the text.
 */
export let fill = (text: string, slots: Record<string, string> = {}): string =>
  text.replace(HOLE, (had, name) => slots[name] ?? had)

/**
 * What a content file holds: the bundle at the top, and the document under it.
 *
 * `meta` is PARTIAL because two ordinary kinds of file have no `entity` in
 * them — one with no frontmatter at all (`{}`), and one whose frontmatter names
 * only components, which is a bundle whose identity has not been given yet.
 * Whether that is acceptable is the loader's decision, not this function's.
 */
export type Front = { meta: Partial<Bundle>; body: string }

// The frontmatter block, and everything after it. `---` on its own first line
// opens it and `---` on its own line closes it; anything else is a document
// that happens to start with a horizontal rule.
let BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * A markdown file, split: the frontmatter as a BUNDLE — `{entity: {eid},
 * <comp>: {…}}`, the same structure `graph.apply()` accepts — and the body
 * under it.
 *
 * ```ts
 * front('---\ndoc:\n  title: Hi\n---\n\nwords\n')
 * // { meta: { doc: { title: 'Hi' } }, body: 'words\n' }
 * ```
 *
 * A reference in that frontmatter names an entity by eid or by `$alias`, never
 * by a path, so nothing here resolves anything: what is returned is the bundle
 * as written, and whoever applies it resolves the aliases the way every other
 * write does.
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
