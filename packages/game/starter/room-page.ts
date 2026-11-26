import { frames } from './frames.ts'
import {
  connectRoom,
  type Joined,
  postRoom,
  RoomRefused,
} from './room-client.ts'
import { motionId, roomId, roomPath, type Turn } from './room-model.ts'
import { roomView } from './room-view.ts'
import { screen } from './screen.ts'

let disposeScreen = screen()
let canvas = document.querySelector('canvas')!
let status = document.querySelector<HTMLElement>('#room-status')!
let host = document.querySelector<HTMLButtonElement>('#host')!
let share = document.querySelector<HTMLButtonElement>('#share')!
let link = document.querySelector<HTMLInputElement>('#invite-link')!
let actions = document.querySelector<HTMLFieldSetElement>('#actions')!
let roll = document.querySelector<HTMLElement>('#roll')!

let show = (error: unknown) => {
  status.textContent = error instanceof Error
    ? error.message
    : 'Room unavailable.'
  if (!(error instanceof RoomRefused)) reportError(error)
}

let selected = new URL(location.href).searchParams.get('room') ?? ''
let invitation = new URLSearchParams(location.hash.slice(1)).get('invite')
let remember = (room: string) => {
  let url = new URL(location.href)
  url.searchParams.set('room', room)
  url.hash = ''
  history.replaceState(null, '', url)
}

let playRoom = async (member: Joined) => {
  let { room, seat } = member
  let path = roomPath(room)
  host.hidden = true
  share.hidden = !member.host
  remember(room)
  let { front, watch } = await connectRoom(member, {
    report: ({ error, refused }) => {
      if (refused) show(new RoomRefused(refused.message))
      else if (error) show(error)
    },
  })
  let view: ReturnType<typeof roomView>
  try {
    view = roomView(canvas, member)
  } catch (error) {
    front.close()
    throw error
  }
  let turn = () =>
    watch.value.find((r) => r.entity.eid === room)?.play_turn as
      | Turn
      | undefined
  let render = () => {
    let current = turn()
    actions.disabled = !watch.ready || current?.seat !== seat
    status.textContent = watch.refused ??
      (!watch.ready
        ? 'Connecting…'
        : current?.seat === seat
        ? 'Your turn'
        : 'Waiting for your friend')
    roll.textContent = current?.roll ? `Last roll: ${current.roll}` : ''
  }
  watch.subscribe(render)
  render()
  actions.addEventListener('click', (event) => {
    let button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      'button',
    )
    let current = turn()
    if (!button || actions.disabled || !current) return
    let [dx, dz] = (button.dataset.move ?? '').split(',').map(Number)
    actions.disabled = true
    void postRoom(path + 'action', {
      number: current.number,
      kind: button.value,
      dx,
      dz,
    }).then(render, (error) => {
      render()
      show(error)
    })
  })
  share.addEventListener('click', () => {
    void (async () => {
      member.invite ??= (await postRoom<Joined>(path + 'invite')).invite
      let url = new URL('room', document.baseURI)
      url.searchParams.set('room', room)
      url.hash = new URLSearchParams({ invite: member.invite! }).toString()
      link.hidden = false
      link.value = url.href
      link.select()
      if (navigator.clipboard) await navigator.clipboard.writeText(url.href)
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
  frames((_now, dt) => view.draw(watch.value, dt), () => {
    disposeScreen()
    front.close()
    view.dispose()
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
