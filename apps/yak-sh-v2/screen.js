// The tube: what the manual pane shows, the status bar, and the tube's own
// moods: power, the phosphor's color, degaussing, and the afterglow a page
// leaves when the next one replaces it.

import { degauss as hum, thunk } from './sound.js'

let wait = (ms) => new Promise((r) => setTimeout(r, ms))

export let PHOSPHORS = ['green', 'amber', 'white']

let clock = () =>
  new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

// A man page's first and last lines: its name at both corners.
let rule = (cls, left, middle, right = left) => {
  let div = document.createElement('div')
  div.className = cls
  for (let text of [left, middle, right]) {
    let span = document.createElement('span')
    span.textContent = text
    div.append(span)
  }
  return div
}

/** The head a page is shown under: `YAK(1)  yaks manual  YAK(1)`. */
export let head = (title) => rule('Man_Head', title, 'yaks manual')

/** The foot: the release the page describes, and its name again. */
export let foot = (title) => rule('Man_Foot', 'yaks 0.2.2', 'yak.sh', title)

/** The tube over its elements: `crt` (power, phosphor, degauss), `panes`
 * (zoom), `man` and its title and hint, `ghost`, `bar`. */
export let tube = (els) => {
  let { crt, screen, panes, man, title, hint, ghost, bar } = els
  let state = { disk: '', code: 0, busy: false }

  // The phosphor holds the old picture for a moment after it changes.
  let afterglow = () => {
    if (crt.dataset.power != 'on') return
    let copy = panes.cloneNode(true)
    copy.removeAttribute('id')
    for (let node of copy.querySelectorAll('[id]')) node.removeAttribute('id')
    ghost.replaceChildren(copy)
    // A copy keeps no scroll, so every pane of it is scrolled to where the
    // one it copies stood, once it is shown.
    let was = panes.querySelectorAll('*')
    copy.querySelectorAll('*').forEach((node, i) => {
      if (was[i].scrollTop) node.scrollTop = was[i].scrollTop
    })
    ghost.classList.remove('is-fading')
    void ghost.offsetWidth
    ghost.classList.add('is-fading')
  }

  /** Show `nodes` in the manual pane, titled; `zoom` gives the pane the
   * screen's whole width. */
  let show = (nodes, { name, note = '', zoom = false } = {}) => {
    afterglow()
    man.replaceChildren(...nodes)
    man.scrollTop = 0
    title.textContent = name
    hint.textContent = note
    if (zoom) screen.dataset.zoom = ''
    else delete screen.dataset.zoom
    man.classList.remove('is-raster')
    void man.offsetWidth
    man.classList.add('is-raster')
  }

  let paint = () => {
    let cell = (text, bold) => {
      let span = document.createElement(bold ? 'b' : 'span')
      span.textContent = text
      return span
    }
    let fill = document.createElement('span')
    fill.className = 'Bar_Fill'
    bar.replaceChildren(
      cell('[yak.sh]', true),
      cell(`0:man${screen.dataset.zoom != null ? 'Z' : '*'} 1:graph 2:sh`),
      fill,
      cell(`fd0: ${state.disk || 'empty'}`),
      cell(state.busy ? '◉ busy' : state.code ? `exit ${state.code}` : '● ok'),
      cell(clock()),
    )
  }

  /** Change what the status bar says: `disk`, `code`, `busy`. */
  let status = (change) => {
    Object.assign(state, change)
    paint()
  }

  /** Turn the tube on (the warm-up) or off (the collapse, then the
   * afterglow's dot). Either may interrupt the other. */
  let power = async (on) => {
    if (on) {
      thunk()
      crt.dataset.power = 'warming'
      await wait(
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1250,
      )
      if (crt.dataset.power == 'warming') crt.dataset.power = 'on'
    } else {
      crt.dataset.power = 'dying'
      await wait(2600)
      if (crt.dataset.power == 'dying') crt.dataset.power = 'off'
    }
  }

  /** Whether the tube is lit, or coming up. */
  let lit = () => ['on', 'warming'].includes(crt.dataset.power)

  /** The next phosphor, or the one named. */
  let phosphor = (name) => {
    let now = crt.dataset.phosphor ?? 'green'
    let next = PHOSPHORS.includes(name)
      ? name
      : PHOSPHORS[(PHOSPHORS.indexOf(now) + 1) % PHOSPHORS.length]
    crt.dataset.phosphor = next
    crt.closest('.Desk').dataset.phosphor = next
    afterglow()
    return next
  }

  let degauss = async () => {
    hum()
    crt.dataset.degauss = ''
    await wait(1300)
    delete crt.dataset.degauss
  }

  setInterval(paint, 15_000)
  paint()
  return { show, status, power, lit, phosphor, degauss }
}
