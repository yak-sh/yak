// The sky behind the home page's hero (site/sky.tsx draws it, style.css
// `.Sky` lays it out).
//
// The scene is laid out from five lengths measured here and set on it: --u,
// a 128th of his slot; --x and --feet, the middle of his figure and the line
// he sits on, on the page (<.Sky data-sink> of his units above the bottom of
// his hooves); --rule and --rule2, the pencil lines above and below the
// section after the hero.
//
// At dusk, birds fly by now and then (<.Sky data-birds="most lo hi low
// high">: how many in a flock at most, the seconds between flocks, and how
// high they fly, in his units above his hooves). When he sits down out in
// the margin (wander.js `sat`) he holds up the Start Free button.
//
// A touch on the sky: the sun sinks behind the hills and comes back up, the
// moon turns through its phases (<.Sky data-phases>, its shapes), stars
// brighten as a pointer passes them, and a tap on the night sky sends a
// shooting star from there. A touch on words or a control is the page's, not
// the sky's. For anyone who asks for less motion nothing in the sky moves or
// brightens: the moon still turns, at once, and that is all. He sits as the
// logo then, with the button beside him.
{
  let slot = document.querySelector('.Hello_Yak')
  let after = document.querySelector('.Yours')
  let sky = document.querySelector('.Sky')
  let calm = matchMedia('(prefers-reduced-motion: reduce)')
  let dark = matchMedia('(prefers-color-scheme: dark)')
  let sink = Number(sky?.dataset.sink ?? 0)

  let place = () => {
    let r = slot.getBoundingClientRect(), n = after.getBoundingClientRect()
    let set = (name, px) => sky.style.setProperty(name, px.toFixed(2) + 'px')
    set('--u', r.width / 128)
    set('--x', r.left + scrollX + r.width * .52)
    set('--feet', r.top + scrollY + r.height * .89 - sink * r.width / 128)
    set('--rule', n.top + scrollY + 1)
    set('--rule2', n.bottom + scrollY - .5)
  }
  if (slot && after && sky) {
    place()
    new ResizeObserver(place).observe(document.body)
    document.fonts?.ready.then(place)
    addEventListener('load', place)
  }

  let between = (lo, hi) => lo + Math.random() * (hi - lo)
  let BIRD =
    '<svg viewBox="-10 -4 20 8" width="20" height="8"><path d="M-9 3Q-4.5 -3 0 2Q4.5 -3 9 3"/></svg>'
  let [most, lo, hi, low, high] = (sky?.dataset.birds ?? '').split(' ').map(
    Number,
  )

  let fly = () => {
    let r = slot.getBoundingClientRect()
    let u = r.width / 128
    let feet = r.top + scrollY + r.height * .89
    let y = feet - u * between(low, high)
    // only at dusk, while the sky is in view, and the tab is
    if (
      document.hidden || dark.matches || y < scrollY - 40 ||
      y > scrollY + innerHeight
    ) return
    let flock = document.createElement('div')
    flock.className = 'Birds'
    flock.setAttribute('aria-hidden', 'true')
    let n = 1 + Math.floor(Math.random() * most)
    for (let i = 0; i < n; i++) {
      let b = document.createElement('span')
      b.className = 'Bird'
      b.innerHTML = BIRD
      // a loose V behind the first, each a little smaller and out of step
      let side = i % 2 ? 1 : -1, rank = Math.ceil(i / 2)
      let s = u * (1 - .08 * i) * (.9 + Math.random() * .2)
      b.style.left = -rank * 26 * u + 'px'
      b.style.top = side * rank * 11 * u + (Math.random() - .5) * 6 * u + 'px'
      b.style.scale = s
      b.firstChild.style.animationDelay = -Math.random() * 2.6 + 's'
      b.firstChild.style.animationDuration = 2.3 + Math.random() * .7 + 's'
      b.style.animationDelay = -Math.random() * 3 + 's'
      flock.append(b)
    }
    flock.style.top = y + 'px'
    document.body.append(flock)
    let right = Math.random() < .7
    let from = right ? -60 * u : innerWidth + 140 * u
    let to = right ? innerWidth + 140 * u : -60 * u
    let rise = (Math.random() - .6) * 40 * u
    if (!right) flock.style.scale = '-1 1'
    flock.animate(
      [{ translate: from + 'px 0' }, { translate: to + 'px ' + rise + 'px' }],
      {
        duration: Math.abs(to - from) / (55 * Math.max(u, .7)) * 1000,
        easing: 'linear',
      },
    ).onfinish = () => flock.remove()
  }
  let next = (wait) =>
    setTimeout(() => (fly(), next(between(lo, hi) * 1000)), wait)
  if (slot && sky && most && !calm.matches) next(between(3, 6) * 1000)

  // the button: brought out when he sits in the margin, put away when he
  // gets up or goes home
  let SIGN =
    '<span class="Sign"><a href="/login" class="Surface_Press Button Button-go Sign_Button" data-cta="yak">Start Free</a></span>'
  let sign
  addEventListener('sat', (e) => {
    if (!sign) {
      let t = document.createElement('template')
      t.innerHTML = SIGN
      sign = t.content.firstChild
    }
    e.target.append(sign)
    sign.dataset.out = ''
  }, true)
  // for anyone who asks for less motion he never walks: he sits as the logo
  // with the button already beside him, where there is room for it
  if (slot && calm.matches && matchMedia('(min-width: 40rem)').matches) {
    let t = document.createElement('template')
    t.innerHTML = SIGN
    slot.append(t.content.firstChild)
  }
  let away = () => sign && delete sign.dataset.out
  addEventListener('rise', away, true)
  addEventListener('home', away, true)

  // The sky's things where they are in the window: `at(x, y)` is a point in
  // his units, from the far scene's box.
  let far = sky?.querySelector('.Sky_Far')
  let at = (x, y) => {
    let b = far.getBoundingClientRect(), k = b.width / 6000
    return [b.left + (x + 3000) * k, b.top + (y + 800) * k, k]
  }
  let unit = ([px, py]) => {
    let b = far.getBoundingClientRect(), k = b.width / 6000
    return [(px - b.left) / k - 3000, (py - b.top) / k - 800]
  }
  let circle = (el) =>
    at(Number(el.getAttribute('cx')), Number(el.getAttribute('cy')))

  // what a touch at (px, py) lands on: the sun, the moon, or the sky; a
  // touch within a finger's width of either counts
  let sun = sky?.querySelector('.Sky_Sun')
  let moon = sky?.querySelector('.Sky_Moon')
  let halo = sky?.querySelector('.Sky_Halo')
  let near = (el, r, px, py) => {
    let [x, y, k] = circle(el)
    return Math.hypot(px - x, py - y) <= Math.max(r * k * 1.4, 22)
  }
  let over = (px, py) =>
    dark.matches
      ? near(halo, 24, px, py) && 'moon'
      : near(sun, 42, px, py) && 'sun'

  // a touch is the sky's when it lands on nothing of the page's: no control,
  // and no words of an element's own
  let CONTROLS = 'a, button, input, textarea, select, label, summary, ' +
    '[tabindex], [contenteditable], .Card, .Demo, .Wander'
  let page = (el) =>
    !el || el.closest?.(CONTROLS) ||
    [...el.childNodes].some((n) => n.nodeType == 3 && n.data.trim())

  // the moon's phases, a touch turning it to the next
  let phases = (sky?.dataset.phases ?? '').split('|'), phase = 0
  let turn = () => {
    let was = phases[phase]
    phase = (phase + 1) % phases.length
    moon.setAttribute('d', phases[phase])
    // the fuller the moon, the brighter its halo
    let full = phase / (phases.length / 2)
    sky.style.setProperty(
      '--halo',
      (.32 + .3 * Math.min(full, 2 - full)).toFixed(2),
    )
    if (!calm.matches) {
      moon.animate(
        [{ d: `path("${was}")` }, { d: `path("${phases[phase]}")` }],
        {
          duration: 900,
          easing: 'ease-in-out',
        },
      )
    }
  }

  // the sun sinks behind the hills and comes back up
  let setting
  let set = () => {
    if (setting) return
    let ease = { duration: 7000, easing: 'ease-in-out' }
    setting = sun.animate([
      { translate: '0 0' },
      { translate: '0 64px', offset: .4 },
      { translate: '0 64px', offset: .55 },
      { translate: '0 0' },
    ], ease)
    sky.querySelector('.Sky_Glow').animate([
      { opacity: 1 },
      { opacity: .4, offset: .4 },
      { opacity: .4, offset: .55 },
      { opacity: 1 },
    ], ease)
    setting.onfinish = () => setting = null
  }

  // a shooting star from (x, y), in his units, down and to the right
  let shoot = (x, y) => {
    let s = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    s.setAttribute('class', 'Sky_Shoot')
    for (
      let [k, v] of Object.entries({ x1: x, y1: y, x2: x + 40, y2: y + 15 })
    ) {
      s.setAttribute(k, v.toFixed(1))
    }
    sky.querySelector('.Sky_Night').append(s)
    s.animate([
      { opacity: 0, translate: '0 0' },
      { opacity: .9, offset: .15 },
      { opacity: 0, translate: '170px 62px' },
    ], { duration: 1100, easing: 'ease-out' }).onfinish = () => s.remove()
  }

  // the stars a pointer passes brighten, and dim again once it has gone
  let stars = [...(sky?.querySelectorAll('.Sky_Star') ?? [])]
  let lit = new Map()
  let pass = (px, py) => {
    let now = performance.now()
    for (let s of stars) {
      let [x, y] = circle(s)
      if (Math.hypot(px - x, py - y) > 48) continue
      if (!lit.has(s)) s.classList.add('Sky_Star-near')
      lit.set(s, now)
    }
    for (let [s, t] of lit) {
      if (now - t > 600) lit.delete(s), s.classList.remove('Sky_Star-near')
    }
  }
  let dim
  let brighten = (px, py) => {
    pass(px, py)
    clearTimeout(dim)
    dim = setTimeout(() => pass(-1e4, -1e4), 700)
  }

  if (sky && sun && moon && halo && far) {
    let frame = 0
    addEventListener('pointermove', (e) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        let on = !page(e.target) && over(e.clientX, e.clientY)
        if (on) sky.dataset.over = on
        else delete sky.dataset.over
        if (dark.matches && !calm.matches) brighten(e.clientX, e.clientY)
      })
    }, { passive: true })
    addEventListener('click', (e) => {
      if (page(e.target) || getSelection()?.toString()) return
      let on = over(e.clientX, e.clientY)
      if (on == 'moon') return turn()
      if (calm.matches) return
      if (on == 'sun') return set()
      let [x, y] = unit([e.clientX, e.clientY])
      if (dark.matches && y < -40 && y > -700) {
        brighten(e.clientX, e.clientY), shoot(x, y)
      }
    })
  }
}
