/**
 * @yaks/yaml — reading declaration files: YAML as a value, and a markdown
 * file's frontmatter as a {@link https://jsr.io/@yaks/graph | bundle}.
 *
 * A vocabulary, a seed, a page of a guide, a tool's own description — each is a
 * declaration, and each is better as a file somebody can read and edit than as
 * a string inside a module. This package is the single entry point for all of
 * them:
 *
 * ```ts
 * import { front, read } from '@yaks/yaml'
 *
 * read('recipe:\n  serves: number\n') // { recipe: { serves: 'number' } }
 * front('---\ndoc:\n  title: Soup\n---\nStir.') // { meta, body: 'Stir.' }
 * ```
 *
 * ## Two calls, because there are two kinds of file
 * A `.yml` (or `.json` — see below) is one value: `read` parses it. A `.md` is
 * a bundle with a document under it: `front` splits the two and returns both.
 *
 * ## JSON keeps working, and needs no second function
 * Every JSON file is also a YAML file, so a loader written against `read` still
 * reads the `.json` files it always read, and gains `.yml` for nothing. No file
 * has to be converted, and YAML is simply the more legible of the two.
 *
 * ## Frontmatter is a bundle
 * `{entity: {eid}, <comp>: {…}}` — the same JSON structure `graph.apply()`
 * accepts. So the metadata about a page is written in the same vocabulary as
 * everything else in the graph, and a page's title is `doc.title` because a
 * page is a doc.
 *
 * A reference in that frontmatter names an entity by eid or by `$alias`, never
 * by a file path: nothing here resolves anything, and whoever applies the
 * bundle resolves its aliases the way every other write does.
 *
 * It imports no platform API, so the same loader runs on a server, in a
 * worker, and in a browser tab.
 *
 * @module
 */

export * from './yaml.ts'
