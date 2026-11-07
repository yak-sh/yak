# @yaks/dom

`@yaks/dom` is a just-enough DOM for Preact to render against outside a browser.
Elements are plain objects; every mutation marks the tree dirty, and whoever
owns the screen repaints on the next microtask. A painter only reads the tree,
so the same kit-built app is one tree for each of them:

- @yaks/tui paints it to a terminal;
- @yaks/native paints it as native nodes a host (the iOS shell) draws with its
  own widgets.

```ts ignore
import { h, render } from 'preact'
import { install, onPaint } from '@yaks/dom'

let { root, free } = install()
onPaint(() => console.log(root.textContent))
render(h('p', null, 'hello'), root)
```

`install()` swaps `globalThis.document` for this one and returns the render root
with the restore, so a process that also holds a browser document keeps its own.
A click on a check box or radio flips it and fires `input` and `change`, and a
submit button's click submits its form, as in a browser. `onNavigate` says how a
pressed link is followed, and `place` records where a painter put each element,
which `getBoundingClientRect` and `checkVisibility` read.
