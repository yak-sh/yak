/**
 * The parts a page connecting a service draws it with (the Connections page,
 * ./connections-view.ts, and the server's sign-in pages): its logo, what it
 * is and how it connects, how to get its key, the box the key is pasted in
 * (@yaks/connections' own) and the button that begins its sign-in. The
 * service and its integration are separate descriptions. They come from the
 * integration's graph row, regardless of which provider connects it.
 *
 * @module
 */
import { type ComponentChildren as Kids, h, type VNode } from 'preact'
import { jsxTemplate } from 'preact/jsx-runtime'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Logo } from '@yaks/ui/Logo'
import { More } from '@yaks/ui/More'
import type { Host } from './host.ts'
import { integrationLogo } from './routes.ts'
import type { Face } from './connections-page.ts'

/** The box a key is pasted in: @yaks/connections' own, wherever a person is
 * asked for a key. */
export { keyBox } from '@yaks/connections/form'

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

/** Markup we made ourselves (a service's instructions, drawn from its
 * Markdown) put into a tree as it is. Never what a person typed. */
export let raw = (html: string): VNode => jsxTemplate([html])

/** A service's logo at the head of its card, read from its integration's row
 * (./routes.ts `integrationLogo`); a neutral mark where it has none. */
export let logo = (
  f: { name: string; logo?: string; image?: string },
  env: Host = {},
) => h(Logo.Mark, { src: integrationLogo(f, env), class: 'Card_Mark' })

/** How a person gets a service's key, as its integration says, open while
 * the key is still wanted. The words are HTML drawn from its markdown. */
export let howTo = (f: Face, open: boolean) =>
  f.instructions
    ? h(
      More,
      { open },
      h(More.Summary, null, 'How to get the key'),
      h(More.Body, null, raw(f.instructions)),
    )
    : null

/** The button that begins a sign-in at `face`'s service, sending its form's
 * `do` as `act` where it names one, `quiet` where it is not the next step.
 * A sign-in through a broker (Nango) opens in a new tab, since the broker's
 * page never sends the person back here; the page is read again once they
 * come back to it. */
export let signingIn = (
  face: Pick<Face, 'broker'>,
  label: Kids,
  act?: string,
  quiet = false,
) =>
  h(Button, {
    mod: !quiet && 'go',
    type: 'submit',
    ...act ? { name: 'do', value: act } : {},
    ...face.broker ? { formtarget: '_blank' } : {},
  }, label)
