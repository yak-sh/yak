# @yaks/yaml

The warm path for declaration files: YAML as a value, and a markdown file's
frontmatter as a bundle.

A vocabulary, a seed, a page of a guide, the words a tool says about itself —
each is a declaration, and each is better as a file somebody can read and edit
than as a string in a module. This is the one door they come through.

```ts
import { fill, front, read } from '@yaks/yaml'

read('recipe:\n  serves: number\n') // { recipe: { serves: 'number' } }
read('{"recipe": {"serves": "number"}}') // the same value
front(page) // { meta: <bundle>, body: <markdown> }
fill('Publish {{app}}', { app: 'recipes' }) // 'Publish recipes'
```

## Two calls, because there are two files

A `.yml` is a value whole: `read`. A `.md` is a bundle wearing a document:
`front` splits the two and hands back both. `fill` is the other half of a locale
— the file says the words, the code says the one or two things it could not
know.

## JSON keeps working, and needs no second door

Every JSON file is a YAML file, so a loader written against `read` reads the
`.json` it always read and gains `.yml` for nothing. Nothing is migrated, and
the newer spelling is simply the one that is also legible.

A refusal names the file, in the file's own language: a `.json` that will not
parse is not JSON, whatever the parser reading it happens to be.

## Frontmatter is a bundle

`{entity: {eid}, <comp>: {…}}` — the same wire an apply takes. The words about a
page are said in the same vocabulary as everything else in the graph, and a
page's title is `doc.title` because a page is a doc.

```yaml
---
entity: { eid: $store }
doc:
  title: The store, from a page
guide:
  slug: store
  brief: reading and writing from a page
---
```

A reference in there names an entity by an eid or by a `$alias`, never by a file
path: nothing here resolves anything, and whoever applies the bundle resolves
its aliases the way every other apply does.

It imports no platform API, so the same loader runs on a server, in a worker,
and in a browser tab.
