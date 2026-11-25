// The sky behind the home page's hero (site/sky.tsx draws it, style.css
// `.Sky` lays it out).
//
// The scene is laid out from five lengths measured here and set on it: --u,
// a 128th of his slot; --x and --feet, the middle of his figure and the line
// he sits on, on the page (<.Sky data-sink> of his units above the bottom of
// his hooves); --rule and --rule2, the pencil lines above and below the
// section after the hero.
//
// As the page scrolls, each layer of the scene goes up the window, by less
// the farther back it is: a layer's <data-depth> is the share of the scroll
// it sinks by (sky.tsx `DEPTH`), set on it as --sink, in his units. So the
// hills go up a little slower than the line he sits on, the dusk sky and its
// sun slower still, and the hills rise over the sun; the night sky hardly
// moves at all. --dusk, set on the air, goes from 0 at the top of the page to
// 1 once the line he sits on reaches the top of the window, and the dusk
// turns from blue to orange with it. A sun or moon set in the page's words
// (<data-sun-at>, <data-moon-at>) goes down the one way across the sky
// (`arcOf`) as the page scrolls, and is under the line by then.
//
// At dusk, birds fly by now and then (<.Sky data-birds="most lo hi low
// high">: how many in a flock at most, the seconds between flocks, and how
// high they fly, in his units above the line). At night a shooting star
// crosses now and then (<.Sky data-shoot="lo hi">, the seconds between
// them). When he sits down out in the margin (wander.js `sat`) he holds up
// the Start Free button, slid along its post to stay in the window, and he
// lowers it as he gets up (`rise`), before he walks.
//
// A touch on the sky: a touch on the sun or the moon turns the sky once
// around, through the other scene and back to where it was (`spin`), the
// sun and the moon both going the one way across it, stars
// brighten as a pointer passes them, and a tap on the night sky sends a
// shooting star through it from beyond the window's edge. A touch on words
// or a control is the page's, not the sky's. For anyone who asks for less
// motion nothing in the sky moves or brightens: a few birds hang in the
// dusk, a touch on the sun or the moon fades to the other scene and back,
// and that is all. He sits as the logo then, with the button beside him.
{
  let slot = document.querySelector('.Hello_Yak')
  let after = document.querySelector('.Sky_End, .Yours')
  let sky = document.querySelector('.Sky')
  let calm = matchMedia('(prefers-reduced-motion: reduce)')
  let dark = matchMedia('(prefers-color-scheme: dark)')
  let sink = Number(sky?.dataset.sink ?? 0)

  let between = (lo, hi) => lo + Math.random() * (hi - lo)
  let n1 = (v) => v.toFixed(1)
  // `f` now and then: every `lo` to `hi` seconds, first after `wait`
  let often = (f, lo, hi, wait = between(lo, hi)) =>
    setTimeout(() => {
      if (!sky?.isConnected) return
      f()
      often(f, lo, hi)
    }, wait * 1000)

  let layers = [...(sky?.querySelectorAll('[data-depth]') ?? [])].map(
    (el) => ({ el, depth: Number(el.dataset.depth) }),
  )
  let air = sky?.querySelector('.Sky_Air')
  let deep = sky?.querySelector('.Sky_Deep')
  let sun = sky?.querySelector('.Sky_Sun')
  let halo = sky?.querySelector('.Sky_Halo')
  let sunAt = document.querySelector('[data-sun-at]')
  let moonAt = document.querySelector('[data-moon-at]')
  let lights = [
    [sunAt, sky?.querySelector('.Sky_Sol'), sun],
    [moonAt, sky?.querySelector('.Sky_Luna'), halo],
  ]
  let center = (slot) => {
    let { left, width, top, height } = slot.getBoundingClientRect()
    return [left + width / 2, top + height / 2]
  }
  let u = 1, feet = 1
  // how far the layer `el` is in has sunk, in his units
  let sunk = (el) =>
    calm.matches
      ? 0
      : Number(el.closest('[data-depth]')?.dataset.depth ?? 0) * scrollY / u
  // The one way the sun and the moon go across the sky, on the page: the
  // circle about a point on the line he sits on through the moon's spot and
  // the sun's, from where it comes into the sky, through the moon's spot and
  // then the sun's, to where it has gone under the line, `under` below it.
  // On a wheel the two ride round, half a turn apart, a point is `point(s)`
  // (and whether it is in the sky) `s` of a turn on from the sun's spot: the
  // moon's is at `m`, and the way comes into the sky at -`e` and goes out at
  // `d`. Each light is in the sky for under half a turn, so the two are
  // never in it at once.
  let arcOf = (moon, sun, line, under) => {
    let h = ([, y]) => line - y
    let c = (moon[0] ** 2 + h(moon) ** 2 - sun[0] ** 2 - h(sun) ** 2) /
      (2 * (moon[0] - sun[0] || .01))
    let r = Math.hypot(sun[0] - c, h(sun))
    let angle = (p) => Math.atan2(h(p), p[0] - c)
    let am = angle(moon), as = angle(sun), dir = as < am ? -1 : 1
    let below = Math.asin(Math.min(1, under / r))
    // the top of the sky, as far round as it reaches
    let reach = (line + under) / r, top = reach < 1 && Math.asin(reach)
    let rise = dir < 0
      ? top && am < top ? top : Math.PI + below
      : top && am > Math.PI - top
      ? Math.PI - top
      : -below
    let set = dir < 0 ? -below : Math.PI + below
    let span = Math.abs(set - rise), between = Math.abs(as - am) / span
    let seen = .45 / (1 + between)
    let e = seen * Math.abs(as - rise) / span,
      d = seen * Math.abs(set - as) / span
    let point = (s) => {
      let on = ((s + e) % 1 + 1) % 1 - e, shown = on <= d
      let a = shown
        ? as + dir * on / seen * span
        : on < (d + 1 - e) / 2
        ? set
        : rise
      return [c + r * Math.cos(a), line - r * Math.sin(a), shown]
    }
    return { e, d, m: -seen * between, point }
  }
  // where a light stands on the page: its spot in the page's words, or its
  // circle in the sky
  let spot = (slot, el) => {
    let [x, y] = slot ? center(slot) : circle(el)
    return [x + scrollX, y + scrollY]
  }
  // As the page scrolls, the light that is up goes down the way across the
  // sky, and is under the line once the line reaches the top of the window
  // (`hour` of the way there). Only the lights in the page's words go: the
  // others are in the sky's layers, which the hills rise over.
  let arc, hour = 0, drift = { sun: [0, 0], moon: [0, 0] }
  let risen = ({ m, d }) => arc ? [hour * d, m + hour * (d - m)] : [0, m]
  let scroll = () => {
    // Reading the position after a layer changes can force layout again.
    let y = scrollY, down = calm.matches ? 0 : y / u
    for (let { el, depth } of layers) {
      el.style.setProperty('--sink', n1(depth * down))
    }
    let dusk = Math.min(1, y / feet)
    air?.style.setProperty('--dusk', dusk.toFixed(3))
    hour = calm.matches ? 0 : dusk
    if (ready && ready.hour !== hour) later()
    if (!arc) return
    let [sunQ, moonQ] = risen(arc)
    for (
      let [name, q, rest, group] of [
        ['sun', sunQ, 0, lights[0][1]],
        ['moon', moonQ, arc.m, lights[1][1]],
      ]
    ) {
      let [x, y] = arc.point(q), [x0, y0] = arc.point(rest)
      drift[name] = [x - x0, y - y0]
      group.style.translate = `${n1((x - x0) / u)}px ${n1((y - y0) / u)}px`
    }
  }
  let place = () => {
    let r = slot.getBoundingClientRect(), n = after.getBoundingClientRect()
    let set = (name, px) => sky.style.setProperty(name, px.toFixed(2) + 'px')
    u = r.width / 128
    feet = Math.max(1, r.top + scrollY + r.height * .89 - sink * u)
    set('--u', u)
    let x = r.left + scrollX + r.width * .52
    set('--x', x)
    set('--feet', feet)
    for (let [slot, group, disk] of lights) {
      if (!slot || !group || !disk) continue
      let [px, py] = center(slot)
      let cx = Number(disk.getAttribute('cx')),
        cy = Number(disk.getAttribute('cy'))
      group.setAttribute(
        'transform',
        `translate(${n1((px + scrollX - x) / u - cx)} ${
          n1((py + scrollY - feet) / u - cy)
        })`,
      )
    }
    set('--rule', n.top + scrollY + 1)
    set('--rule2', n.bottom + scrollY - .5)
    let [sunSlot, sunGroup] = lights[0], [moonSlot, moonGroup] = lights[1]
    arc = sunSlot && moonSlot && sunGroup && moonGroup
      ? arcOf(spot(moonSlot), spot(sunSlot), feet, 90 * u)
      : null
    scroll()
    ready = null
    later()
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
      if (!roost.isConnected) return
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
    e.target.removeAttribute('aria-hidden')
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

  // where a circle of the sky's is in the window, as far down as its layer
  // has sunk
  let circle = (el) =>
    at(Number(el.getAttribute('cx')), Number(el.getAttribute('cy')) + sunk(el))

  // what a touch at (px, py) lands on: the sun, the moon, or the sky; a
  // touch within a finger's width of either counts
  let moon = sky?.querySelector('.Sky_Moon')
  let near = (el, r, px, py) => {
    let [slot, name] = el === halo ? [moonAt, 'moon'] : [sunAt, 'sun']
    let [x, y, k] = slot ? [...center(slot), u] : circle(el)
    if (slot) x += drift[name][0], y += drift[name][1]
    return Math.hypot(px - x, py - y) <= Math.max(r * k * 1.4, 22)
  }
  let over = (px, py) =>
    dark.matches
      ? near(halo, 24, px, py) && 'moon'
      : near(sun, Number(sun.getAttribute('r')), px, py) && 'sun'

  // a touch is the sky's when it lands on nothing of the page's: no control,
  // and no words of an element's own
  let CONTROLS = 'a, button, input, textarea, select, label, summary, ' +
    '[tabindex], [contenteditable], .Card, .Demo, .Wander, [data-wander]'
  let worded = (el) =>
    [...el.childNodes].some((n) => n.nodeType == 3 && n.data.trim())
  let page = (el) => !el || el.closest?.(CONTROLS) || worded(el)

  // A shooting star from one point to another, in his units: its head runs
  // the way, its tail growing behind it and drawn back in as it burns out.
  // It is drawn into the night sky, so as far up as the sky has sunk.
  let shoot = ([x, y], [x2, y2], size = 1) => {
    let down = sunk(deep)
    y -= down, y2 -= down
    let way = Math.hypot(x2 - x, y2 - y) / size
    let turn = Math.atan2(y2 - y, x2 - x) * 180 / Math.PI
    let star = draw('g', {
      class: 'Sky_Shoot',
      transform: `translate(${n1(x)} ${n1(y)}) rotate(${n1(turn)}) scale(${
        n1(size)
      })`,
    }, deep)
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
  // one somewhere above the hills, while they are in view
  let star = () => {
    let [x0, top] = unit([0, 0]), [x1] = unit([innerWidth, 0])
    if (top > -240) return
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
  // and one of its own now and then, while the night sky is in view and the
  // tab is
  let wish = () => !document.hidden && dark.matches && star()
  let [rare, rarer] = (sky?.dataset.shoot ?? '').split(' ').map(Number)
  if (deep && far && rare && !calm.matches) {
    often(wish, rare, rarer, between(5, 12))
  }

  // One turn of the sky, from the scene it shows through the other and back.
  // The sun and the moon go the one way across the sky (`arcOf`) and ride one
  // wheel round, half a turn apart: from the day the sun sets, the moon comes
  // down into its spot as the night is deepest, goes on and sets, and the sun
  // comes back down to its own; from the night it is the same way round, the
  // moon first. The light follows the sun: the day's things show as it is up
  // and the night's as it is down, the twilight is clearest as it sets and as
  // it comes back, and the hills, the grass, he and the words over them take
  // the other scheme's colors as the night comes (or the day, from the
  // night). Every move is drawn ahead as `STEPS` frames the browser plays,
  // and all but the lights' once the page is idle (`prepare`), so a touch
  // turns the sky at once. The stars stay where they are: turning all of
  // them redraws them every frame, which a phone cannot keep up with. For
  // anyone who asks for less motion nothing moves: the scene fades to the
  // other and back.
  const TURN = 3800, FADE = 1600, STEPS = 72, RAMP = .2
  // what the light falls on, and what of it is painted otherwise in the other
  // scheme
  const LIT = '.Sky_Hills > path, [id^="Sky-hill-"] stop, .Sky_Turf0, .Sky_Line'
  const PAINT = ['fill', 'stroke', 'stopColor']
  // the words over the sky, the page's head and its hero, but not a
  // control's, which keeps its own ground
  const OWN = 'input, textarea, select, button, .Button, .Hello_Yak'
  let inked = [...document.querySelectorAll('.Top, .Hello')]
  let words = () =>
    inked.flatMap((top) =>
      [top, ...top.querySelectorAll('*')].filter((el) =>
        !el.closest(OWN) && (el === top || worded(el))
      )
    )
  // each of `sets` ([elements, properties]) painted otherwise in the other
  // scheme, as [element, property, now, then]
  let other = (sets) => {
    let roots = [sky, ...inked]
    let read = () =>
      sets.map(([els, props]) =>
        els.map((el) => {
          let css = getComputedStyle(el)
          return props.map((p) => css[p])
        })
      )
    let now = read()
    for (let r of roots) r.style.colorScheme = dark.matches ? 'light' : 'dark'
    let then = read()
    for (let r of roots) r.style.colorScheme = ''
    return sets.flatMap(([els, props], k) =>
      els.flatMap((el, i) =>
        props.flatMap((p, j) => {
          let a = now[k][i][j], b = then[k][i][j]
          return a == b ? [] : [[el, p, a, b]]
        })
      )
    )
  }
  let smooth = (lo, hi, v) => {
    let t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)
  }
  // through each of `keys` ([at, value]) in turn, eased between them
  let curve = (keys) => (at) => {
    let i = keys.findIndex(([t]) => t >= at)
    if (i <= 0) return keys[i < 0 ? keys.length - 1 : 0][1]
    let [t0, v0] = keys[i - 1], [t1, v1] = keys[i]
    return v0 + (v1 - v0) * smooth(t0, t1, at)
  }
  // the turn gathers speed over its first fifth and loses it over its last
  let ease = (s) => {
    let v = 1 / (1 - RAMP)
    return s < RAMP
      ? v * s * s / (2 * RAMP)
      : s > 1 - RAMP
      ? 1 - v * (1 - s) ** 2 / (2 * RAMP)
      : v * (s - RAMP / 2)
  }
  // the way across the sky where the sun and the moon stand now
  let across = () => {
    let [, line, k] = at(0, 0)
    return arc ??
      arcOf(spot(null, halo), spot(null, sun), line + scrollY, 90 * k)
  }
  let glow = sky?.querySelector('.Sky_Glow')

  // A turn, drawn for the scene the sky shows and staged to play: the light
  // and its colors (`scene`), the lights from where they stand (`rides`,
  // drawn again once the page has scrolled), and when the shooting stars go.
  // Staging an animation reads its frames, which a phone takes a tenth of a
  // second over, so it is done once the page is idle and not on a touch.
  let stage = (el, frames, duration) =>
    new Animation(
      new KeyframeEffect(el, frames, {
        duration,
        easing: 'linear',
        fill: 'forwards',
      }),
    )
  let scene = (day, still) => {
    // how light the sky is, 1 by day and 0 by night, as far round as the
    // wheel has come: half the twilight as the sun goes under the line and
    // as it comes back into the sky
    let { d, e } = across()
    let light = still
      ? (f) => (1 + (day ? 1 : -1) * Math.cos(2 * Math.PI * f)) / 2
      : curve(
        day
          ? [[0, 1], [d, .5], [.5, 0], [1 - e, .5], [1, 1]]
          : [[0, 0], [.5 - e, .5], [.5, 1], [.5 + d, .5], [1, 0]],
      )
    let frames = Array.from({ length: STEPS + 1 }, (_, i) => {
      let s = i / STEPS, f = still ? s : ease(s), l = light(f)
      return { s, f, l, dusk: 4 * l * (1 - l) }
    })
    let runs = []
    let play = (els, keys) => {
      let all = frames.map(keys)
      for (let el of els) if (el) runs.push(stage(el, all, still ? FADE : TURN))
    }
    let lights = '.Sky_Sol, .Sky_Luna'
    let what = (name) =>
      [...sky.querySelectorAll(name)].filter((el) =>
        still || !el.matches(lights)
      )
    play(what('.Sky_Day'), (f) => ({ opacity: f.l }))
    play(what('.Sky_Night'), (f) => ({ opacity: 1 - f.l }))
    play([sky.querySelector('.Sky_Dark')], (f) => ({ opacity: 1 - f.l }))
    play(
      [sky.querySelector('.Sky_Twilight')],
      (f) => ({ opacity: .9 * f.dusk }),
    )
    // the other scheme's paint comes as its hour does, and the words' as
    // the sky behind them goes from light to dark, the twilight darkening
    // it too, so they stay clear of it
    let from = day ? 1 : 0
    let lit = [[[...sky.querySelectorAll(LIT)], PAINT], [words(), ['color']]]
    for (let [el, p, now, then] of other(lit)) {
      let part = (f) =>
        p == 'color'
          ? Math.abs(1 - from - smooth(.35, .55, 1 - f.l + .5 * f.dusk))
          : Math.abs(f.l - from)
      play([el], (f) => ({
        [p]: `color-mix(in srgb, ${now}, ${then} ${n1(100 * part(f))}%)`,
      }))
    }
    // and he is in shadow while it is darker than the page
    if (day) {
      play(document.querySelectorAll('.Wander_Image'), (f) => ({
        filter: `brightness(${(.7 + .3 * f.l).toFixed(3)})`,
      }))
    }
    // a few shooting stars cross the deepest of the night
    let starry = frames.filter((f) => f.l < .15)
    let shots = still ? [] : [1, 3, 5, 7]
      .map((q) => starry[Math.floor(starry.length * q / 8)])
      .filter(Boolean)
    return { day, still, runs, shots }
  }
  // each light from where it stands, the one not in the sky half a turn
  // round, and the wheel turned once
  let rides = (day) => {
    let path = across(), k = at(0, 0)[2], [sunQ, moonQ] = risen(path)
    let off = (v) => (Math.round(v / k * 10) / 10 + 0).toFixed(1)
    let ride = (els, q, start) => {
      let [x0, y0] = path.point(q)
      let frames = Array.from({ length: STEPS + 1 }, (_, i) => {
        let [x, y, shown] = path.point(start + ease(i / STEPS))
        return {
          translate: `${off(x - x0)}px ${off(y - y0)}px`,
          opacity: shown ? 1 : 0,
        }
      })
      return els.filter(Boolean).map((el) => stage(el, frames, TURN))
    }
    let sunlit = glow?.getAttribute('cy') == sun.getAttribute('cy')
    return [
      ...ride([sun, sunlit && glow], sunQ, sunQ + (day ? 0 : .5)),
      ...ride([moon.parentNode, halo], moonQ, moonQ + (day ? .5 : 0)),
    ]
  }
  let ready, soon
  let prepare = () => {
    soon = null
    let day = !dark.matches, still = calm.matches
    if (ready?.day !== day || ready.still !== still) ready = scene(day, still)
    if (ready.hour !== hour) {
      ready.hour = hour
      ready.rides = still ? [] : rides(day)
    }
    return ready
  }
  // staged again once the page is idle, and not while the sky turns, when
  // what it reads is the turn's
  let later = () => {
    if (soon || turning) return
    soon = self.requestIdleCallback
      ? requestIdleCallback(prepare, { timeout: 3000 })
      : setTimeout(prepare, 500)
  }
  dark.addEventListener?.('change', later)
  calm.addEventListener?.('change', later)

  let turning
  let spin = () => {
    if (turning) return
    let { runs, rides, shots } = prepare()
    runs = [...runs, ...rides]
    for (let run of runs) run.play()
    for (let f of shots) setTimeout(star, f.s * TURN)
    delete sky.dataset.over
    sky.dataset.turn = ''
    turning = true
    runs[0].onfinish = () => {
      for (let run of runs) run.cancel()
      delete sky.dataset.turn
      turning = null
      if (ready?.hour !== hour) later()
    }
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

  if (slot && after && sky) {
    place()
    new ResizeObserver(place).observe(document.body)
    document.fonts?.ready.then(place)
    addEventListener('load', place)
    addEventListener('scroll', scroll, { passive: true })
  }
  if (sky && sun && moon && halo && far) {
    let frame = 0
    addEventListener('pointermove', (e) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        // the sun and the moon show they answer a touch to a mouse only
        let on = e.pointerType == 'mouse' && !turning && !page(e.target) &&
          over(e.clientX, e.clientY)
        if (on) sky.dataset.over = on
        else delete sky.dataset.over
        if (dark.matches && !calm.matches) brighten(e.clientX, e.clientY)
      })
    }, { passive: true })
    addEventListener('click', (e) => {
      if (page(e.target) || getSelection()?.toString()) return
      if (over(e.clientX, e.clientY)) return spin()
      if (calm.matches) return
      let [, y] = unit([e.clientX, e.clientY])
      if (dark.matches && y < -40 && y > -700) {
        brighten(e.clientX, e.clientY), through(e.clientX, e.clientY)
      }
    })
  }
}
