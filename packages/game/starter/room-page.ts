import { friendsAt } from '@yaks/game/friends'
import { frames } from './frames.ts'
import {
  connectRoom,
  type Joined,
  postRoom,
  RoomRefused,
} from './room-client.ts'
import { type Choice, motionId, roomId, roomPath } from './room-model.ts'
import { battle, FOES, odds } from './room-rules.ts'
import { roomView } from './room-view.ts'
import { screen } from './screen.ts'

let disposeScreen = screen()
let canvas = document.querySelector('canvas')!
let status = document.querySelector<HTMLElement>('#room-status')!
let log = document.querySelector<HTMLElement>('#log')!
let host = document.querySelector<HTMLButtonElement>('#host')!
let share = document.querySelector<HTMLButtonElement>('#share')!
let friend = document.querySelector<HTMLButtonElement>('#friend')!
let friends = document.querySelector<HTMLSelectElement>('#friends')!
let link = document.querySelector<HTMLInputElement>('#invite-link')!
let actions = document.querySelector<HTMLFieldSetElement>('#actions')!

let show = (error: unknown) => {
  status.textContent = error instanceof Error
    ? error.message
    : 'Room unavailable.'
  if (!(error instanceof RoomRefused)) reportError(error)
}

let view = roomView(canvas)
let live:
  | Awaited<ReturnType<typeof connectRoom>> & { member: Joined }
  | undefined
let now = () => battle(live?.watch.value ?? [], live?.member.room ?? '')
frames(
  (_now, dt, elapsed) =>
    view.draw(live?.watch.value ?? [], now(), dt, elapsed, live?.member),
  () => {
    disposeScreen()
    live?.front.close()
    view.dispose()
  },
)

let selected = new URL(location.href).searchParams.get('room') ?? ''
let invitation = new URLSearchParams(location.hash.slice(1)).get('invite')
let remember = (room: string) => {
  let url = new URL(location.href)
  url.searchParams.set('room', room)
  url.hash = ''
  history.replaceState(null, '', url)
}

// The person's yaks.app friend list, with their consent.
let yaks = friendsAt()

let next = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1

