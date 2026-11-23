// The reading line moves through the feature sections. The chosen example
// answers at that same point, so changing examples leaves the reader in place.
let clamp = (n) => Math.max(0, Math.min(1, n))

/** A step and the fraction of it above the reading line. */
export let reading = (rects, line) => {
  let step = Math.max(0, rects.findLastIndex((r) => r.top <= line))
  let { top, bottom } = rects[step]
  return { step, through: clamp((line - top) / Math.max(1, bottom - top)) }
}

/** The opening exchange is already in the phone. Subsequent lines arrive
 * one at a time, in the first part of their feature section. */
export let visible = (turn, line, count, { step, through }) =>
  turn == 0 || turn < step || turn == step && through * count >= line * .6

let newestAt = (log) => (log.scrollTop = log.scrollHeight)

let reveal = (log, { step, through }, motion) => {
  let lines = [...log.querySelectorAll('[data-line]')]
  let count = lines.filter((el) => Number(el.dataset.turn) == step).length
  let before = lines.findLastIndex((el) => !el.hidden)
  let shown = lines.filter((el) => {
    let turn = Number(el.dataset.turn)
    el.hidden = !visible(turn, Number(el.dataset.line), count, {
      step,
      through,
    })
    if (!el.hidden) {
      el.style.setProperty('--sat', Math.max(.25, 1 - (step - turn) * .24))
    }
    return !el.hidden
  })
  if (shown.at(-1) === lines[before]) return
  newestAt(log)
  if (!motion || before < 0) return
  let entering = shown.slice(before + 1).filter((el) =>
    Number(el.dataset.turn) == step
  )
  for (let [i, el] of entering.entries()) {
    el.animate(
      [{ opacity: 0, translate: '0 .45rem' }, { opacity: 1, translate: '0 0' }],
      { duration: 320, delay: i * 55, easing: 'ease-out', fill: 'backwards' },
    )
  }
}

let swipe = (old, log, backwards) => {
  let ghost = old.cloneNode(true)
  ghost.removeAttribute('data-conversation')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  let x = backwards ? '-100%' : '100%'
  let timing = { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' }
  log.parentElement.append(ghost)
  ghost.scrollTop = old.scrollTop
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
      let box =
        button.closest('.Story_Hero') || r.top < 0 || r.bottom > innerHeight
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

let mount = (root) => {
  let showcase = root.querySelector('[data-showcase]')
  let demo = root.querySelector('[data-story-demo]')
  let picks = root.querySelector('[data-picks]')
  let pause = picks.querySelector('[data-pause]')
  let buttons = [...picks.querySelectorAll('[data-pick]')]
  let logs = [...demo.querySelectorAll('[data-conversation]')]
  let scenes = [...root.querySelectorAll('[data-demo-scene]')]
  let steps = [...root.querySelectorAll('[data-story-step]')]
  let nav = root.querySelector('[data-feature-nav]')
  let jumps = [...nav.querySelectorAll('[data-feature-link]')]
  let calm = matchMedia('(prefers-reduced-motion: reduce)')
  let narrow = matchMedia('(max-width: 59.99rem)')
  let i = 0, active = -1, frame = 0, timer = 0
  let showcaseHeight = 0
  let playing = !calm.matches
  let highlight = navigation(nav, jumps)
  let pose = mascot(root, calm, narrow)

  let draw = (motion = !calm.matches) => {
    let line = Math.min(innerHeight * .45, 250) + showcaseHeight / 2
    let at = reading(steps.map((el) => el.getBoundingClientRect()), line)
    reveal(logs[i], at, motion)
    if (active == at.step) return
    active = at.step
    highlight(jumps[active], motion)
    pose(steps[active])
    if (active > 0) hold()
  }
  let soon = () => frame ||= requestAnimationFrame(() => (frame = 0, draw()))
  let sized = () => {
    showcaseHeight = showcase.offsetHeight
    root.style.setProperty('--showcase-height', `${showcaseHeight}px`)
  }
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
    if (playing && !document.hidden && !demo.matches(':hover, :focus-within')) {
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
  for (let event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) {
    demo.addEventListener(event, () => queueMicrotask(wait))
  }
  calm.addEventListener('change', hold)
  document.addEventListener('visibilitychange', wait)
  addEventListener('scroll', soon, { passive: true })
  addEventListener('resize', soon)
  new ResizeObserver(() => (sized(), soon())).observe(showcase)
  let resized = new ResizeObserver((entries) => {
    for (let { target } of entries) newestAt(target.parentElement)
  })
  for (let log of logs) resized.observe(log.firstElementChild)
  copyLinks(root)
  ideas(root)
  sized()
  draw(false)
  wait()
}

if (typeof document != 'undefined') {
  for (let story of document.querySelectorAll('[data-story]')) mount(story)
}
