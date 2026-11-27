/**
 * A space's Operator settings page (`/manage/<space>/operator`), drawn from
 * rows (./operator-settings.ts): what the Operator is called and how it
 * speaks, off its persona; how the person is told things away from the page;
 * the number they agreed to texts at; and their email (./account-rows.ts).
 * What changes only by leaving the page (the voices offered, the numbers to
 * text and call, Discord's servers, where else the Operator works) the page
 * says beside the rows (`OperatorView`). The server draws it for the first
 * paint, and the browser draws it again as the rows move
 * (./operator-settings-browser.ts).
 *
 * @module
 */
import { createElement as h, Fragment, type ReactNode as Kids } from 'react'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Check } from '@yaks/ui/Check'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Time } from '@yaks/ui/Time'
import { NameCard } from '@yaks/persona/ui'
import { type Offer, VoiceCard } from '@yaks/speech/ui'
import { CONSENT } from './consent.ts'
import { chatPath, enabling } from './routes.ts'
import { heading, labeled } from './page-parts.ts'
import type { Alerting, Settings, Texting } from './operator-settings.ts'

/** A space the Operator also works in, and the role it has there. */
export type Elsewhere = { slug: string; title: string; role: string }

/** An integration a button adds, still in its service's testing mode or not. */
export type Adding = { name: string; testing?: boolean }

/** A chat server the Operator was added to: the rooms it may hear in full,
 * when the platform listed them, and the one it hears. */
export type ChatServer = {
  connection: string
  rooms?: { id: string; eid: string; name: string }[] | null
  title?: string
  away?: boolean
  hears?: string
  own?: boolean
}

/** A chat platform the space's owner adds the Operator to. */
export type ChatOffer = {
  platform: { title: string; place?: string; followsReplies?: boolean }
  bot: Adding
  user?: Adding
  kept: boolean
  servers: ChatServer[]
}

/** What the page says beside the rows: whose and which space's it is, its
 * address, the Operator's name until its settings are in, where else it
 * works, how to write and call it, the voices it may speak in, the VAPID key
 * a browser subscribes with (none where notifications are off), and the
 * chat platforms the owner may add it to. */
export type OperatorView = {
  person: string
  space: { eid: string; slug: string }
  at: string
  connections: string
  operator: string
  pa: boolean
  beyond: Elsewhere[]
  address: string
  sub?: string | null
  from?: string
  call?: string
  offer: Omit<Offer, 'setup'> & { setup: Offer['setup'] }
  key: string | null
  chats: ChatOffer[]
}

/** The rows the page is drawn from. */
export type OperatorRows = {
  settings: Settings
  alerting: Alerting
  texting: Texting | null
  email: string | null
}

let LIST = new Intl.ListFormat('en', { type: 'conjunction' })

let shown = (number: string) =>
  number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')

// One of the Operator's settings, the way the dashboard draws one: a form
// around its card, and under the card its actions, with what pressing one
// said beside them. `id` names the form, the post it falls back to, and the
// card's anchor. Changed fields join the page's Save bar.
let setting = (at: string, id: string, card: Kids, actions: Kids = null) =>
  h(
    Form,
    {
      className: 'Page_Form',
      id,
      method: 'post',
      action: `${at}?${id}=1`,
      'data-save': id,
    },
    card,
    h(
      Form.Actions,
      null,
      actions,
      h('p', { role: 'status', 'data-status': '' }),
    ),
  )

// A card of this page's own, its head naming it.
let titled = (title: string, ...inside: Kids[]) =>
  h(Card, null, heading(title), ...inside)

// One of a few to pick, as a radio: its name in bold, what it means beside
// it, `also` on its input.
type Option = {
  id: string
  name: string
  about: string
  checked: boolean
  also?: Record<string, unknown>
}
let choice = (name: string, o: Option) =>
  h(
    Check,
    null,
    h(Check.Input, {
      type: 'radio',
      name,
      value: o.id,
      ...o.also,
      checked: o.checked,
    }),
    h('span', null, h('b', null, o.name), ' ', h(Check.Note, null, o.about)),
  )