let playRoom = async (member: Joined) => {
  let { room, seat } = member
  let path = roomPath(room)
  host.hidden = true
  share.hidden = friend.hidden = !member.host
  remember(room)
  let { front, watch } = await connectRoom(member, {
    report: ({ error, refused }) => {
      if (refused) show(new RoomRefused(refused.message))
      else if (error) show(error)
    },
  })
  live = { front, watch, member }
  let render = () => {
    let { turn, party, foes, hits } = now()
    let me = party.find((p) => p.eid === seat)
    let names = new Map([...party, ...foes].map((s) => [s.eid, s.name]))
    let living = foes.filter((f) => f.hp > 0)
    let mine = turn?.seat === seat && !!me && me.hp > 0
    actions.disabled = !watch.ready || !mine
    log.replaceChildren(
      ...hits.slice(-3).reverse().map((hit) => {
        let line = document.createElement('li')
        line.textContent = `${names.get(hit.by)} ${
          hit.dmg ? 'hit' : 'missed'
        } ${names.get(hit.target)}: rolled ${hit.roll}, needed ${hit.need}+${
          hit.dmg ? `, ${hit.dmg} damage` : ''
        }`
        return line
      }),
    )
    let beside = <T extends { x: number; z: number }>(them: T[]) =>
      me ? them.filter((t) => next(t, me)) : []
    status.textContent = watch.refused ??
      (!watch.ready
        ? 'Connecting…'
        : !living.length
        ? 'The camp is cleared: the party wins.'
        : party.every((p) => p.hp <= 0)
        ? 'The party has fallen.'
        : mine && turn
        ? [
          turn.steps > 0 && `Walk up to ${turn.steps} tiles`,
          ...beside(living).map((f) =>
            `strike ${f.name}: ${odds(FOES[f.kind].guard)}`
          ),
          ...beside(party.filter((p) => p.hp <= 0)).map((p) =>
            `revive ${p.name}`
          ),
          'or end your turn',
        ].filter(Boolean).join('; ')
        : `Waiting for ${names.get(turn?.seat ?? '') ?? 'your friend'}`)
  }
  watch.subscribe(render)
  render()
  // One way in for every action: the button, and a tap on the field.
  let send = (action: Choice) => {
    let current = now().turn
    if (actions.disabled || !current) return
    actions.disabled = true
    void postRoom(path + 'action', { ...action, number: current.number })
      .then(render, (error) => {
        render()
        show(error)
      })
  }
  actions.addEventListener('click', (event) => {
    let button = (event.target as HTMLElement).closest('button')
    if (button) send({ kind: 'pass' })
  })
  // A tap on a foe strikes it, on a fallen ally revives them, and anywhere
  // else walks there.
  canvas.addEventListener('click', (event) => {
    let point = view.pick(event.clientX, event.clientY)
    if (!point) return
    let x = Math.round(point.x), z = Math.round(point.z)
    let { party, foes } = now()
    let at = (s: { x: number; z: number }) => s.x === x && s.z === z
    let foe = foes.find((f) => f.hp > 0 && at(f))
    let ally = party.find((p) => p.hp <= 0 && at(p))
    send(
      foe
        ? { kind: 'strike', foe: foe.eid }
        : ally
        ? { kind: 'revive', seat: ally.eid }
        : { kind: 'move', x, z },
    )
  })
  let invite = async () => {
    member.invite ??= (await postRoom<Joined>(path + 'invite')).invite
    let url = new URL('room', document.baseURI)
    url.searchParams.set('room', room)
    url.hash = new URLSearchParams({ invite: member.invite! }).toString()
    return url
  }
  share.addEventListener('click', () => {
    void (async () => {
      let url = await invite()
      link.hidden = false
      link.value = url.href
      link.select()
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url.href).catch((error) => {
          if (
            !(error instanceof DOMException && error.name === 'NotAllowedError')
          ) throw error
          link.focus()
          link.select()
        })
      }
    })().catch(show)
  })
  // Friends come from the person's yaks.app friend list, with their consent.
  friend.addEventListener('click', () => {
    void (async () => {
      let shown = await yaks.list()
      if (shown.kind == 'signed-out') {
        throw new RoomRefused('Sign in to invite friends.')
      }
      if (shown.kind == 'ask') return location.assign(shown.allow)
      if (!shown.friends.length) {
        throw new RoomRefused('No friends on yaks.app yet.')
      }
      friends.replaceChildren(
        new Option('Choose a friend', ''),
        ...shown.friends.map((f) => new Option(f.name, f.person)),
      )
      friends.hidden = false
      friends.focus()
    })().catch(show)
  })
  friends.addEventListener('change', () => {
    let to = friends.value
    if (!to) return
    void (async () => {
      let url = await invite()
      await yaks.invite(to, 'room' + url.search + url.hash)
      status.textContent = `Invited ${friends.selectedOptions[0].text}.`
      friends.hidden = true
    })().catch(show)
  })
  let eid = motionId(member)
  canvas.addEventListener('pointermove', (event) => {
    if (!watch.ready) return
    let point = view.pick(event.clientX, event.clientY)
    if (!point || Math.abs(point.x) > 12 || Math.abs(point.z) > 12) return
    void Promise.resolve(front.mutate([{
      entity: { eid },
      play_motion: { room, seat, x: point.x, z: point.z },
    }])).catch(show)
  })
}

if (roomId(selected)) {
  void postRoom<Joined>(roomPath(selected) + 'join', { invite: invitation })
    .then(playRoom).catch(show)
} else {
  status.textContent = 'Host a room and invite a friend.'
  host.hidden = false
}
host.addEventListener('click', () => {
  host.disabled = true
  void postRoom<Joined>('rooms').then(playRoom).catch(show).finally(() => {
    host.disabled = false
  })
})
