# @yaks/copy

An app's copy: the words its pages show, kept apart from the markup that shows
them. The copy lives in `copy.json` at the app's root as keyed snippets, and an
element names the snippet it shows by key. This package is pure logic and data:
it takes and returns strings and values, and reads no file and touches no page.

## The file

`copy.json` is a JSON object of snippets. A nested object reads as dotted keys,
so `hero.title` is `{"hero": {"title": "…"}}`, and a key written with its dots,
`{"hero.title": "…"}`, reads the same. A snippet's value is plain text.

```json
{
  "cost": {
    "note": "A space is your address, like %{yours}, with its apps, their data and the people you invite.",
    "limits": "Tax is included. Going over a limit never deletes your apps or data. %{plans}.",
    "plans": "Compare plans and limits"
  }
}
```

The file is written one snippet per line, so a text merge of two edits works by
key: two people changing different snippets change different lines.

## Slots

A link, a bold word or a part inside a sentence is a named slot in the value,
`%{name}`, as Rails interpolates. The element's own child marked
`data-copy-slot="name"` fills it, and that child can carry a snippet of its own:
above, `%{plans}` is filled by the link, whose text is `cost.plans`. `%%{name}`
is the text `%{name}`, and a lone `%` is just a percent sign.

## An element's names

| attribute                  | names                                                   |
| -------------------------- | ------------------------------------------------------- |
| `data-copy="<key>"`        | the snippet that is the element's text                  |
| `data-copy-<attr>="<key>"` | the snippet that is its attribute `<attr>`'s value      |
| `data-copy-slot="<name>"`  | the slot of its parent's snippet that the element fills |

`<attr>` is any attribute whose value is words: `alt`, `placeholder`, `title`,
`aria-label`, a meta tag's `content`. `slot` is the one name taken.

```html
<p data-copy="cost.limits">
  <a href="/pricing" data-copy-slot="plans" data-copy="cost.plans"></a>
</p>
<input data-copy-placeholder="search.hint">
```

## Calls

| call                    | what it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `parse(text, file?)`    | a file's text as its value; blank text is an empty file         |
| `read(copy, key)`       | the snippet at a key, or `undefined`                            |
| `keys(copy)`            | every snippet's key, in the file's order                        |
| `fill(value, values)`   | the snippet's parts in order: text, and each slot's given value |
| `slots(value)`          | the slots a snippet names                                       |
| `set(text, changes)`    | the file's text with keys set, its order and indentation kept   |
| `format(copy, indent?)` | a value as file text, one snippet per line                      |
| `marks(attributes)`     | the keys and slot an element's attributes name                  |
| `names`                 | the attribute names themselves                                  |

```ts
import { fill, parse, read, set } from '@yaks/copy'

let text = '{\n  "cost": {\n    "plans": "Compare plans and limits"\n  }\n}\n'
let copy = parse(text)
read(copy, 'cost.plans') // 'Compare plans and limits'
fill('Tax is included. %{plans}.', { plans: 'LINK' }) // ['Tax is included. ', 'LINK', '.']
set(text, { 'cost.free': 'Your first space is free.' })
// cost.free joins the cost object, after plans
```

`fill` takes any value for a slot, so a page passes its own child (a DOM node, a
JSX element) and places the parts it gets back. A slot given no value stays as
its `%{name}`, so a missing part shows by name rather than as a gap.

`set` keeps a key where it is. A new key goes at the end of the deepest object a
leading part of it names (`cost.free` into `cost`), or at the end of the file
when none does. A key that is a whole number (`"1"`) is read first in its
object, as JSON objects order them in JavaScript.
