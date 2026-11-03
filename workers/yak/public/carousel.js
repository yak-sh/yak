// The home page's examples, one card at a time (index.html, `.Demo`). It
// moves on by itself every few seconds, and holds still while a visitor reads
// a card, once they take the controls (a button, a dot, an arrow key, a
// swipe), and from the start for anyone who asks their system for less
// motion. Without this script the row still scrolls and stops on each card.
let EVERY = 6000

let carousel = (root) => {
  let track = root.querySelector('.Demo_Slides')
  let bar = root.querySelector('.Demo_Controls')
  let slides = [...track.children]
  if (slides.length < 2 || !bar) return
  let dots = bar.querySelector('.Demo_Dots')
  let pause = bar.querySelector('.Demo_Pause')
  let calm = matchMedia('(prefers-reduced-motion: reduce)')
  let at = 0, playing = !calm.matches, reading = false, timer = 0

  let named = (slide) =>
    slide.querySelector('.Card_Title')?.textContent.replace('↗', '').trim()

  // Only the card in view is reachable, so a Tab leaves the carousel rather
  // than walking every card behind it; the next card's picture is asked for
  // before it slides in.
  let mark = () => {
    slides.forEach((slide, i) => {
      slide.inert = i != at
      dots.children[i].setAttribute('aria-current', String(i == at))
      if (i == at || i == (at + 1) % slides.length) {
        for (let img of slide.querySelectorAll('img')) img.loading = 'eager'
      }
    })
  }

  let go = (i) => {
    at = (i + slides.length) % slides.length
    track.scrollTo({
      left: slides[at].offsetLeft - slides[0].offsetLeft,
      behavior: calm.matches ? 'instant' : 'smooth',
    })
    mark()
  }

  let wait = () => {
    clearTimeout(timer)
    track.setAttribute('aria-live', playing ? 'off' : 'polite')
    pause.textContent = playing ? 'Pause' : 'Play'
    if (playing && !reading && !document.hidden) {
      timer = setTimeout(() => (go(at + 1), wait()), EVERY)
    }
  }

  let stop = () => {
    playing = false
    wait()
  }

  slides.forEach((slide, i) => {
    slide.setAttribute('role', 'group')
    slide.setAttribute('aria-roledescription', 'slide')
    slide.setAttribute('aria-label', `${i + 1} of ${slides.length}`)
    let dot = document.createElement('button')
    dot.type = 'button'
    dot.className = 'Demo_Dot'
    dot.setAttribute('aria-label', `Show ${named(slide)}`)
    dot.addEventListener('click', () => (stop(), go(i)))
    dots.append(dot)
  })

  for (let step of bar.querySelectorAll('[data-step]')) {
    step.addEventListener('click', () => (stop(), go(at + +step.dataset.step)))
  }
  pause.addEventListener('click', () => {
    playing = !playing
    wait()
  })
  root.addEventListener('keydown', (e) => {
    let step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (!step || e.altKey || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    let inside = track.contains(document.activeElement)
    stop()
    go(at + step)
    if (inside) slides[at].querySelector('a')?.focus({ preventScroll: true })
  })

  // A swipe or a sideways scroll is the visitor's own; where the row comes to
  // rest is the card in view.
  track.addEventListener('pointerdown', stop)
  track.addEventListener('wheel', (e) => e.deltaX && stop(), { passive: true })
  let settle = 0
  track.addEventListener('scroll', () => {
    clearTimeout(settle)
    settle = setTimeout(() => {
      let width = slides[1].offsetLeft - slides[0].offsetLeft
      let near = Math.round(track.scrollLeft / width)
      if (near != at) (at = near, mark())
    }, 100)
  }, { passive: true })

  let read = (now) => () => (reading = now, wait())
  track.addEventListener('pointerenter', read(true))
  track.addEventListener('pointerleave', read(false))
  track.addEventListener('focusin', read(true))
  track.addEventListener('focusout', (e) => {
    if (!track.contains(e.relatedTarget)) read(false)()
  })
  document.addEventListener('visibilitychange', wait)
  calm.addEventListener('change', () => calm.matches && stop())

  bar.hidden = false
  mark()
  wait()
}

for (let root of document.querySelectorAll('[data-carousel]')) carousel(root)
