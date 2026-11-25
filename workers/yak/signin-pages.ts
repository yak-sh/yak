// The identity door's pages (identity.ts): asking for an address and its
// code, an invitation's one click, connecting an agent, linking and handing
// off a sign-in, allowing an agent in and closing a space. Apart from pages.ts,
// so a page that only serves a space never compiles the sign-in's phone
// numbers or the connector's words (T-148886).
import { Button, Card, Field, Form, Rows } from '@yaks/ui/parts'
import { h } from 'preact'
import type { Face, Shown } from '@yaks/platform/connections-page'
import { tile } from './render/mod.ts'
import { shown } from '@yaks/phone'
import { CODE_NOTE, texted } from './signin.ts'
import { beginPath, type Offered } from './oidc.ts'
import { MANAGE, managePath } from '@yaks/platform/routes'
import { destination, type Preview } from './link-preview.ts'
import type { Copy } from './preview-route.ts'
import { apex, type Host, spaceHost, url } from '@yaks/platform/host'
import { INVITE, PITCH } from '@yaks/platform/names'
import { STARTER } from '@yaks/platform/plans'

import {
  about,
  heading,
  held,
  home,
  howTo,
  keyBox,
  logo,
  type Offer,
  page,
  run,
  said,
  send,
  signingIn,
  status,
} from './pages.ts'

// The path of an address, whole or bare; nothing, for one that is neither.
let pathOf = (href: string) => {
  try {
    return new URL(href, 'https://x').pathname
  } catch {
    return ''
  }
}

// What each card carries forward: the authorize request's own query string,
// so the code form lands back where it started, and the page the person was
// on before they were asked to sign in, so the code hands them back to it
// (T-32593). Whether that address is one to follow is the login door's to
// decide, never this page's.
let carried = (q: string | null, back?: string | null) => [
  held('q', q),
  held('return', back),
  back &&
    ['/connect', '/manage/connect', managePath('agents')].includes(
      pathOf(back),
    )
    ? run(
      'if (location.hash) document.currentScript.previousElementSibling.value += location.hash',
    )
    : null,
]

// The sign-in card's first line. When `back` is a page on a space, it names
// that address: somebody who tapped "sign in" on a friend's app reads where
// they are going, not a pitch for building apps. Only a host under the apex is
// named; any other address is the door's to judge, and the card says nothing.
let onSpace = (back: string | null, env: Host) => {
  let to = back && URL.canParse(back) ? new URL(back) : null
  return to?.hostname.endsWith(`.${apex(env)}`)
    ? `Sign in to continue to ${to.hostname + to.pathname.replace(/\/$/, '')}.`
    : null
}

let welcome = (back: string | null, env: Host) => onSpace(back, env) ?? PITCH

// A stranger on the way to a copy of a published app (install.ts) reads which
// app it is, its picture, and what the copy is: the sign-in is all that stands
// between them and it (T-2623).
let copying = (copy: Copy) => ({
  title: `Your own copy of ${copy.title}`,
  lead: `${
    copy.free ? 'Free, at' : 'At'
  } your own address, with your own data.`,
  picture: copy.image
    ? h(
      'figure',
      { class: 'Pictured' },
      h('img', {
        class: 'Pictured_Image',
        src: copy.image,
        alt: copy.title,
        width: 1200,
        height: 630,
      }),
    )
    : null,
})

