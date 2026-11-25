import { run } from './yak.js'

// The reading line moves through the feature sections. The chosen example
// answers at that same point, so changing examples leaves the reader in place.
let clamp = (n) => Math.max(0, Math.min(1, n))

/** A step and the fraction of it above the reading line. */
export let reading = (rects, line) => {
  let step = Math.max(0, rects.findLastIndex((r) => r.top <= line))
  let { top, bottom } = rects[step]
  return { step, through: clamp((line - top) / Math.max(1, bottom - top)) }
}

/** Where a step stands to the reading line, and how much of it is read. */
export let stance = (turn, { step, through }) =>
  turn < step ? ['past', 1] : turn > step ? ['next', 0] : ['now', through]

const REVEAL = .6

/** Lines share the first 60% of their turn. Each starts just after the previous line finishes. */
export let progress = (turn, line, count, { step, through }) => {
  if (turn == 0 || turn < step) return 1
  if (turn > step) return 0
  return clamp((through * count / REVEAL - line) / .8)
}

let messages = (log) =>
  [...log.querySelectorAll('[data-line]')].map((el) => {
    let { turn, line, count } = el.dataset
    return { el, turn: Number(turn), line: Number(line), count: Number(count) }
  })

let reveal = (lines, at, calm) => {
  for (let { el, turn, line, count } of lines) {
    let v = progress(turn, line, count, at)
    let hidden = v == 0
    if (el.hidden != hidden) el.hidden = hidden
    if (hidden) continue
    el.style.setProperty('--v', calm ? 1 : v)
    el.style.setProperty('--sat', Math.max(.25, 1 - (at.step - turn) * .24))
  }
}

// Ink depends on a section's stance. Only its illustration inherits the
// continuously changing --v, so scrolling doesn't restyle the whole section.
let mark = (steps, at) =>
  steps.forEach(({ el, art }, turn) => {
    let [state, v] = stance(turn, at)
    if (el.dataset.state != state) el.dataset.state = state
    art?.style.setProperty('--v', v.toFixed(3))
  })