// A field of few to pick one from, its label over them.
let choices = (id: string, label: string, name: string, offers: Option[]) =>
  h(
    Form.Field,
    { role: 'radiogroup', 'aria-labelledby': id },
    h(Form.Label, { id }, label),
    offers.map((o) => choice(name, o)),
  )

/** Where else the Operator works and what it may do there, one sentence for
 * all of it: the spaces it changes things in, then those it only looks at.
 * Each space's owner sets that on its People page; on a person's own space
 * (`pa`) it follows their role in each. */
export let elsewhere = (beyond: Elsewhere[], pa: boolean) => {
  if (!beyond.length) return null
  let named = (rs: Elsewhere[]) =>
    rs.length
      ? LIST.formatToParts(rs.map((_, i) => String(i))).map((part) => {
        let space = rs[Number(part.value)]
        return part.type == 'element' && space
          ? h('a', { href: chatPath(space.slug) }, space.title || space.slug)
          : part.value
      })
      : null
  let changes = named(beyond.filter((r) => r.role != 'viewer'))
  let looks = named(beyond.filter((r) => r.role == 'viewer'))
  return h(
    'p',
    null,
    ...changes && looks
      ? [
        'It can also change things in ',
        changes,
        ', and look at ',
        looks,
        ' without changing anything.',
      ]
      : changes
      ? ['It can also work in ', changes, ', and change things there.']
      : ['It can also look at ', looks, ', but not change anything there.'],
    pa ? null : ' Each space’s owner chooses this on its People page.',
  )
}

// What the Operator is, where else it works, and how to write it.
let about = (view: OperatorView, operator: string) =>
  h(
    Card,
    null,
    h(
      'p',
      null,
      `${operator} is this space’s Operator. Ask ${operator} for a change in your apps, or send a PDF or a photo. Your space's plan covers its work.`,
    ),
    view.pa
      ? h(
        'p',
        null,
        'This is your own space, so its Operator can also work in your other spaces, with your role in each.',
      )
      : null,
    elsewhere(view.beyond, view.pa),
    h(
      'p',
      null,
      `You can also email ${operator} from any mail app: write to `,
      h('a', { href: `mailto:${view.address}` }, view.address),
      view.sub
        ? ` (or any other name at ${view.sub} that is not an app's, such as clerk@${view.sub})`
        : '',
      ` with what you want changed, and attach a PDF or a photo if you have one. Send it from the email address you sign in with; ${operator} answers by email.`,
    ),
  )

/** Where the person's conversations with the Operator are. */
export let talks = (space: string) =>
  h(
    Card,
    null,
    heading('Conversations'),
    h(
      'p',
      null,
      'Your conversations with the Operator are in its chat. ',
      h(Button, { mod: 'go', href: chatPath(space) }, 'Open the chat'),
    ),
  )

// The voice card's choices, the ones picked now being the settings'.
let voiceOffer = (view: OperatorView, s: Settings): Offer => ({
  ...view.offer,
  setup: {
    voice: s.voice ?? view.offer.setup.voice,
    pace: s.voice_speed ?? view.offer.setup.pace,
    model: s.voice_model ?? view.offer.setup.model,
    backend: s.voice_backend ?? view.offer.setup.backend,
  },
})

/** Where a person chooses how their Operators tell them something away from
 * the page: the way an alert goes now is checked where they have not chosen.
 * Browser notifications are offered where yaks.app has a VAPID key (`key`),
 * which the page's script subscribes this browser with before the choice is
 * saved. */