// Ask for an address. `who` names the app asking, when one is (an authorize
// request signed out starts here, and the consent card follows), and `why` is the
// soft refusal, when there was one: a sign-in link that had already been used
// lands here, carrying whatever it was going to finish (identity.ts, T-34351).
//
// `texts` is whether a code can go by text (identity.ts `textable`): then the
// one box takes an email address or a US mobile number (T-136826), and what
// giving a number agrees to sits under it, where it is read before sending.
// The note stands aside once the box holds an address, so a person typing
// their email reads nothing about texts; without script it stays.
//
// `copy` is the published app `back` installs, when it is one (`copying`).
//
// `by` names whoever's invite link a stranger opened (referral.ts `linkOf`):
// the card says who invited them and what their own space starts with, and
// the code is kept on their browser (arrival.ts), so signing up here, in the
// home page's box or by a copy of an app credits that person.
export let askEmail = (at: {
  q?: string | null
  back?: string | null
  who?: string
  why?: string
  status?: number
  texts?: boolean
  preview?: Preview
  copy?: Copy
  providers?: Offered[]
  by?: string
}, env: Host = {}) => {
  let copy = at.copy && copying(at.copy)
  let invite = at.by == null ? null : inviteCard(at.by)
  return page(
    env,
    {
      title: invite?.title ?? copy?.title ?? 'Sign in or sign up',
      preview: at.preview ??
        destination(at.back ?? (at.q ? '/oauth/authorize' : null), env),
      lead: at.why ?? invite?.lead ?? copy?.lead ??
        welcome(at.back ?? null, env),
      status: at.status ?? 200,
    },
    copy?.picture,
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login' },
      carried(at.q ?? null, at.back),
      h(
        'p',
        null,
        at.who ? `${at.who} would like to use your apps. ` : '',
        `Enter your ${
          at.texts ? 'email or mobile number' : 'email'
        } to get a sign-in code.`,
        // A press of "Make your own copy" makes the copy as they come back
        // (install.ts); otherwise the install form asks for one press.
        at.copy?.pressed
          ? ' The code is the last step to your copy.'
          : copy
          ? " Once you're in, your copy is one press away."
          : '',
        // Where a person decides to sign up: what their first space starts
        // with (@yaks/platform/plans `STARTER`). An agent asking to be let
        // in is someone already deciding something else, and an invite's
        // lead has already said it.
        at.who || invite
          ? ''
          : ` Signing up is free, with $${STARTER} of building credit.`,
      ),
      at.texts
        ? [
          h(Field, {
            name: 'address',
            type: 'text',
            required: true,
            autofocus: true,
            autocomplete: 'email',
            autocapitalize: 'off',
            spellcheck: 'false',
            placeholder: 'you@example.com or 269-555-0142',
            'aria-label': 'Your email or mobile number',
            'aria-describedby': 'by-text',
          }),
          h(
            'p',
            { class: 'Note', id: 'by-text' },
            `${CODE_NOTE} Terms: `,
            h('a', { href: url(env, '/terms') }, 'yaks.app/terms'),
            ' Privacy: ',
            h('a', { href: url(env, '/privacy') }, 'yaks.app/privacy'),
          ),
          run(
            "{let n=document.currentScript.previousElementSibling,f=n.previousElementSibling,s=()=>n.hidden=f.value.includes('@');f.addEventListener('input',s);s()}",
          ),
        ]
        : h(Field, {
          name: 'address',
          type: 'email',
          required: true,
          autofocus: true,
          autocomplete: 'email',
          placeholder: 'you@example.com',
          'aria-label': 'Your email',
        }),
      send('Send me a code'),
    ),
    at.providers?.length
      ? [
        h('p', { class: 'Note' }, 'Or'),
        at.providers.map((p) =>
          h(
            'form',
            { class: 'Page_Form', method: 'post', action: beginPath(p.name) },
            carried(at.q ?? null, at.back),
            h(
              Button,
              { type: 'submit' },
              h('span', { dangerouslySetInnerHTML: { __html: p.logo } }),
              ` Continue with ${p.title}`,
            ),
          )
        ),
      ]
      : null,
    invite
      ? h(
        'p',
        { class: 'Note' },
        'Or ',
        h('a', { href: url(env, '/') }, 'start building on the home page'),
        '.',
      )
      : home(env),
  )
}

// What an invite link's card says (`askEmail`'s `by`): who invited them, and
// that the space is theirs, free, with its building credit.
let inviteCard = (by: string) => ({
  title: `${by || 'A friend'} invited you to yaks.app`,
  lead: 'Build, host and share web apps in a space of your own. ' +
    `It's free, with $${STARTER} of building credit.`,
})

// Ask for the code just sent, and nothing else (T-34236). Signing up is two
// steps and both are the address: give it, then prove it. What a person is
// called and where their apps live are theirs to set on their own space page,
// once they are standing on it — a question in front of the door is a step
// somebody has to get past to see anything at all. `why` is the soft refusal,
// when there was one. A code that expired while they looked for the letter, or
// one that never came, is answered by a second door to the same address: the
// first step again, without typing it again. A number was texted, and the
// card says so.
//
// `letter` is what became of the letter this card says was sent: why it
// never left and whether we were told, or null (M-16612). The card is answered before its letter goes
// (T-149702), so it is said at the card's end once known, everything above it
// shown and pressable meanwhile (pages.ts `later`): nobody waits on it, and no
// later card has to ask (T-150301).
/** Why a code's letter never left, and whether the tracker heard of it. */
export type Failed = { why: string; told: boolean }

