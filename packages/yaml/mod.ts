/**
 * @yaks/yaml — the warm path for declaration files: YAML as a value, and a
 * markdown file's frontmatter as a {@link https://jsr.io/@yaks/graph | bundle}.
 *
 * A vocabulary, a seed, a page of a guide, the words a tool says about itself
 * — each is a DECLARATION, and each wants to be a file somebody can read and
 * edit rather than a string in a module. This package is the one door they all
 * come through:
 *
 * ```ts
 * import { front, read } from '@yaks/yaml'
 *
 * read('recipe:\n  serves: number\n')  // { recipe: { serves: 'number' } }
 * front(page)                          // { meta: <bundle>, body: <markdown> }
 * ```
 *
 * ## Two calls, because there are two files
 * A `.yml` (or `.json` — see below) is a value whole: `read`. A `.md` is a
 * bundle wearing a document: `front` splits the two and hands back both.
 *
 * ## JSON keeps working, and needs no second door
 * Every JSON file is a YAML file, so a loader written against `read` reads the
 * `.json` it always read and gains `.yml` for nothing. That is what makes YAML
 * the warm path rather than a second path: nothing is migrated, and the newer
 * spelling is simply the one that is also legible.
 *
 * ## Frontmatter is a bundle
 * `{entity: {eid}, <comp>: {…}}` — the same wire an apply takes. So the words
 * ABOUT a page are said in the same vocabulary as everything else in the
 * graph, and a page's title is `doc.title` because a page is a doc.
 *
 * A reference in there names an entity by an eid or by a `$alias`, never by a
 * file path: nothing here resolves anything, and whoever applies the bundle
 * resolves its aliases the way every other apply does.
 *
 * It imports no platform API, so the same loader runs on a server, in a
 * worker, and in a browser tab.
 *
 * @module
 */

export * from './yaml.ts'
