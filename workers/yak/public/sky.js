// The sky behind the home page's hero (site/sky.tsx draws it, style.css
// `.Sky` lays it out).
//
// The scene is laid out from five lengths measured here and set on it: --u,
// a 128th of his slot; --x and --feet, the middle of his figure and the line
// he sits on, on the page (<.Sky data-sink> of his units above the bottom of
// his hooves); --rule and --rule2, the pencil lines above and below the
// section after the hero. A sixth, --scroll, is how far the page has
// scrolled, in his units, set on the hills: the farther a range, the more of
// it sinks behind the line as the page goes up.
//
// At dusk, birds fly by now and then (<.Sky data-birds="most lo hi low
// high">: how many in a flock at most, the seconds between flocks, and how
// high they fly, in his units above the line). At night a shooting star
// crosses now and then (<.Sky data-shoot="lo hi">, the seconds between
// them). When he sits down out in the margin (wander.js `sat`) he holds up
// the Start Free button, slid along its post to stay in the window, and he
// lowers it as he gets up (`rise`), before he walks.
//
// A touch on the sky: the sun sinks behind the hills and comes back up, the
// moon turns through its phases (<.Sky data-phases>, its shapes), stars
// brighten as a pointer passes them, and a tap on the night sky sends a
// shooting star through it from beyond the window's edge. A touch on words
// or a control is the page's, not the sky's. For anyone who asks for less
// motion nothing in the sky moves or brightens: a few birds hang in the
// dusk, the moon still turns, at once, and that is all. He sits as the logo
// then, with the button beside him.
{
  let slot = document.querySelector('.Hello_Yak')
  let after = document.querySelector('.Yours')
  let sky = document.querySelector('.Sky')
  let calm = matchMedia('(prefers-reduced-motion: reduce)')
  let dark = matchMedia('(prefers-color-scheme: dark)')
  let sink = Number(sky?.dataset.sink ?? 0)

  let between = (lo, hi) => lo + Math.random() * (hi - lo)
  let n1 = (v) => v.toFixed(1)
  // `f` now and then: every `lo` to `hi` seconds, first after `wait`
  let often = (f, lo, hi, wait = between(lo, hi)) =>
    setTimeout(() => (f(), often(f, lo, hi)), wait * 1000)

  let hills = sky?.querySelector('.Sky_Hills')
  let u = 1
  let scroll = () => hills.style.setProperty('--scroll', n1(scrollY / u) + 'px')
  let place = () => {
    let r = slot.getBoundingClientRect(), n = after.getBoundingClientRect()
    let set = (name, px) => sky.style.setProperty(name, px.toFixed(2) + 'px')
    u = r.width / 128
    set('--u', u)
    set('--x', r.left + scrollX + r.width * .52)
    set('--feet', r.top + scrollY + r.height * .89 - sink * u)
    set('--rule', n.top + scrollY + 1)
    set('--rule2', n.bottom + scrollY - .5)
    scroll()
  }
  if (slot && after && sky) {
    place()
    new ResizeObserver(place).observe(document.body)
    document.fonts?.ready.then(place)
    addEventListener('load', place)
    addEventListener('scroll', scroll, { passive: true })
  }

  // The sky's things where they are in the window: `at(x, y)` is a point in
  // his units, from the far scene's box, and `unit` the other way.
  let far = sky?.querySelector('.Sky_Far')
  let at = (x, y) => {
    let b = far.getBoundingClientRect(), k = b.width / 6000
    return [b.left + (x + 3000) * k, b.top + (y + 800) * k, k]
  }
  let unit = ([px, py]) => {
    let b = far.getBoundingClientRect(), k = b.width / 6000
    return [(px - b.left) / k - 3000, (py - b.top) / k - 800]
  }
  // a shape of the sky's, drawn into one of its groups
  let draw = (name, attrs, into) => {
    let el = document.createElementNS('http://www.w3.org/2000/svg', name)
    for (let [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    into.append(el)
    return el
  }

  // A bird is one filled shape, drawn again every frame from a small model
  // of one seen from ahead of it and below: x along its body, y up, z along
  // its wings toward us, in his units. `see` is where a point of it lands.
  const YAW = .95, UNDER = .26
  let see = ([x, y, z]) => {
    let deep = x * Math.sin(YAW) + z * Math.cos(YAW)
    return [x * Math.cos(YAW) - z * Math.sin(YAW), deep * Math.sin(UNDER) - y]
  }
  let pt = ([x, y]) => n1(x) + ' ' + n1(y)
  // the curve from a to b that passes through m
  let via = (a, m, b) =>
    `Q${pt([0, 1].map((i) => 2 * m[i] - (a[i] + b[i]) / 2))} ${pt(b)}`
  // a wing on side `s` (1 is the one nearer us), its arm raised `a` and its
  // hand `b`: the leading edge out through the wrist to the tip, and the
  // trailing edge back
  let wing = (s, a, b) => {
    let S = [1.2, .3, s * .6]
    let W = [S[0] + .9, S[1] + 5 * Math.sin(a), S[2] + s * 5 * Math.cos(a)]
    let T = [W[0] - 2.8, W[1] + 6.5 * Math.sin(b), W[2] + s * 6.5 * Math.cos(b)]
    let [p, w, t, v, q] = [S, W, T, [W[0] - 2.6, W[1], W[2]], [
      S[0] - 3.4,
      S[1],
      S[2],
    ]].map(see)
    return `M${pt(p)}${via(p, w, t)}${via(t, v, q)}Z`
  }
  let [TAIL, HEAD] = [[-3.6, 0, 0], [3.8, 0, 0]].map(see)
  let round = `A${
    n1(Math.hypot(HEAD[0] - TAIL[0], HEAD[1] - TAIL[1]) / 2)
  } 1.1 ${
    n1(Math.atan2(HEAD[1] - TAIL[1], HEAD[0] - TAIL[0]) * 180 / Math.PI)
  } 0 1 `
  const BODY = `M${pt(TAIL)}${round}${pt(HEAD)}${round}${pt(TAIL)}Z`

  // A bird beats its wings a few times and glides: how it holds its arm and
  // its hand `t` seconds in, the hand a little behind the arm, and how far
  // the beat has dropped its body.
  let hold = (b, t) => {
    let flap = b.beats * b.beat, at = (t + b.lead) % (flap + b.glide)
    let e = at < flap
      ? Math.min(1, 2 * at / b.beat, 2 * (flap - at) / b.beat)
      : 0
    e *= e * (3 - 2 * e)
    let turn = 2 * Math.PI * at / b.beat
    let arm = .3 + e * .6 * Math.sin(turn)
    return [
      arm,
      arm - .42 + e * .5 * Math.sin(turn - 1.1),
      e * 1.2 * Math.sin(turn),
    ]
  }
  // the bird at (x, y), headed `dir` (1 to the right) with its nose `lean`
  // degrees down
  let pose = (b, t, x, y, dir = 1, lean = 0) => {
    let [arm, hand, drop] = hold(b, t)
    b.el.setAttribute('d', wing(-1, arm, hand) + BODY + wing(1, arm, hand))
    b.el.setAttribute(
      'transform',
      `translate(${n1(x)} ${n1(y + drop)}) rotate(${n1(dir * lean)}) scale(${
        n1(dir * b.size)
      } ${n1(b.size)})`,
    )
  }

  // a loose V behind the first bird, each one farther back a little smaller,
  // fainter and out of step
  let roost = sky?.querySelector('.Sky_Birds')
  let [most, lo, hi, low, high] = (sky?.dataset.birds ?? '').split(' ').map(
    Number,
  )
  let flock = (n) =>
    Array.from({ length: n }, (_, i) => {
      let side = i % 2 ? 1 : -1, rank = Math.ceil(i / 2)
      return {
        el: draw('path', { class: 'Sky_Bird', opacity: 1 - .07 * rank }, roost),
        back: rank * between(20, 27),
        off: side * rank * between(8, 12),
        size: (1.25 - .07 * i) * between(.9, 1.1),
        beat: between(.42, .52),
        beats: 3 + Math.floor(Math.random() * 4),
        glide: between(.8, 2.2),
        lead: between(0, 5),
        sway: between(0, 6.3),
      }
    })

  // A flock crosses the window along one long swell of a path, each bird
  // following the first along it and wandering a little in its place.
  let fly = () => {
    let [x0, top] = unit([0, 0]), [x1, bottom] = unit([innerWidth, innerHeight])
    let y0 = -between(low, high)
    // only at dusk, while the sky is in view, and the tab is
    if (document.hidden || dark.matches || y0 < top || y0 > bottom) return
    let dir = Math.random() < .7 ? 1 : -1
    let birds = flock(1 + Math.floor(Math.random() * most))
    let from = dir > 0 ? x0 - 30 : x1 + 30, way = x1 - x0 + 160
    let speed = between(46, 60), climb = between(-24, 16) / way
    let swell = between(0, 6.3)
    let t = 0, last
    let frame = (now) => {
      t += Math.min(now - (last ?? now), 50) / 1000
      last = now
      if (speed * t > way) return birds.forEach((b) => b.el.remove())
      for (let b of birds) {
        let gone = speed * t - b.back + 3 * Math.sin(t / 1.3 + b.sway)
        let wave = gone / 90 + swell
        pose(
          b,
          t,
          from + dir * gone,
          y0 + b.off + climb * gone + 5 * Math.sin(wave) +
            2 * Math.sin(t / 1.7 + 2 * b.sway),
          dir,
          Math.atan(climb + Math.cos(wave) / 18) * 180 / Math.PI,
        )
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }
  if (slot && roost && most) {
    // for anyone who asks for less motion, a few hang in the dusk instead
    if (calm.matches) {
      for (let b of flock(4)) pose(b, 0, 150 - b.back, -230 + b.off)
    } else often(fly, lo, hi, between(3, 6))
  }

  // the button: brought out when he sits in the margin, lowered when he
  // gets up, and gone when he is home
  let SIGN =
    '<span class="Sign"><a href="/login" class="Surface_Press Button Button-go Sign_Button" data-cta="yak">Start Free</a></span>'
  let EDGE = 8 // css px the button keeps from the window's sides
  let sign
  addEventListener('sat', (e) => {
    if (!sign) {
      let t = document.createElement('template')
      t.innerHTML = SIGN
      sign = t.content.firstChild
    }
    e.target.append(sign)
    delete sign.dataset.away
    sign.dataset.out = ''
    // it stands centred over him, slid along so all of it is in the window
    // and clear of the words (e.detail, where they begin); where the margin
    // is narrower than it, its words stack, Start over Free
    let r = e.target.getBoundingClientRect(), mid = r.left + r.width / 2
    let lo = EDGE, hi = Math.min(innerWidth, e.detail ?? innerWidth) - EDGE
    delete sign.dataset.narrow
    if (sign.offsetWidth > hi - lo) sign.dataset.narrow = ''
    let w = sign.offsetWidth, at = mid - w / 2
    let shift = Math.max(lo, Math.min(at, hi - w)) - at
    sign.style.setProperty('--shift', `${shift.toFixed(1)}px`)
  }, true)
  // for anyone who asks for less motion he never walks: he sits as the logo
  // with the button already beside him, where there is room for it
  if (slot && calm.matches && matchMedia('(min-width: 40rem)').matches) {
    let t = document.createElement('template')
    t.innerHTML = SIGN
    slot.append(t.content.firstChild)
  }
  let lower = () => {
    if (sign?.dataset.out == null) return
    delete sign.dataset.out
    sign.dataset.away = ''
  }
  addEventListener('rise', lower, true)
  addEventListener('home', () => {
    if (sign) delete sign.dataset.out, delete sign.dataset.away
  }, true)

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

  // A shooting star from one point to another, in his units: its head runs
  // the way, its tail growing behind it and drawn back in as it burns out.
  let night = sky?.querySelector('.Sky_Night')
  let shoot = ([x, y], [x2, y2], size = 1) => {
    let way = Math.hypot(x2 - x, y2 - y) / size
    let turn = Math.atan2(y2 - y, x2 - x) * 180 / Math.PI
    let star = draw('g', {
      class: 'Sky_Shoot',
      transform: `translate(${n1(x)} ${n1(y)}) rotate(${n1(turn)}) scale(${
        n1(size)
      })`,
    }, night)
    let run = draw('g', { class: 'Sky_Run' }, star)
    let tail = draw('path', {
      class: 'Sky_Tail',
      fill: 'url(#Sky-tail)',
      d: 'M0 -1.3L-130 0L0 1.3Z',
    }, run)
    draw('circle', { class: 'Sky_Flare', fill: 'url(#Sky-halo)', r: 8 }, run)
    draw('circle', { class: 'Sky_Head', r: 1.5 }, run)
    let duration = Math.min(Math.max(way / .85, 550), 1300)
    tail.animate([
      { transform: 'scaleX(0)' },
      { transform: 'scaleX(1)', offset: .35 },
      { transform: 'scaleX(1)', offset: .65 },
      { transform: 'scaleX(0)' },
    ], duration)
    run.animate([
      { opacity: 0, translate: '0 0' },
      { opacity: 1, offset: .12 },
      { opacity: 1, offset: .7 },
      { opacity: 0, translate: n1(way) + 'px 0' },
    ], { duration, easing: 'cubic-bezier(.25, .5, .45, 1)' }).onfinish = () =>
      star.remove()
  }
  // one that falls through (px, py) in the window: from beyond the window's
  // edge, through the point, and on a way
  let through = (px, py) => {
    let fall = between(.35, .8), dir = Math.random() < .5 ? 1 : -1
    let dx = dir * Math.cos(fall), dy = Math.sin(fall)
    let back = 30 +
      Math.min(py / dy, (dir > 0 ? px : innerWidth - px) / Math.cos(fall))
    let on = Math.max(back * between(.4, .7), 140)
    shoot(
      unit([px - dx * back, py - dy * back]),
      unit([px + dx * on, py + dy * on]),
    )
  }
  // and one of its own now and then, somewhere above the hills, while the
  // night sky is in view and the tab is
  let wish = () => {
    let [x0, top] = unit([0, 0]), [x1] = unit([innerWidth, 0])
    if (document.hidden || !dark.matches || top > -240) return
    let fall = between(.3, .75), dir = Math.random() < .5 ? 1 : -1
    let way = between(200, 420), wide = x1 - x0
    let x = between(x0 + wide * .1, x1 - wide * .1)
    let y = between(Math.max(top, -780) + 15, -200)
    shoot(
      [x, y],
      [x + dir * way * Math.cos(fall), y + way * Math.sin(fall)],
      between(.7, 1.1),
    )
  }
  let [rare, rarer] = (sky?.dataset.shoot ?? '').split(' ').map(Number)
  if (night && far && rare && !calm.matches) {
    often(wish, rare, rarer, between(5, 12))
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
      let [, y] = unit([e.clientX, e.clientY])
      if (dark.matches && y < -40 && y > -700) {
        brighten(e.clientX, e.clientY), through(e.clientX, e.clientY)
      }
    })
  }
}
