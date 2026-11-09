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

/** The service's pitch, integration access and limits, and the way it connects. */
export let detail = (face: Face, keyed: boolean) => {
  let provider = face.broker
    ? face.broker.charAt(0).toUpperCase() + face.broker.slice(1)
    : null
  let how = face.connects == 'client'
    ? 'OAuth with your own client'
    : face.connects == 'key' || keyed
    ? face.fields.length > 1 ? 'Credentials' : 'API key'
    : 'OAuth'
  let links = [
    link(face, face.site, 'Service homepage'),
    link(face, face.docs, 'Integration docs'),
  ].filter(Boolean)
  return [
    face.tagline ? h(Card.Sub, null, face.tagline) : null,
    paragraphs(face.description),
    face.details
      ? h(
        'section',
        { 'aria-label': 'About this integration' },
        h('h3', null, 'About this integration'),
        paragraphs(face.details),
      )
      : null,
    h(
      Card.Sub,
      null,
      `Connects with ${how}${provider ? ` through ${provider}` : ' directly'}.`,
    ),
    links.length
      ? h('p', null, links.flatMap((a, n) => [n ? ' · ' : null, a]))
      : null,
  ]
}