export let askCode = (at: {
  address: string
  q?: string | null
  back?: string | null
  why?: string
  status?: number
  letter?: Promise<Failed | null>
}, env: Host = {}) => {
  let { address } = at
  let q = at.q ?? null, back = at.back ?? null
  let text = texted(address)
  let to = text ? shown(address) : address
  let failed = (left: Failed | null) =>
    left
      ? h(
        'p',
        { role: 'alert' },
        `The ${text ? 'text' : 'letter'} with your code to ${to} ` +
          `never left: ${left.why.replace(/\.?$/, '.')}` +
          (left.told ? ' We have been told.' : ''),
      )
      : null
  return page(
    env,
    {
      title: text ? 'Check your texts' : 'Check your email',
      lead: at.why ??
        `We ${text ? 'texted' : 'sent'} a six-digit code to ${to}. ` +
          'It lasts ten minutes.',
      status: at.status ?? 200,
      later: at.letter?.then(failed),
    },
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login/code' },
      carried(q, back),
      h(
        'p',
        null,
        q
          ? 'Enter it to finish connecting your assistant.'
          : back
          ? 'Enter it to sign in and continue.'
          : 'Enter it to land on your own space.',
      ),
      held('address', address),
      h(Field, {
        class: 'Code',
        placeholder: '6 digits from your code',
        name: 'code',
        inputmode: 'numeric',
        pattern: '[0-9]{6}',
        maxlength: 6,
        required: true,
        autofocus: true,
        autocomplete: 'one-time-code',
        'aria-label': 'Your six-digit code',
      }),
      send('Sign in'),
    ),
    h(
      'form',
      { class: 'Again Page_Form', method: 'post', action: '/login' },
      carried(q, back),
      held('address', address),
      h(Button, { type: 'submit' }, 'Send a new code'),
    ),
    home(env),
  )
}

// Closing a space (T-33166, erase.ts): the page that stands in front of it.
// It names what goes — every app, every domain, everyone who loses their way
// in, and the address — because a person about to lose all of it should read
// the list rather than remember it.
//
// Two acts, and the page says which one this is (T-34431). By default the
// space goes to the trash, and then each line names something that stops
// rather than something destroyed; `forever` is the letter's other link, and
// only then does the page speak of no undo. The lines themselves are the
// caller's (erase.ts `keeping` and `naming`), so the page never has to know
// which act it is drawing except to title it.
//
// Two ways to say yes, and the page shows whichever the visitor arrived with.
// Off the letter, with its ticket in hand, one button: opening the letter and
// following the link is the deliberate act, and the ticket is what carries it
// (it expires, and the act it opens can only happen once). Straight off the
// web, with no ticket, they type the name back — the guard that makes this
// hard to do by accident when nothing was mailed at all.
//
// The form POSTs to its own address and needs no script, like every other
// card here. Whoever may not delete this space never sees this page: the door
// answers them exactly what it answers for a space that does not exist.
export let askDelete = (at: {
  slug: string
  lines: string[]
  token?: string | null
  // Whether this link erases the space instead of trashing it (erase.ts
  // `Ticket`). Only a ticket the platform signed can say so.
  forever?: boolean
  // Why this cannot happen at all — a space that is still paying, or one
  // already in the trash (erase.ts `refused`, identity.ts `closing`). The page
  // then names the reason and offers no form.
  stop?: string
  why?: string
  status?: number
}, env: Host = {}) => {
  let host = spaceHost(env, at.slug)
  return page(
    env,
    {
      title: `Delete ${host}?`,
      lead: at.stop ?? at.why ??
        (at.forever
          ? 'This cannot be undone, and nothing is kept.'
          : 'It goes to recoverable trash. Nothing is erased, and you ' +
            'can bring it back until you separately confirm permanent erasure.'),
      status: at.status ?? 200,
    },
    at.lines.length
      ? h(
        Card,
        null,
        heading(
          at.forever
            ? 'What goes, for good'
            : 'What stops until you restore it',
        ),
        h(
          'ol',
          { class: 'Card_List' },
          at.lines.map((l) => h('li', { class: 'Card_Item' }, l)),
        ),
      )
      : null,
    at.stop ? null : [
      h(
        'form',
        {
          class: 'Page_Form',
          method: 'post',
          action: `/space/${at.slug}/delete`,
        },
        held('t', at.token),
        at.token ? null : [
          h(
            Form.Label,
            { for: 'confirm' },
            'Type ',
            h('b', null, at.slug),
            ' to confirm',
          ),
          h(Field, {
            id: 'confirm',
            placeholder: at.slug,
            name: 'confirm',
            autocomplete: 'off',
            spellcheck: 'false',
            autofocus: true,
          }),
        ],
        send(
          at.forever ? `Delete ${host} forever` : `Put ${host} in the trash`,
        ),
      ),
      h(
        'p',
        { class: 'Note' },
        'Changed your mind? Close this page — nothing has happened.',
      ),
    ],
    home(env),
  )
}

