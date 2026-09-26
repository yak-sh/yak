// The floppy drive, and a disk's trip between the shelf and it.
//
// A disk flies as a copy in the fly layer (disk.css `.Fly`), whose
// perspective looks down on the drive from above: it lifts off the shelf,
// comes to stand in front of the slot, tips back until it lies flat with its
// shutter at the slot, and is pushed in. Pushed in, it goes behind the face of
// the monitor, which from above means up past the slot's lip, and the layer is
// clipped there, so the disk disappears into the slot. Ejecting is the trip
// backwards, after the spring has kicked the disk a third of the way out.

import { clack, seek, spring } from './sound.js'

let wait = (ms) => new Promise((r) => setTimeout(r, ms))
let still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// How far the viewer's eye is above the slot, in disk heights: high enough to
// see the disk's face as it goes in.
let EYE = 4

// The poses of a trip, as transforms of a carrier whose origin is the middle
// of the disk's top edge, placed at the middle of the slot's lip. `shelf` is
// where the disk lies: that point's offset, and its tilt.
let poses = ({ x, y, tilt }, h) => ({
  shelf: `translate3d(${x}px, ${y}px, 0) rotateZ(${tilt})`,
  lifted: `translate3d(${x}px, ${y - h * .18}px, ${h * .5}px) rotateZ(${tilt})`,
  front: `translate3d(0, ${h * .12}px, ${
    h * .7
  }px) rotateX(-6deg) rotateZ(0deg)`,
  tipping: `translate3d(0, ${h * .08}px, ${h * .25}px) rotateX(62deg)`,
  lip: `translate3d(0, 0, 0) rotateX(86deg)`,
  kicked: `translate3d(0, 0, ${-h * .36}px) rotateX(86deg)`,
  inside: `translate3d(0, 0, ${-h * 1.05}px) rotateX(86deg)`,
})

// A trip as keyframes: [offset, pose, easing of the leg after it].
let legs = (p, steps) =>
  steps.map(([offset, pose, easing = 'ease-in-out']) => ({
    offset,
    transform: p[pose],
    easing,
  }))

let IN = [
  [0, 'shelf', 'cubic-bezier(.45, 0, .2, 1)'],
  [.14, 'lifted', 'cubic-bezier(.3, 0, .2, 1)'],
  [.52, 'front', 'cubic-bezier(.4, 0, .6, 1)'],
  [.7, 'tipping', 'cubic-bezier(.5, 0, .1, 1)'],
  [.78, 'lip', 'cubic-bezier(.6, 0, .3, 1)'],
  [1, 'inside'],
]

let OUT = [
  [0, 'inside', 'cubic-bezier(.1, .9, .3, 1)'],
  [.1, 'kicked', 'ease-out'],
  [.24, 'kicked', 'cubic-bezier(.5, 0, .4, 1)'],
  [.36, 'lip', 'ease-in-out'],
  [.46, 'tipping', 'ease-out'],
  [.62, 'front', 'cubic-bezier(.4, 0, .2, 1)'],
  [.88, 'lifted', 'ease-in'],
  [1, 'shelf'],
]

/**
 * The drive over its elements: `drive` (whose `data-state` is empty, open,
 * busy or loaded), `slot`, `eject` (the button), `fly` (the layer a disk
 * flies in) and `shelf` (where the disks lie).
 */
export let floppy = ({ drive, slot, eject, fly, shelf }) => {
  let inside = null
  let moving = Promise.resolve()

  let disk = (id) => shelf.querySelector(`.Disk[data-disk="${id}"]`)

  // A copy of the disk to fly, placed with the middle of its top edge at the
  // middle of the slot's lip, and the pose it starts in, on the shelf.
  let launch = (source) => {
    let s = slot.getBoundingClientRect()
    let h = source.offsetHeight
    let box = document.createElement('div')
    box.className = 'Fly_Carrier'
    box.style.left = `${s.left + s.width / 2 - source.offsetWidth / 2}px`
    box.style.top = `${s.top + s.height / 2}px`
    let copy = source.cloneNode(true)
    for (let a of ['href', 'data-out', 'id']) copy.removeAttribute(a)
    box.append(copy)
    fly.style.perspectiveOrigin = `${s.left + s.width / 2}px ${
      s.top - h * EYE
    }px`
    fly.replaceChildren(box)
    let r = source.getBoundingClientRect()
    let tilt = getComputedStyle(source).getPropertyValue('--tilt').trim() ||
      '0deg'
    let shelf = {
      x: r.left + r.width / 2 - (s.left + s.width / 2),
      y: r.top + r.height / 2 - h / 2 - (s.top + s.height / 2),
      tilt,
    }
    return { box, pose: poses(shelf, h), lip: s.top + s.height * .45 }
  }

  let clip = (lip) =>
    fly.style.clipPath = lip == null ? '' : `inset(${lip}px 0 0 0)`

  let animate = (box, frames, duration) =>
    box.animate(frames, { duration, fill: 'forwards' }).finished

  let seated = () => {
    drive.dataset.state = 'loaded'
    eject.disabled = false
  }

  let insertNow = async (id, fast) => {
    if (inside == id) return false
    if (inside) await out(fast)
    let source = disk(id)
    if (!source) return false
    inside = id
    source.dataset.out = ''
    if (fast || still()) return (seated(), true)
    let trip = launch(source)
    let duration = 1500
    let flight = animate(trip.box, legs(trip.pose, IN), duration)
    await wait(duration * .74)
    clip(trip.lip)
    drive.dataset.state = 'open'
    await wait(duration * .12)
    clack()
    await flight
    fly.replaceChildren()
    clip(null)
    seated()
    return true
  }

  let out = async (fast) => {
    let id = inside
    let source = disk(id)
    inside = null
    eject.disabled = true
    eject.classList.add('is-pressed')
    setTimeout(() => eject.classList.remove('is-pressed'), 160)
    if (fast || still() || !source) {
      if (source) delete source.dataset.out
      drive.dataset.state = 'empty'
      return id
    }
    await wait(110)
    spring()
    let trip = launch(source)
    clip(trip.lip)
    let duration = 1500
    let flight = animate(trip.box, legs(trip.pose, OUT), duration)
    await wait(duration * .36)
    clip(null)
    drive.dataset.state = 'empty'
    await flight
    delete source.dataset.out
    fly.replaceChildren()
    return id
  }

  /** Slide the disk `id` into the drive, ejecting whatever is in it first;
   * the answer resolves once it is seated. `fast` skips the trip, for a page
   * that opens with a disk already in. */
  let insert = (id, { fast = false } = {}) =>
    moving = moving.then(() => insertNow(id, fast))

  /** Eject the disk in the drive; the answer is its id once it is back on
   * the shelf, or null when the drive was empty. */
  let ejected = ({ fast = false } = {}) =>
    moving = moving.then(() => inside ? out(fast) : null)

  /** Light the drive's busy lamp and seek, for about `ms`. */
  let read = async (ms = 900) => {
    drive.dataset.state = 'busy'
    seek(Math.round(ms / 60), ms / 1000)
    await wait(ms)
    if (inside) drive.dataset.state = 'loaded'
  }

  return { insert, eject: ejected, read, inside: () => inside }
}
