# @yaks/native

`@yaks/native` paints the kits' Preact tree as plain native nodes. Preact
renders into @yaks/tui's in-memory DOM, as it does for a terminal, and `paint`
reads that tree into five kinds of node a native host draws with its own
widgets:

- `box`: a flex box holding other nodes, pressable when the element takes a
  click;
- `text`: words in one text view, with nested styled runs (`b`, `a`, `code`);
- `field`: an `input` or `textarea`, with the acts typing and submitting are;
- `toggle`: a check box or radio, its label the words around it;
- a press on a `text` or `box`, which clicks the element, and submits its form
  when it is a submit button.

The package imports no platform and holds no widget, so it runs and is tested
anywhere. The iOS shell (`native/kit.tsx` at the repository root) is the host
that turns each node into a React Native view.

```ts ignore
import { h } from 'preact'
import { look, mount } from '@yaks/native'

let unmount = mount(h(App, {}), look(colors), (node) => draw(node))
```

`mount(tree, look, drawn)` renders the tree and calls `drawn` with its painted
nodes after every change, as a terminal repaints. The DOM is one per process, so
one tree is mounted at a time. `paint(element, look)` paints one element without
mounting.

A node's style is its tag's defaults merged with the native style of each class
it wears, read from a `Look`. Words take the text style (colour, size, weight)
of the boxes around them, which a native box does not pass on by itself.
`look(colors)` is the native look of the @yaks/ui parts a first app wears, over
a theme's colours; each entry moves beside its part's terminal `sheet` in
@yaks/ui (T-148415).
