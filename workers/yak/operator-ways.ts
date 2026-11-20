// Every way to reach a space's Operator, in a card below its helpers on its
// page (operator-aside.ts `Aside`): its email address and the numbers it is
// called and texted at, each selectable with a copy button beside it, then
// one row of buttons that open the person's mail app, phone or chat app
// there, each chat place's wearing its platform's logo.
import { h } from 'preact'
import { Button, Card, Icon, Logo, Toolbar } from '@yaks/ui/parts'
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

// A button that opens a way to reach the Operator: a mail app, a phone, a
// chat app (in a new tab), or one that adds the Operator to a platform,
// posting `fields` to `href`. Its mark is an icon, or a platform's logo.
type Press = {
  href: string
  label: string
  icon?: IconName
  logo?: string
  external?: boolean
  fields?: Record<string, string>
}

let press = (p: Press) => {
  let face = p.icon
    ? [h(Icon, { of: icons[p.icon] }), p.label]
    : h(Logo, { src: p.logo }, p.label)
  return p.fields
    ? h(
      'form',
      { method: 'post', action: p.href, key: p.label },
      Object.entries(p.fields).map(([name, value]) =>
        h('input', { type: 'hidden', name, value })
      ),
      h(Button, { type: 'submit' }, face),
    )
    : h(
      Button,
      {
        as: 'a',
        href: p.href,
        key: p.label,
        ...p.external ? { target: '_blank', rel: 'noopener' } : {},
      },
      face,
    )
}

// Where the Operator is on a chat platform, said as what its button opens.
let opening = (p: Place) => {
  let at = p.room ? `#${p.room}` : p.server
  return at ? `Open ${at} in ${p.platform}` : `Open ${p.platform}`
}

// The address and numbers, each selectable with its copy button, then one
// row of the buttons that open them and each chat place, and that add the
// Operator to each platform not set up yet, which comes back to `here`: one
// number both called and texted is one line, with both buttons.
let lines = (space: Space, ways: Ways, here: string) => {
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
    ...ways.places.map((p): Press => ({
      href: p.href,
      logo: p.logo,
      label: opening(p),
      external: true,
    })),
    ...ways.unset.map((u): Press => ({
      href: enabling(
        managePath('connections', space.slug),
        u.testing ? [u.integration] : [],
      ),
      logo: u.logo,
      label: `Add to ${u.platform}`,
      fields: { do: 'add', integration: u.integration, back: here },
    })),
  ]
  return h(
    'div',
    { class: 'Talk_Way' },
    copyable(ways.email, 'the address'),
    numbers.filter((n): n is string => !!n).map((n) =>
      copyable(shown(n), 'the number')
    ),
    h(Toolbar, { mod: 'plain' }, go.map(press)),
  )
}

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
    lines(space, ways, here),
    copying(),
  )
