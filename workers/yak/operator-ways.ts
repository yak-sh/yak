// Every way to reach a space's Operator, in a card below its helpers on its
// page (operator-aside.ts `Aside`): its email address and the numbers it is
// called and texted at, each selectable with a copy button beside it, then
// one row of buttons that open the person's mail app or phone there, and each
// chat server and room it is in, a link under its platform's mark that opens
// their chat app.
import { h } from 'preact'
import { Button, Card, Icon, SideNav, Toolbar } from '@yaks/ui/parts'
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

// The address and numbers, each selectable with its copy button, then one
// row of the buttons that open them: one number both called and texted is
// one line, with both buttons.
let lines = (ways: Ways) => {
  let numbers = ways.call === ways.text ? [ways.call] : [ways.call, ways.text]
  let go: Press[] = [
    { href: `mailto:${ways.email}`, icon: 'mail', label: 'Email' },
    ...ways.call
      ? [{ href: `tel:${ways.call}`, icon: 'phone', label: 'Call' } as Press]
      : [],
    ...ways.text
      ? [
        {
          href: `sms:${ways.text}`,
          icon: 'message-square',
          label: 'Text',
        } as Press,
      ]
      : [],
  ]
  return h(
    'div',
    { class: 'Talk_Way' },
    copyable(ways.email, 'the address'),
    numbers.filter((n): n is string => !!n).map((n) =>
      copyable(shown(n), 'the number')
    ),
    h(
      Toolbar,
      { mod: 'plain' },
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
}

// A platform's mark as a link's image, where its integration keeps one.
let mark = (logo?: string) =>
  logo ? { image: `data:image/svg+xml,${encodeURIComponent(logo)}` } : {}

// The side's links for each chat place the Operator is in, each opening the
// person's chat app there, and each platform not set up yet the one button
// that adds it, which comes back to `here`.
let reaching = (space: Space, ways: Ways, here: string): Item[] => [
  ...ways.places.map((p): Item => ({
    href: p.href,
    icon: 'message-circle',
    ...mark(p.logo),
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
    ...mark(u.logo),
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