export let alertsCard = (
  at: string,
  alerting: Alerting,
  texting: Texting | null,
  email: string | null,
  key: string | null,
) => {
  let current = alerting.channel ?? alerting.by
  let n = alerting.browsers
  let offers: Omit<Option, 'checked'>[] = [
    ...key
      ? [{
        id: 'push',
        name: 'Browser notification',
        about: n
          ? `on the ${
            n == 1 ? 'browser' : `${n} browsers`
          } you allowed; saving here allows this one too`
          : 'on this browser, once you allow it',
        also: { 'data-push': key },
      }]
      : [],
    {
      id: 'text',
      name: 'Text',
      about: texting
        ? `to ${shown(texting.number)}`
        : 'once you agree to texts below; until then, by email',
    },
    {
      id: 'email',
      name: 'Email',
      about: email
        ? `to ${email}`
        : 'once you give an address; until then, by text',
    },
    { id: 'updates', name: 'Only in Updates', about: 'nothing sent' },
  ]
  return setting(
    at,
    'alerts',
    titled(
      'Alerts',
      h(
        'p',
        null,
        'How your Operator tells you something when you are not here: work you are waiting on finished, something needs you, or you asked to be told. It is always in your Updates too.',
      ),
      choices(
        'alerts-channel',
        'Tell me by',
        'channel',
        offers.map((o) => ({ ...o, checked: o.id == current })),
      ),
    ),
  )
}

// The texts' terms, their addresses links to yaks.app's own pages.
let TERMS = /https:\/\/yaks\.app\/(terms|privacy)/g
let terms = (said: string) =>
  said.split(TERMS).map((part, i) =>
    i % 2 ? h('a', { href: `/${part}` }, `yaks.app/${part}`) : part
  )

// The number to text and the words agreed to with it.
let agreeing = (label: string) => [
  labeled(
    'texts-number',
    label,
    h(Field, {
      id: 'texts-number',
      type: 'tel',
      name: 'number',
      autocomplete: 'tel',
      inputmode: 'tel',
      placeholder: '269-555-0142',
    }),
  ),
  h(
    Check,
    { style: 'align-items:flex-start' },
    h(Check.Input, { type: 'checkbox', name: 'agreed', value: 'yes' }),
    h('span', null, terms(CONSENT)),
  ),
  labeled(
    'texts-code',
    'Verification code',
    h(Field, {
      id: 'texts-code',
      placeholder: '6 digits from your text',
      name: 'code',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      pattern: '[0-9]{6}',
      maxlength: 6,
    }),
  ),
  h(
    'p',
    null,
    'Save to receive a code, then enter it and save again to confirm a new number.',
  ),
]

// A number already agreed to changes behind a button, which shows the field
// in its place. Its edits join the page's Save bar.
let changing = (fields: Kids) => [
  h(Button, {
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': 'texts-change',
    'data-reveal': '',
  }, 'Change number'),
  h('div', { id: 'texts-change', hidden: true }, fields),
]

/** Where a person agrees to texts from the Operator, or stops them, and finds
 * the numbers to text and call it at: `from`, the number it texts from, and
 * `call`, the number that answers calls. */
export let textsCard = (
  at: string,
  texting: Texting | null,
  from?: string,
  call?: string,
) =>
  setting(
    at,
    'texts',
    titled(
      'Texts and calls',
      h(
        'p',
        null,
        'Text your Operator about anything, and it answers by text; call it, and it answers by voice. It also texts you its alerts, unless you choose another way for them above, and apps you build can text you reminders. You can still use chat and email.',
      ),
      from || call
        ? h(
          'p',
          null,
          from === call
            ? [h('a', { href: `sms:${from}` }, 'Text'), ' or call ']
            : from
            ? ['Text ', h('a', { href: `sms:${from}` }, shown(from))]
            : null,
          from && call && from !== call ? ' or call ' : !from ? 'Call ' : null,
          call ? h('a', { href: `tel:${call}` }, shown(call)) : null,
          texting
            ? ' to contact your Operator.'
            : ' from the mobile number you agree to texts at below to contact your Operator.',
        )
        : null,
      texting
        ? h(
          'p',
          null,
          'Texts go to ',
          h('b', null, shown(texting.number)),
          from
            ? ''
            : '; to text your Operator, reply to the number your welcome text came from',
          '. You agreed ',
          h(Time, { at: texting.at }),
          '.',
        )
        : null,
      texting
        ? changing(agreeing('Change your mobile number'))
        : agreeing('Mobile number'),
    ),
    texting
      ? h(Button, { type: 'button', 'data-stop-texts': '' }, 'Stop texts')
      : null,
  )

/** Where the space's owner adds the Operator to a chat platform: yaks.app's
 * own bot added to a server they manage, and their own account there linked,
 * so it knows them. Each button posts to the connections page, which sends
 * them straight to the platform to choose and back here after; one still in
 * its service's testing mode is named there. For each server it was added to,
 * they choose the room it hears in full, posted here (`at`). */
