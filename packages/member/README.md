# @yaks/member

The **access** component domain for a [@yaks/graph](https://jsr.io/@yaks/graph):
who belongs to a space, and who may reach a given app.

## Install

```sh
deno add jsr:@yaks/member
# or: npx jsr add @yaks/member
```

## What goes here

This plugin contributes two components:

- a **`membership`** places a person in a space — the roster that says which
  people exist to an app at all;
- a **`grant`** gives a member a level of access to a particular entity, so a
  space can hold apps its members reach differently.

Together they are the model an app consults to decide what a viewer may see and
change.

The package owns these components and the checks over them; it does **not**
authenticate anyone — establishing who a viewer _is_ happens upstream, and this
plugin decides what that identity may do.

## Where it sits

A domain plugin over [@yaks/graph](https://jsr.io/@yaks/graph).

## The interface

It exports the shape it satisfies: `Membership`, `Grant`, `Level`, and the
`plugin` factory. The implementation lands with the package.
