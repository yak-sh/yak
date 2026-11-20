// Every way to reach a space's Operator, in a card below its helpers on its
// page (operator-aside.ts `Aside`): its email address and the numbers it is
// called and texted at, each selectable with a copy button beside it and a
// button apiece that opens the person's mail app or phone there, and each
// chat server and room it is in, a link that opens their chat app.
import { h } from 'preact'
import { Button, Card, Icon, SideNav } from '@yaks/ui/parts'
import { copyable, copying } from './pages.ts'
import { type IconName, icons } from './icons.ts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { enabling, managePath } from '@yaks/platform/routes'
import { mailFrom } from '@yaks/platform/host'
import { shown } from '@yaks/phone'
import type { chatRows } from './connections.ts'
import { phoneAt } from './phones.ts'
import { caught } from './defects.ts'
import type { Place, Unset } from './chat.ts'
import { type Item, link } from './sidebar.ts'

/** Every way to reach a space's Operator, as its page lists them: its email
 * address, the number it is texted at and the one it answers calls on, and
 * where it is on each chat platform (chat.ts `reached`), with the platforms
 * the space has not added it to yet, offered to its owner alone. */
export type Ways = {
  email: string
  text?: string
  call?: string
  places: Place[]
  unset: Unset[]
}

/** How `space`'s Operator is reached, read for its page: each number from
 * configuration (phones.ts `phoneAt`), its chat platforms from its chat
 * connections `rows`, which its page read in its one directory trip
 * (manage.ts `beside`). A platform that cannot be read leaves the rest. */
export let waysOf = async (
  env: Env,
  space: Space,
  owner: boolean,
  rows: Awaited<ReturnType<typeof chatRows>>,
): Promise<Ways> => {
  let [texts, calls, chat] = await Promise.all([
    phoneAt(env, space.sender),
    phoneAt(env),
    import('./chat.ts').then((c) => c.reached(env, rows)).catch((e) => {
      caught(e, { request: 'operator reach chat' })
      return { places: [], unset: [] }
    }),
  ])
  let text = texts?.transport().number
  let call = calls?.caller ? calls.transport().number : undefined
  return {
    email: mailFrom(space.slug, null, env),
    ...text ? { text } : {},
    ...call ? { call } : {},
    places: chat.places,
    unset: owner ? chat.unset : [],
  }
}

type Press = { href: string; icon: IconName; label: string }

// An address or number to copy, and the buttons that open it.
let Line = ({ said, what, go }: { said: string; what: string; go: Press[] }) =>
  h(
    'div',
    { class: 'Talk_Way' },
    copyable(said, what),
    h(
      'div',
      { class: 'Talk_Go' },
      go.map((p) =>
        h(
          Button,
          { as: 'a', href: p.href, key: p.label },
          h(Icon, { of: icons[p.icon] }),
          p.label,
        )
      ),
    ),
  )

// The address and numbers: one number both called and texted is one line
// with both buttons.
let lines = (ways: Ways) => {
  let call = ways.call &&
    { href: `tel:${ways.call}`, icon: 'phone', label: 'Call' }
  let text = ways.text &&
    { href: `sms:${ways.text}`, icon: 'message-square', label: 'Text' }
  let numbers = ways.call === ways.text
    ? [ways.call && { said: ways.call, go: [call, text] }]
    : [
      ways.call && { said: ways.call, go: [call] },
      ways.text && { said: ways.text, go: [text] },
    ]
  return [
    h(Line, {
      said: ways.email,
      what: 'the address',
      go: [{ href: `mailto:${ways.email}`, icon: 'mail', label: 'Email' }],
    }),
    ...numbers.filter((n) => !!n).map((n) =>
      h(Line, {
        said: shown(n.said),
        what: 'the number',
        go: n.go.filter((p): p is Press => !!p),
      })
    ),
  ]
}

// The side's links for each chat place the Operator is in, each opening the
// person's chat app there, and each platform not set up yet the one button
// that adds it, which comes back to `here`.
let reaching = (space: Space, ways: Ways, here: string): Item[] => [
  ...ways.places.map((p): Item => ({
    href: p.href,
    icon: 'message-circle',
    label: [p.server ?? p.platform, p.room && `#${p.room}`].filter(Boolean)
      .join(' · '),
    external: true,
  })),
  ...ways.unset.map((u): Item => ({
    href: enabling(
      managePath('connections', space.slug),
      u.testing ? [u.integration] : [],
    ),
    icon: 'plus',
    label: `Add to ${u.platform}`,
    submit: true,
    fields: { do: 'add', integration: u.integration, back: here },
  })),
]

/** The card of `ways` to reach `space`'s Operator, each platform not set up
 * yet a button that adds it and comes back to `here`. */
export let Ways = (
  { space, ways, here }: { space: Space; ways: Ways; here: string },
) =>
  h(
    Card,
    { 'data-reach': '' },
    h(
      Card.Head,
      null,
      h(Card.Title, { id: 'reach' }, `Reach ${space.operator}`),
    ),
    lines(ways),
    ways.places.length || ways.unset.length
      ? h(
        SideNav,
        { class: 'Talk_Reach', 'aria-labelledby': 'reach' },
        reaching(space, ways, here).map(link),
      )
      : null,
    copying(),
  )
