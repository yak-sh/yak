# @yaks/native

`@yaks/native` paints the kits' Preact tree as plain native nodes. Preact
renders into @yaks/dom's in-memory DOM, as it does for a terminal, and `paint`
reads that tree into the kinds of node a native host draws with its own widgets:

- `box`: a flex box holding other nodes, pressable when the element takes a
  click;
- `text`: words in one text view, with nested styled runs (`b`, `a`, `code`, a
  `br`'s line break);
- `field`: an `input` or `textarea`, with the acts typing and submitting are and
  its `traits`, the keyboard its entry takes in React Native's `TextInput`
  terms: an email's, a number's or a password's from its `type` and `inputmode`,
  its return key from `enterkeyhint`, and whether submitting keeps the keyboard
  up (it does in a form with a submit button, so one entry follows another);
- `toggle`: a check box or radio, its label the words around it;
- `pick`: a `select`, its options and the act of choosing one;
- `drawing`: an `svg` (an icon, a chart), its shapes with their attributes and
  the look their classes give them;
- `image`: an `img`, its address and words;
- `web`: what only a browser draws (a canvas, a frame, a video), which a host
  shows as a notice that it is on the app's web page;
- a press on a `text` or `box`, which clicks the element, and submits its form
  when it is a submit button.

A tree that throws while it renders paints as a `web` notice saying what went
wrong, so a broken view never takes its host down. Every part of @yaks/ui's kit
paints as these nodes; embedded browser content paints as a `web` notice.

A closed `details` paints its `summary` alone, which a press opens, as a
browser's does.

The package imports no platform and holds no widget, so it runs and is tested
anywhere. The iOS shell (`native/kit.tsx` at the repository root) is the host
that turns each node into a React Native view.

```ts ignore
import { h } from 'preact'
import { look, mount } from '@yaks/native'

let unmount = mount(h(App, {}), look(colors), (node) => draw(node))
```

`mount(tree, look, drawn, { fell, follow })` renders the tree and calls `drawn`
with its painted nodes after every change, as a terminal repaints; `fell` hears
what a broken tree threw, and `follow` is given each pressed link no listener
took. The DOM is one per process, so one tree is mounted at a time.
`paint(element, look)` paints one element without mounting.

A node's style is its tag's defaults merged with the native style of each class
it wears, read from a `Look`. Words take the text style (colour, size, weight)
of the boxes around them, which a native box does not pass on by itself.
`@yaks/native/remote` is what a host outside a browser needs of the app itself:
`nativeOf(page, fetch)` is the view its front page names
(`<link rel="yaks-native" href="view.ts">`), `viewAt(url, carried, fetch)` loads
that module and what it imports by relative path, compiled from TypeScript, with
the host's own copies of the app's `"platform"` packages (`carried`) standing in
for them, and `store(api, fetch)` is the app's store over HTTP. The module's
default export is a component taking that `store`. The iOS shell and `yak open`
in a terminal (@yaks/browse) are its two hosts, each with its own `fetch`.

`look(colors, composition?)` is the native look over a theme's colours: the
tags' defaults, and each class's style, which every @yaks/ui part carries beside
its terminal `sheet` (`native`). The composition's kits and skin, @yaks/ui's own
by default, say which parts and how they are worn, so a white-labelled app
themes the look with data alone.