// Erasing one app from the trash (identity.ts `erasing`): the page the
// letter's link opens. One button with the ticket, the app's slug typed back
// without one, and no form at all when it cannot happen (`stop`).
// An act only a person may confirm (confirm.ts, identity.ts `confirming`):
// what it destroys, where things stand until they press, and the press, with
// the letter's ticket held or the target's name to type back.
export let askConfirm = (at: {
  action: string
  title: string
  until: string
  typed: string
  press: string
  reversible?: boolean
  lines: string[]
  token?: string | null
  stop?: string
  why?: string
  status?: number
}, env: Host = {}) =>
  page(
    env,
    {
      title: at.title,
      lead: at.stop ?? at.why ??
        `${
            at.reversible
              ? 'It stays recoverable until restored or you confirm a purge.'
              : 'This cannot be undone.'
          } ${at.until} Nothing changes until you press ` +
          'the button.',
      status: at.status ?? 200,
    },
    at.lines.length
      ? h(
        Card,
        null,
        heading(
          at.reversible ? 'What stops until restored' : 'What goes, for good',
        ),
        h(
          'ol',
          { class: 'Card_List' },
          at.lines.map((l) => h('li', { class: 'Card_Item' }, l)),
        ),
      )
      : null,
    at.stop ? null : [
      h(
        'form',
        { class: 'Page_Form', method: 'post', action: at.action },
        held('t', at.token),
        at.token ? null : [
          h(
            Form.Label,
            { for: 'confirm' },
            'Type ',
            h('b', null, at.typed),
            ' to confirm',
          ),
          h(Field, {
            id: 'confirm',
            placeholder: at.typed,
            name: 'confirm',
            autocomplete: 'off',
            spellcheck: 'false',
            autofocus: true,
          }),
        ],
        send(at.press),
      ),
      h(
        'p',
        { class: 'Note' },
        'Changed your mind? Close this page — nothing has happened.',
      ),
    ],
    home(env),
  )

// And after an act a person confirmed: what was done.
export let acted = (said: string, env: Host = {}) =>
  page(env, { title: "That's done.", lead: said }, home(env))

// And after: what went, and the one thing worth knowing next — the address
// belongs to nobody now, theirs to take again or somebody else's to take
// later. A space that went to the trash has the opposite next thing: the
// address is still theirs, and so is everything under it.
export let deleted = (said: string, forever = true, env: Host = {}) =>
  page(
    env,
    { title: "That's done.", lead: said },
    h(
      'p',
      { class: 'Note' },
      forever
        ? 'The address is free again. Ask your assistant for a new space whenever you want one.'
        : 'Nothing was erased. The address is held for you, and restoring it puts everything back exactly as it was.',
    ),
    home(env),
  )

// The one press that signs in as the invited address and accepts (invite.ts
// `taken`). A browser signed in as somebody else is asked which account: the
// press switches it, or they stay who they are and accept nothing.
let pressed = (o: Offer, env: Host) =>
  h(
    'form',
    { class: 'Page_Form', method: 'post', action: INVITE },
    held('t', o.t ?? ''),
    h(
      'p',
      null,
      o.as
        ? `It was sent to ${o.email}, and you are signed in as ${o.as}. ` +
          `Accepting signs you in as ${o.email} instead.`
        : `It was sent to ${o.email}. Accepting signs you in with that address.`,
    ),
    send(o.as ? `Accept as ${o.email}` : 'Accept'),
    o.as
      ? h('p', null, h('a', { href: url(env, MANAGE) }, `Stay as ${o.as}`))
      : null,
  )

