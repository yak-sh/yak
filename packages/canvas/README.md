# @yaks/canvas

The **spatial-UI** component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph): the interface is itself data.

## Install

```sh
deno add jsr:@yaks/canvas
# or: npx jsr add @yaks/canvas
```

## What goes here

A yaks UI is data: the cards on screen, where they sit, and where each viewer is
looking are all entities wearing components. This plugin contributes that
vocabulary:

- a **`card`** — an entity placed on the canvas, in a chosen view;
- a **`pin`** — its position and size on the plane;
- a **`camera`** — a viewer's pan and zoom.

So a layout is stored, shared, queried, and undone exactly like the content it
frames. Keeping the interface in the graph is what lets a tool read and move it:
a card is a real entity, not a private view-model.

The package owns these components; rendering them is a client's job. It plugs
into [@yaks/graph](https://jsr.io/@yaks/graph) like any other domain.

## The interface

It exports the shape it satisfies: `Card`, `Pin`, `Camera`, and the `plugin`
factory. The implementation lands with the package.
