// The service and its integration are separate descriptions. They come from
// the integration's graph row, regardless of which provider connects it.
import { h } from 'preact'
import { Card } from '@yaks/ui/parts'
import type { Face } from './connections.ts'

let link = (face: Face, at: string | undefined, label: string) =>
  at && /^https:\/\/\S+$/.test(at)
    ? h('a', { href: at, rel: face.theirs ? 'nofollow ugc' : undefined }, label)
    : null

let paragraphs = (text?: string) =>
  text?.split(/\n\s*\n/).filter(Boolean).map((p) => h('p', null, p))

/** The links to the service's homepage and its integration docs. */
export let links = (face: Face) =>
  [
    link(face, face.site, 'Service homepage'),
    link(face, face.docs, 'Integration docs'),
  ].filter(Boolean)

/** What the service is: its line, its pitch and what the integration reaches. */
export let about = (face: Face) =>
  [
    face.tagline ? h(Card.Sub, null, face.tagline) : null,
    paragraphs(face.description),
    face.details
      ? h(
        'section',
        { 'aria-label': 'About this integration' },
        h('h4', null, 'About this integration'),
        paragraphs(face.details),
      )
      : null,
  ].flat().filter(Boolean)

/** How it connects: by signing in or with a key, directly or through a
 * broker. */
export let connects = (face: Face, keyed: boolean) => {
  let provider = face.broker
    ? face.broker.charAt(0).toUpperCase() + face.broker.slice(1)
    : null
  let how = face.connects == 'client'
    ? 'OAuth with your own client'
    : face.connects == 'key' || keyed
    ? face.fields.length > 1 ? 'Credentials' : 'API key'
    : 'OAuth'
  return `Connects with ${how}${
    provider ? ` through ${provider}` : ' directly'
  }.`
}

/** The service's pitch, integration access and limits, and the way it connects. */
export let detail = (face: Face, keyed: boolean) => {
  let to = links(face)
  return [
    about(face),
    h(Card.Sub, null, connects(face, keyed)),
    to.length
      ? h('p', null, to.flatMap((a, n) => [n ? ' · ' : null, a]))
      : null,
  ]
}