// An invitation opened by somebody who is not signed in as the person it is
// for (invite.ts): who invited them to what, the app drawn as the dashboard
// draws it, the address it went to, and the press that signs in as that
// address and accepts, or, once the link no longer signs anyone in, the one
// button that mails that address a code and brings them back to accept it.
export let invited = (o: Offer, env: Host = {}) => {
  let host = spaceHost(env, o.space.slug)
  let what = o.app ? o.app.title || o.app.slug : `${o.space.title} at ${host}`
  return page(
    env,
    {
      title: 'You have an invitation',
      lead: `${o.by || 'Someone'} invited you to ${
        o.see ? 'see' : 'use'
      } ${what}.`,
      // The address carries the letter's link, which signs its holder in.
      headers: {
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    },
    o.app
      ? h(
        Card,
        { class: 'Identity_Cards' },
        h(
          Rows,
          { as: 'ul' },
          tile(o.app, {
            at: `https://${host}`,
            host,
            icon: o.app.open ? undefined : url(env, '/connector-512.png'),
          }),
        ),
      )
      : null,
    o.signs ? pressed(o, env) : h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login' },
      held('address', o.email),
      held('return', o.back),
      h(
        'p',
        null,
        `It was sent to ${o.email}. Sign in with that address to accept it.`,
      ),
      send('Email me a sign-in code'),
    ),
    home(env),
  )
}

// The Connect button an app that asks each person to connect their own
// account is given (connections.ts `own`): which app, which service and how it
// looks, whether this person's is connected, and the one form that connects
// it — a key pasted, or a sign-in at the service. The form posts back to this
// page.
export let askConnect = (at: {
  app: string
  face: Face
  keyed: boolean
  /** whether a key can be kept here at all */
  on: boolean
  status: Shown['status']
  /** the app's own address, to go back to */
  back: string
  say?: string
  no?: boolean
}, env: Host = {}) =>
  page(
    env,
    {
      title: `Connect ${at.face.title}`,
      lead:
        `${at.app} asks each person who uses it to connect their own ${at.face.title} account. Yours is used only when you use the app, and you can disconnect it from your own connections page.`,
    },
    h(
      Card,
      null,
      heading(at.face.title, {
        mark: logo(at.face, env),
        status: at.status == 'needed'
          ? null
          : at.status == 'broken'
          ? status('Yours needs reconnecting', 'negative')
          : status('Yours is connected', 'positive'),
        actions: at.on && !at.keyed
          ? h(
            'form',
            { class: 'Page_Form', method: 'post' },
            signingIn(
              at.face,
              at.status == 'needed' ? 'Connect' : 'Connect again',
            ),
          )
          : null,
      }),
      about(at.face),
      howTo(at.face, at.status != 'connected'),
      said(at.say, at.no),
      !at.on ? h(Card.Sub, null, "Keys can't be saved here yet.") : at.keyed
        ? h(
          'form',
          { class: 'Page_Form', method: 'post' },
          keyBox('key', 'Paste your key', send('Save key'), '', at.face.fields),
        )
        : null,
    ),
    h('p', { class: 'Note' }, h('a', { href: at.back }, `Back to ${at.app}`)),
  )

// A one-click link, opened (identity.ts LINK). Opening it spends nothing: a
// messaging app or mail scanner that fetches the address to draw a preview
// would otherwise sign itself in and leave the person a dead link. The button
// carries the pass on, and pressing it is what spends the code. Whoever asked
// for the letter chose where the link goes on to (`back`), so a page on a
// space is named before the press, as the sign-in card names it (`welcome`).
export let askLink = (
  t: string,
  back: string | null,
  env: Host = {},
  account?: string,
) =>
  page(
    env,
    {
      title: 'Sign in to yaks.app',
      lead: [
        account
          ? `This link signs you in as ${account}.`
          : 'This link signs you in once, for ten minutes.',
        onSpace(back, env),
      ].filter(Boolean).join(' '),
      headers: {
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    },
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login/link' },
      held('t', t),
      send('Sign in'),
    ),
    home(env),
  )

// A custom domain asking to sign in: consent names its host and its space.
export let askHandoff = (
  host: string,
  back: string,
  consent: string,
  env: Host = {},
) =>
  page(
    env,
    {
      title: `Sign in to ${host}`,
      lead: 'This signs you in to this space only.',
      headers: {
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    },
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/login/handoff' },
      held('return', back),
      held('consent', consent),
      send(`Continue to ${host}`),
    ),
    home(env),
  )

// An app asking, for a browser that is already signed in: one click is the
// whole consent. `consent` is the form's own token (identity.ts `consenting`).
export let askAllow = (
  email: string,
  q: string,
  who: string,
  consent: string,
  env: Host = {},
) =>
  page(
    env,
    {
      title: 'Allow access to your apps on yaks.app',
      lead: `${who} would like to use your apps on yaks.app as ${email}.`,
    },
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/oauth/allow' },
      carried(q),
      held('consent', consent),
      send('Allow'),
    ),
    home(env),
  )