let swipe = (old, log, backwards) => {
  let ghost = old.cloneNode(true)
  ghost.removeAttribute('data-conversation')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  let x = backwards ? '-100%' : '100%'
  let timing = { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' }
  log.parentElement.append(ghost)
  ghost.animate([{ translate: '0' }, { translate: `calc(-1 * ${x})` }], timing)
    .finished.finally(() => ghost.remove())
  log.animate([{ translate: x }, { translate: '0' }], timing)
}

let navigation = (track, links) => {
  let current = track.querySelector('[aria-current]')
  let edges = () => {
    track.toggleAttribute('data-earlier', track.scrollLeft > 1)
    track.toggleAttribute(
      'data-later',
      track.scrollLeft + track.clientWidth < track.scrollWidth - 1,
    )
  }
  let position = () => {
    track.style.setProperty('--jump-left', `${current.offsetLeft}px`)
    track.style.setProperty('--jump-width', `${current.offsetWidth}px`)
  }
  let resized = new ResizeObserver(() => (position(), edges()))
  resized.observe(track)
  for (let link of links) resized.observe(link)
  track.addEventListener('scroll', edges, { passive: true })
  return (link, motion) => {
    current?.removeAttribute('aria-current')
    current = link
    link.setAttribute('aria-current', 'location')
    position()
    track.dataset.highlight = motion ? 'smooth' : ''
    track.scrollTo({
      left: link.offsetLeft - (track.clientWidth - link.offsetWidth) / 2,
      behavior: motion ? 'smooth' : 'instant',
    })
    edges()
  }
}

let mascot = (root, calm, narrow) => {
  let slot = root.querySelector('[data-wander]')
  let rest = '/mascot/idle-rest-128-1x.webp'
  let beside = new Image()
  beside.alt = ''
  beside.className = 'Home_WanderPose'
  let seated, section, shown, timer
  let paint = (name) => {
    let path = name && `/home-mascot/${name}.webp`
    if (shown) shown.src = rest, shown = undefined
    if (path && narrow.matches) {
      shown = section.querySelector('[data-section-yak]')
      shown.src = path
    }
    if (seated) {
      beside.toggleAttribute('data-ready', false)
      if (path && !narrow.matches) {
        seated.append(beside)
        beside.src = path
        beside.toggleAttribute(
          'data-ready',
          beside.complete && beside.naturalWidth > 0,
        )
      } else beside.remove()
    }
  }
  let update = () => {
    clearTimeout(timer)
    let [first, second] = section?.dataset.storyPose?.split(' ') ?? []
    if (calm.matches || !(narrow.matches || seated)) return paint()
    paint(first)
    if (second) timer = setTimeout(() => paint(second), 3300)
  }
  beside.addEventListener('load', () => beside.setAttribute('data-ready', ''))
  root.ownerDocument.addEventListener('sat', (e) => {
    seated = e.target
    update()
  }, true)
  root.ownerDocument.addEventListener('rise', () => {
    beside.remove()
    seated = undefined
    update()
  }, true)
  calm.addEventListener('change', update)
  narrow.addEventListener('change', update)
  return (step) => {
    section = step
    let perch = step.querySelector('[data-section-yak]')?.parentElement ?? null
    slot.dataset.wanderTo = perch?.id ?? ''
    slot.dispatchEvent(new CustomEvent('wander-to', { detail: perch }))
    update()
  }
}

let ideas = (root) => {
  let hero = root.querySelector('#say')
  let demo = root.querySelector('#example-say')
  for (let button of root.querySelectorAll('[data-service-idea]')) {
    button.addEventListener('click', () => {
      let r = demo.getBoundingClientRect()
      let box = button.closest('.Story_Hero') || !r.height || r.top < 0 ||
          r.bottom > innerHeight
        ? hero
        : demo
      if (!box.value) {
        box.value = `Make me an app that uses ${button.dataset.serviceIdea} to `
      }
      box.focus()
      box.setSelectionRange(box.value.length, box.value.length)
    })
  }
}

let copyLinks = (root) => {
  for (let button of root.querySelectorAll('[data-copy-link]')) {
    let box = button.closest('.Copy')
    button.addEventListener('click', async () => {
      let link = box.querySelector('.Copy_Text')
      try {
        await navigator.clipboard.writeText(link.textContent.trim())
        box.classList.add('Copy-copied')
        setTimeout(() => box.classList.remove('Copy-copied'), 1500)
      } catch {
        let range = document.createRange()
        range.selectNodeContents(link)
        getSelection()?.removeAllRanges()
        getSelection()?.addRange(range)
      }
    })
  }
}

let readingLine = () => innerHeight / 2

let jumpFromMessage = (e, steps, calm) => {
  if (
    e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey ||
    e.altKey
  ) return
  let message = e.target.closest('[data-line]')
  if (!message || e.target.closest('a:not(.Home_MessageLink)')) return
  let turn = Number(message.dataset.turn)
  let section = steps[turn]
  let top = turn
    ? section.getBoundingClientRect().top + scrollY +
      REVEAL * section.offsetHeight - readingLine()
    : 0
  e.preventDefault()
  scrollTo({ top, behavior: calm.matches ? 'instant' : 'smooth' })
}

let mount = (root) => {
  let demo = root.querySelector('[data-story-demo]')
  let picks = root.querySelector('[data-picks]')
  let pause = picks.querySelector('[data-pause]')
  let buttons = [...picks.querySelectorAll('[data-pick]')]
  let logs = [...demo.querySelectorAll('[data-conversation]')]
  let lines = logs.map(messages)
  let scenes = [...root.querySelectorAll('[data-demo-scene]')]
  let steps = [...root.querySelectorAll('[data-story-step]')]
  let illustrated = steps.map((el) => ({
    el,
    art: el.querySelector(
      ':scope > :is(.Home_Illustration, .Home_Connection, .Home_Scene)',
    ),
  }))
  let nav = root.querySelector('[data-feature-nav]')
  let contents = nav.parentElement
  let jumps = [...nav.querySelectorAll('[data-feature-link]')]
  let calm = matchMedia('(prefers-reduced-motion: reduce)')
  let narrow = matchMedia('(width < 64rem)')
  let i = 0, active = -1, frame = 0, timer = 0
  let playing = !calm.matches, hovered = false
  let highlight = navigation(nav, jumps)
  let pose = mascot(root, calm, narrow)

  let draw = (motion = !calm.matches) => {
    let rects = steps.map((el) => el.getBoundingClientRect())
    let at = reading(rects, readingLine())
    // Cover the features as they scroll under the tabs.
    contents.toggleAttribute(
      'data-cover',
      rects[1].top <= contents.getBoundingClientRect().bottom,
    )
    reveal(lines[i], at, calm.matches)
    mark(illustrated, at)
    demo.inert = narrow.matches && at.step == 0
    if (active == at.step) return
    active = at.step
    demo.dataset.turn = active
    highlight(jumps[active], motion)
    pose(steps[active])
    if (active > 0) hold()
  }
  let soon = () => frame ||= requestAnimationFrame(() => (frame = 0, draw()))
  let pick = (n, direction = n < i) => {
    if (n == i) return
    let old = logs[i]
    i = n
    let next = logs[i]
    let slug = next.dataset.conversation
    next.hidden = false
    draw(false)
    if (!calm.matches) swipe(old, next, direction)
    old.hidden = true
    buttons.forEach((button, at) =>
      button.setAttribute('aria-pressed', String(at == i))
    )
    for (let scene of scenes) scene.hidden = scene.dataset.demoScene != slug
  }
  let wait = () => {
    clearTimeout(timer)
    pause.hidden = calm.matches
    pause.setAttribute(
      'aria-label',
      `${playing ? 'Pause' : 'Play'} example rotation`,
    )
    pause.firstElementChild.textContent = playing ? 'Ⅱ' : '▶'
    if (
      playing && !document.hidden && !hovered && !demo.matches(':focus-within')
    ) {
      timer = setTimeout(
        () => (pick((i + 1) % logs.length, false), wait()),
        7500,
      )
    }
  }
  let hold = () => (playing = false, wait())

  // The published home app sets a base URL for shared assets. Keep jumps
  // in this document even when the visitor arrived with a query string.
  for (
    let link of document.querySelectorAll(
      '.Top a[href^="#"], [data-story] a[href^="#"]',
    )
  ) {
    link.href = location.pathname + location.search + link.getAttribute('href')
  }
  picks.hidden = false
  for (let [at, button] of buttons.entries()) {
    button.addEventListener('click', () => (hold(), pick(at)))
  }
  pause.addEventListener('click', () => (playing = !playing, wait()))
  let hover = (e) => {
    if (e.pointerType != 'mouse') return
    hovered = e.type == 'pointerenter'
    wait()
  }
  demo.addEventListener('pointerenter', hover)
  demo.addEventListener('pointerleave', hover)
  for (let event of ['focusin', 'focusout']) {
    demo.addEventListener(event, () => queueMicrotask(wait))
  }
  calm.addEventListener('change', () => (hold(), soon()))
  document.addEventListener('visibilitychange', wait)
  addEventListener('scroll', soon, { passive: true })
  addEventListener('resize', soon)
  new ResizeObserver(soon).observe(root)
  demo.addEventListener('click', (e) => jumpFromMessage(e, steps, calm))
  copyLinks(root)
  ideas(root)
  run(root)
  draw(false)
  wait()
}

if (typeof document != 'undefined') {
  for (let story of document.querySelectorAll('[data-story]')) mount(story)
}
