# @yaks/mail

A **mail** component domain for a [@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/mail
# or: npx jsr add @yaks/mail
```

## What goes here

This plugin contributes a `mail` component: a message with a sender, one or more
recipients, a subject, and a body — addressed, like any yaks component, to an
**entity**. Because a letter is a component, it lives in the same graph as the
thing it is about, and a reply is just another entity that points back.

```ts
import type { Mail } from '@yaks/mail'

let m: Mail = {
  from: 'ana@example.com',
  to: ['team@example.com'],
  subject: 'Ship it',
  body: 'Looks good to me.',
}
```

The package owns the message vocabulary and the delivery seam: hand a `mail`
entity to a sender, and take an inbound message in as one. The transport itself
(an SMTP relay, a provider API) is supplied to that seam, not built in.

## Where it sits

A domain plugin over [@yaks/graph](https://jsr.io/@yaks/graph); delivery reacts
to committed messages through [@yaks/effects](https://jsr.io/@yaks/effects).

## The interface

It exports the shape it satisfies: `Mail`, `Transport`, and the `plugin`
factory. The implementation lands with the package.
