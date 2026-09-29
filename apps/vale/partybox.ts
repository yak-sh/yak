// The party sheet: incoming invitations, the members who answered, and their
// current or last known lands. Actions stay on the sheet while its graph rows
// arrive, so accepting an invitation does not require walking back to them.
import type { Panel } from './panel.ts'
import type { parties } from './party.ts'
import type { Frame } from './play.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export let partybox = (
  panel: Panel,
  party: ReturnType<typeof parties>,
  toast: (s: string) => void,
) => {
  let was = ''
  let paint = (f: Frame) => {
    if (!panel.open) return
    let invites = party.invites
    let members = party.members
    let html = !party.canJoin
      ? `<p class=Party_Empty>Sign in to form a party with other heroes.</p>${
        party.signIn
          ? `<a class="Btn Btn-go" href="${esc(party.signIn)}">Sign in</a>`
          : ''
      }`
      : `<div class=Party_List>${
        invites.map((i) =>
          `<div class=Party_Row><div><span>${
            esc(party.name(i.from))
          }</span><small>invited you to their party</small></div><div class=Party_Acts><button class="Btn Btn-go Btn-small" data-act=accept data-invite="${
            esc(i.eid)
          }">Join</button><button class="Btn Btn-small" data-act=decline data-invite="${
            esc(i.eid)
          }">Decline</button></div></div>`
        ).join('')
      }</div><div class=Party_List>${
        members.length
          ? members.map((m) =>
            `<div class=Party_Row><div><span>${esc(m.name)}</span><small>${
              esc(party.location(m, [f.body.x, f.body.z]))
            }</small></div><span class="Party_Dot${
              m.online ? ' Party_Dot-on' : ''
            }" title="${m.online ? 'Online' : 'Away'}"></span></div>`
          ).join('')
          : '<p class=Party_Empty>Talk to a nearby hero to invite them.</p>'
      }</div>${
        party.group
          ? '<button class="Btn Btn-small Party_Leave" data-act=leave>Leave party</button>'
          : ''
      }`
    if (was == html) return
    was = html
    panel.body.innerHTML = html
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
    was = ''
  })
  return { paint }
}