export let chatCard = (
  at: string,
  connections: string,
  operator: string,
  offers: ChatOffer[],
) =>
  offers.map(({ platform, bot, user, kept, servers }) => {
    let place = platform.place ?? 'server'
    let adding = (i: Adding, label: string) =>
      h(
        'form',
        {
          method: 'post',
          action: enabling(connections, i.testing ? [i.name] : []),
        },
        h(Form.Hidden, { name: 'do', value: 'add' }),
        h(Form.Hidden, { name: 'integration', value: i.name }),
        h(Form.Hidden, { name: 'back', value: at }),
        h(Button, { type: 'submit' }, label),
      )
    let hearing = (s: ChatServer, i: number) => {
      if (s.rooms === undefined) {
        return h('p', null, s.title ? `Connected to ${s.title}.` : 'Connected.')
      }
      let id = `chat-room-${i}`
      // A server the bot was removed from, or never joined: it is added
      // again, which keeps this connection.
      if (s.away) {
        return h(
          'div',
          null,
          h(
            'p',
            null,
            s.own
              ? `Your own ${platform.title} bot is no longer in this server. Add it again from the ${platform.title} Developer Portal.`
              : `${operator} is no longer in this ${platform.title} server. Add it again to choose its channel.`,
          ),
          !s.own && kept ? adding(bot, `Add to ${platform.title} again`) : null,
        )
      }
      return h(
        'form',
        { method: 'post', action: `${at}?chat=1` },
        h(Form.Hidden, { name: 'connection', value: s.connection }),
        s.rooms
          ? labeled(
            id,
            s.own
              ? `The channel ${operator} hears in full through your own ${platform.title} bot`
              : `The ${platform.title} channel ${operator} hears in full`,
            h(
              Field,
              { choose: true, id, name: 'room' },
              h('option', { value: '' }, 'None, only what is said to it'),
              s.rooms.map((r) =>
                h(
                  'option',
                  { value: r.id, selected: r.eid == s.hears },
                  `#${r.name}`,
                )
              ),
            ),
          )
          : h(
            'p',
            null,
            `${platform.title} did not list this server's channels just now. Reload to try again.`,
          ),
        s.rooms ? h(Button, { type: 'submit' }, 'Save') : null,
      )
    }
    return titled(
      platform.title,
      h(
        'p',
        null,
        `Add ${operator} to a ${platform.title} ${place} you manage. Mention it there, ${
          platform.followsReplies ? 'reply to it, ' : ''
        }or message it directly, and it answers in the same place.`,
      ),
      kept ? adding(bot, `Add to ${platform.title}`) : null,
      servers.some((s) => s.rooms !== undefined)
        ? h(
          'p',
          null,
          `In the channel you choose, ${operator} reads everything said and answers only what is for it. Everyone there is a guest to it, who can do only what anyone can in this space.`,
        )
        : null,
      servers.map(hearing),
      user
        ? h(
          'p',
          null,
          `Connect your own ${platform.title} account so ${operator} knows it is you. Anyone else who talks to it there is a guest, who can do only what anyone can in this space.`,
        )
        : null,
      user ? adding(user, `Connect my ${platform.title} account`) : null,
    )
  })

/** The Operator settings page: `view`, drawn from `rows`. */
export let operatorSettingsView = (view: OperatorView, rows: OperatorRows) => {
  let operator = rows.settings.name || view.operator
  let { at } = view
  return h(
    Fragment,
    null,
    about(view, operator),
    talks(view.space.slug),
    setting(at, 'name', h(NameCard, { name: operator })),
    setting(
      at,
      'voice',
      h(VoiceCard, {
        name: operator,
        offer: voiceOffer(view, rows.settings),
        sample: (id) => `${at}?sample=${id}`,
      }),
    ),
    alertsCard(at, rows.alerting, rows.texting, rows.email, view.key),
    textsCard(at, rows.texting, view.from, view.call),
    chatCard(at, view.connections, operator, view.chats),
  )
}
