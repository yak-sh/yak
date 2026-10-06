// The party sheet: incoming invitations, the members who answered, and their
// current or last known lands. Actions stay on the sheet while its graph rows
// arrive, so accepting an invitation does not require walking back to them.
// A member picked shows how they fare: their health, what they are doing,
// and what they wear.
import { type ComponentChildren, h } from 'preact'
import { Body, Button, Pairs, Rows, Tile } from '@yaks/ui'
import { glyph } from './glyphs.ts'
import type { Panel } from './panel.ts'
import type { parties } from './party.ts'
import type { Frame } from './play.ts'
import { split } from './ui/split.ts'
import { ITEMS } from './items.ts'
import { SLOT_NAMES, SLOTS } from './arms.ts'
import type { Member } from './party-state.ts'
import { ValeMeter } from './kit/ValeMeter.ts'
import { head, hint, part, picture } from './tile.ts'

// How a member fares, and what they wear, as far as is known.
let details = (m: Member) => [
  h(Body, {}, h('p', {}, m.status)),
  m.vitals
    ? h(ValeMeter, { label: 'Health', value: m.vitals.hp, max: m.vitals.max })
    : hint('Live stats unavailable.'),
  part(
    'Equipment',
    m.gear
      ? h(
        Pairs,
        {},
        SLOTS.map((slot) => {
          let kind = m.gear![slot] ?? ''
          return [
            h(Pairs.Key, { key: `${slot}:k` }, SLOT_NAMES[slot]),
            h(
              Pairs.Value,
              { key: `${slot}:v` },
              kind ? ITEMS[kind]?.name ?? 'Unknown equipment' : 'Empty',
            ),
          ]
        }),
      )
      : hint(
        m.online
          ? 'Equipment unavailable.'
          : 'Equipment unavailable while away.',
      ),
  ),
]

export let partybox = (
  panel: Panel,
  party: ReturnType<typeof parties>,
  toast: (s: string) => void,
) => {
  let panes = split(panel.body)
  let picked: string | null = null
  let frame: Frame | null = null
  let act = (name: string, words: string, more: Record<string, unknown> = {}) =>
    h(Button, { 'data-act': name, ...more }, words)
  let draw = () => {
    if (!panel.open || !frame) return
    if (!party.canJoin) {
      picked = null
      let content = () => [
        hint('Sign in to form a party with other heroes.'),
        party.signIn &&
        h(Button, { mod: 'go', href: party.signIn }, 'Sign in'),
      ]
      panes.render(content(), content())
      return
    }
    let invites = party.invites, members = party.members
    let invite = invites.find((i) => `invite:${i.eid}` == picked)
    let member = members.find((m) => `member:${m.eid}` == picked)
    if (!invite && !member && !(picked == 'party' && party.group)) {
      picked = null
    }
    let location = (m: typeof members[number]) =>
      party.location(m, [frame!.body.x, frame!.body.z])
    let row = (
      id: string,
      icon: 'user' | 'users',
      title: string,
      sub: string,
      tone?: string,
    ) =>
      h(
        Tile,
        {
          key: id,
          mod: picked == id && 'on',
          'data-select': id,
          onClick: () => {
            picked = id
            draw()
          },
        },
        picture(glyph(icon), { mod: tone }),
        h(Tile.Title, {}, title),
        h(Tile.Sub, {}, sub),
      )
    let rows = h(
      'div',
      { class: 'Pack' },
      invites.length > 0 && part(
        'Invitations',
        h(
          Rows,
          {},
          invites.map((i) =>
            row(
              `invite:${i.eid}`,
              'users',
              party.name(i.from),
              'invited you to their party',
              'caution',
            )
          ),
        ),
      ),
      part(
        'Members',
        members.length
          ? h(
            Rows,
            {},
            members.map((m) =>
              row(
                `member:${m.eid}`,
                'user',
                m.name,
                `${m.online ? 'Online' : 'Away'}${
                  m.vitals
                    ? ` · Level ${m.vitals.lvl} · ${m.vitals.hp} / ${m.vitals.max} HP`
                    : ''
                }`,
                m.online ? 'positive' : undefined,
              )
            ),
          )
          : hint('Talk to a nearby hero to invite them.'),
      ),
      party.group && h(
        Rows,
        {},
        row('party', 'users', 'Party details', `${members.length} members`),
      ),
    )
    let content: ComponentChildren = invite
      ? head(
        picture(glyph('users'), { mod: 'caution' }),
        party.name(invite.from),
        ['invited you to their party'],
        [
          act('accept', 'Join', { mod: 'go', 'data-invite': invite.eid }),
          act('decline', 'Decline', { 'data-invite': invite.eid }),
        ],
      )
      : member
      ? [
        head(
          picture(glyph('user'), { mod: member.online && 'positive' }),
          member.name,
          [
            location(member),
            `${member.online ? 'Online' : 'Away'}${
              member.vitals ? ` · Level ${member.vitals.lvl}` : ''
            }`,
          ],
        ),
        ...details(member),
      ]
      : picked == 'party'
      ? head(picture(glyph('users')), 'Your party', [
        `${members.length} members`,
      ])
      : hint('Select an invitation or member to see details.')
    panes.render(rows, [
      content,
      party.group && act('leave', 'Leave party'),
    ], picked)
  }
  let paint = (f: Frame) => {
    frame = f
    draw()
  }
  panel.body.addEventListener('click', async (e) => {
    let button = e.target instanceof Element
      ? e.target.closest<HTMLButtonElement>('button[data-act]')
      : null
    let act = button?.dataset.act
    let invite = party.invites.find((i) => i.eid == button?.dataset.invite)
    if (act == 'leave') {
      toast(
        await party.leave()
          ? 'You left the party.'
          : 'Could not leave the party. Try again.',
      )
    } else if (act == 'accept' && invite) {
      toast(
        await party.accept(invite)
          ? 'You joined the party.'
          : 'That invitation is no longer open.',
      )
    } else if (act == 'decline' && invite) {
      if (!await party.decline(invite)) toast('Could not decline. Try again.')
    }
    draw()
  })
  return { paint }
}
