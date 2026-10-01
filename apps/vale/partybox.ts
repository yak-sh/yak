// The party sheet: incoming invitations, the members who answered, and their
// current or last known lands. Actions stay on the sheet while its graph rows
// arrive, so accepting an invitation does not require walking back to them.
import type { Panel } from './panel.ts'
import type { parties } from './party.ts'
import type { Frame } from './play.ts'
import { split } from './ui/split.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export let partybox = (
  panel: Panel,
  party: ReturnType<typeof parties>,
  toast: (s: string) => void,
) => {
  let panes = split(panel.body)
  let picked: string | null = null
  let frame: Frame | null = null
  let draw = () => {
    if (!panel.open || !frame) return
    if (!party.canJoin) {
      picked = null
      let content =
        `<p class=Party_Empty>Sign in to form a party with other heroes.</p>${
          party.signIn
            ? `<a class="Btn Btn-go" href="${esc(party.signIn)}">Sign in</a>`
            : ''
        }`
      panes.render(content, content)
      return
    }
    let invites = party.invites, members = party.members
    let invite = invites.find((i) => `invite:${i.eid}` == picked)
    let member = members.find((m) => `member:${m.eid}` == picked)
    if (!invite && !member && !(picked == 'party' && party.group)) picked = null
    let location = (m: typeof members[number]) =>
      esc(party.location(m, [frame!.body.x, frame!.body.z]))
    let rows = `${invites.length ? '<h3>Invitations</h3>' : ''}${
      invites.map((i) =>
        `<button class=Split_Row type=button data-select="invite:${
          esc(i.eid)
        }"><b>${
          esc(party.name(i.from))
        }</b><small>invited you to their party</small></button>`
      ).join('')
    }<h3>Members</h3>${
      members.length
        ? members.map((m) =>
          `<button class=Split_Row type=button data-select="member:${
            esc(m.eid)
          }"><b>${esc(m.name)}</b><small>${
            m.online ? 'Online' : 'Away'
          }</small></button>`
        ).join('')
        : '<p class=Party_Empty>Talk to a nearby hero to invite them.</p>'
    }${
      party.group
        ? '<button class=Split_Row type=button data-select=party>Party details</button>'
        : ''
    }`
    let content = invite
      ? `<div class=Party_Row><div><b>${
        esc(party.name(invite.from))
      }</b><small>invited you to their party</small></div></div><div class=Party_Acts><button class="Btn Btn-go Btn-small" data-act=accept data-invite="${
        esc(invite.eid)
      }">Join</button><button class="Btn Btn-small" data-act=decline data-invite="${
        esc(invite.eid)
      }">Decline</button></div>`
      : member
      ? `<div class=Party_Row><div><b>${esc(member.name)}</b><small>${
        location(member)
      }</small><small>${
        member.online ? 'Online' : 'Away'
      }</small></div><span class="Party_Dot${
        member.online ? ' Party_Dot-on' : ''
      }" title="${member.online ? 'Online' : 'Away'}"></span></div>`
      : picked == 'party'
      ? `<h3>Your party</h3><p>${members.length} members</p>`
      : '<p class=Party_Empty>Select an invitation or member to see details.</p>'
    if (party.group) {
      content +=
        '<button class="Btn Btn-small Party_Leave" data-act=leave>Leave party</button>'
    }
    panes.render(rows, content, picked)
  }
  let paint = (f: Frame) => {
    frame = f
    draw()
  }
  panel.body.addEventListener('click', async (e) => {
    let row = e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-select]')
      : null
    if (row) {
      picked = row.dataset.select!
      draw()
      return
    }
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
