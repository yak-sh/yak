/**
 * @yaks/mail — a mail component domain for a yaks graph.
 *
 * This plugin contributes a `mail` component: a message with a sender, one or
 * more recipients, a subject, and a body — addressed, like any yaks component,
 * to an ENTITY. Because a letter is a component, it lives in the same graph as
 * the thing it is about, and a reply is just another entity that points back.
 *
 * The package owns the message vocabulary and the delivery seam: hand a `mail`
 * entity to a sender, and take an inbound message in as one. The transport
 * itself (an SMTP relay, a provider API) is supplied to that seam, not built
 * in. It plugs into {@link https://jsr.io/@yaks/graph | @yaks/graph} like any
 * other domain.
 *
 * @module
 */

import type { Eid, Plugin } from '@yaks/graph'

/** The `mail` component: one message. */
export type Mail = {
  /** the sender address */
  from: string
  /** the recipient addresses */
  to: string[]
  /** the subject line */
  subject: string
  /** the message body */
  body: string
  /** the entity this message is about, if any */
  about?: Eid
}

/** How a message leaves or arrives: the transport a host supplies. */
export type Transport = {
  /** send one composed message */
  send: (mail: Mail) => Promise<void>
}

/** The plugin that contributes the `mail` component and its delivery to a graph. */
export type plugin = (transport?: Transport) => Plugin
