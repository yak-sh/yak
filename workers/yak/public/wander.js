// The home page's yak (index.html `[data-wander]`, T-141071). He is the logo:
// he sits in the hero and idles (idle.js). Scroll him out of view and, once
// the page has been still a moment, he scampers in from the edge of the
// window down the left margin, only as far as it takes to be back in frame,
// and plops down there to idle. Out of the hero he is placed on the page, so
// he scrolls with it like the words do; while he is in frame he stays put. Scroll
// back up to the hero and he scampers up the margin, away from you, steps
// into his place and plops there.
//
// He never covers words or controls: his lane is the strip left of every
// word, picture and control, measured on load and on resize. Where that
// strip is too narrow for him (a phone, a small window) he stays the logo,
// and so he does for anyone who asks their system for less motion.
//
// A click on him while he sits plays his nose lick.
//
// Every strip of frames is decoded before he first moves, and each one is a
// layer of its own, shown or hidden whole, so no frame waits on a picture.
{
  let slot = document.querySelector('[data-wander]')
  let still = slot?.querySelector('img')
  let calm = matchMedia('(prefers-reduced-motion: reduce)')
  let base = document.currentScript.src
  const STRIPS = ['down', 'up', 'plop'] // mascot/wander-<strip>-128.webp, six frames across
  const FRAMES = 6
  const MIN = 72, PAD = 12 // his smallest size in the margin, and his room from the words, in css px
  const FIG = [.1, .87] // the share of his frame his figure spans across, tail swish included
  const PACE = 240 // css px a second, whatever the scroll does
  const STEP = 16 // frames a second
  const DELAY = 900 // ms of a still page before he sets off

  // The part of a box its scrolling ancestors let show, across: a
  // carousel's cards scrolled out of view are not on the page.
  let clips = new Map()
  let clip = (el) => {
    if (!el || el == document.body) return [-Infinity, Infinity]
    if (!clips.has(el)) {
      let [lo, hi] = clip(el.parentElement)
      if (getComputedStyle(el).overflowX != 'visible') {
        let r = el.getBoundingClientRect()
        lo = Math.max(lo, r.left), hi = Math.min(hi, r.right)
      }
      clips.set(el, [lo, hi])
    }
    return clips.get(el)
  }

  // The left edge of the nearest word, picture or control, in css px.
  let edge = () => {
    let left = innerWidth
    clips.clear()
    let take = (r, el) => {
      let [lo, hi] = clip(el)
      let l = Math.max(r.left, lo)
      if (r.width && r.height && Math.min(r.right, hi) > Math.max(l, 0)) {
        left = Math.min(left, l)
      }
    }
    let words = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.data.trim() && !slot.contains(n) &&
          n.parentElement.checkVisibility?.() !== false
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    })
    let range = document.createRange()
    while (words.nextNode()) {
      range.selectNodeContents(words.currentNode)
      for (let r of range.getClientRects()) {
        take(r, words.currentNode.parentElement)
      }
    }
    let things =
      'img, svg, button, input, select, textarea, video, canvas, iframe, .Card'
    for (let el of document.querySelectorAll(things)) {
      if (!slot.contains(el) && el.checkVisibility?.() !== false) {
        take(el.getBoundingClientRect(), el.parentElement)
      }
    }
    return Math.max(0, left)
  }

  let start = async () => {
    let yak = document.createElement('div')
    yak.className = 'Wander'
    yak.setAttribute('aria-hidden', 'true')
    let strips = Object.fromEntries(STRIPS.map((name) => {
      let span = document.createElement('span')
      span.className = 'Wander_Strip'
      let img = document.createElement('img')
      let file = (d) => new URL(`mascot/wander-${name}-128${d}.webp`, base).href
      img.src = file('')
      img.srcset = `${file('-1x')} 1x, ${file('')} 2x, ${file('-3x')} 3x`
      img.alt = ''
      span.append(img)
      return [name, span]
    }))
    yak.append(still, ...Object.values(strips))
    slot.append(yak)
    await Promise.all(Object.values(strips).map((s) => s.firstChild.decode()))

    // His lane in the margin: his size, and the x that keeps his figure
    // clear of the words; size 0 when there is no room.
    let lane = { x: 0, size: 0 }
    let measure = () => {
      let right = edge() - PAD
      let size = Math.min(
        slot.offsetWidth,
        Math.floor((right - PAD) / (FIG[1] - FIG[0])),
      )
      lane = size < MIN ? { x: 0, size: 0 } : { x: right - size * FIG[1], size }
    }
    measure()
    addEventListener('resize', measure)
    addEventListener('load', measure)

    let shown = still
    still.dataset.on = ''
    let show = (layer, i = 0) => {
      if (layer != shown) {
        layer.dataset.on = '', delete shown.dataset.on, shown = layer
      }
      if (layer != still) layer.firstChild.style.marginLeft = `${-100 * i}%`
    }
    // a click on him while he sits plays his nose lick (idle.js)
    yak.addEventListener('click', () => {
      if (shown == still) {
        still.dispatchEvent(new CustomEvent('idle', { detail: 'lick' }))
      }
    })

    // where: 'home' (in the hero) or 'out' (in the margin)
    // act: 'sit', 'rise', 'walk', 'step' (into his place), 'plop'
    // x and y are his place on the page, not in the window, so the page
    // carries him as it scrolls and nothing has to chase the scroll
    let where = 'home',
      act = 'sit',
      size = 0,
      y = 0,
      x = 0,
      dir = 1,
      homing = false
    let phase = 0, last = 0, scrolled = -Infinity
    addEventListener('scroll', () => scrolled = performance.now(), {
      passive: true,
    })

    let out = () => {
      where = 'out', size = lane.size, x = lane.x + scrollX
      yak.classList.add('Wander-out')
      yak.style.width = yak.style.height = `${size}px`
      document.body.append(yak)
    }
    let home = () => {
      where = 'home', act = 'sit'
      yak.classList.remove('Wander-out')
      yak.style.transform = yak.style.width = yak.style.height = ''
      slot.append(yak)
      show(still)
    }
    let walk = (dt) => {
      phase += dt * STEP
      show(strips[dir > 0 ? 'down' : 'up'], Math.floor(phase) % FRAMES)
    }

    let tick = (now) => {
      requestAnimationFrame(tick)
      let dt = Math.min(.05, (now - last) / 1000 || 0)
      last = now
      let quiet = now - scrolled > DELAY
      let s = slot.getBoundingClientRect()
      let inView = s.bottom > 0 && s.top < innerHeight
      // the window's top and bottom, and his place in the hero, on the page
      let top = scrollY, bottom = scrollY + innerHeight
      let hx = s.left + scrollX, hy = s.top + scrollY
      // where he goes: his place, or the nearest spot in frame
      let target = () =>
        inView ? hy : Math.min(Math.max(y, top + PAD), bottom - size - PAD)

      if (where == 'home') {
        if (inView || !quiet || !lane.size) return
        // out of sight in the hero: he comes in from the window's edge nearest it
        out()
        y = s.bottom <= 0 ? top - size : bottom
        act = 'walk', phase = 0
      }
      if (!lane.size) return home()

      if (act == 'sit' && quiet && Math.abs(target() - y) > 1) {
        if (y <= top - size) y = top - size, act = 'walk'
        else if (y >= bottom) y = bottom, act = 'walk'
        else act = 'rise', phase = 0
      }
      if (act == 'rise') {
        phase += dt * STEP
        if (phase >= FRAMES) act = 'walk', phase = 0
        else show(strips.plop, FRAMES - 1 - Math.floor(phase))
      }
      if (act == 'walk') {
        let gap = target() - y
        if (Math.abs(gap) <= 1) act = inView ? 'step' : 'plop', phase = 0
        else {
          dir = Math.sign(gap)
          y += dir * Math.min(Math.abs(gap), PACE * dt)
          walk(dt)
        }
      }
      if (act == 'step') {
        // the last few steps sideways into his place, toward you
        let dx = hx - x, dy = hy - y, d = Math.hypot(dx, dy)
        if (d <= 1) {
          x = hx, y = hy, act = 'plop', phase = 0, homing = true
        } else {
          let k = Math.min(1, PACE * dt / d)
          x += dx * k, y += dy * k, dir = 1
          walk(dt)
        }
      }
      if (act == 'plop') {
        phase += dt * STEP * .6
        if (phase < FRAMES) show(strips.plop, Math.floor(phase))
        else if (homing) return homing = false, home()
        else act = 'sit', show(still)
      }
      yak.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }
    requestAnimationFrame(tick)
  }

  if (slot && still && !calm.matches) document.fonts.ready.then(start)
}
