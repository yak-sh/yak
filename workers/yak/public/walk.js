// The home page's walkthroughs (index.html, `.Walk`): one app at a time, a
// different one each visit, with a row of their names to pick another. It
// moves to the next app by itself only while the visitor is still above the
// first step, never for anyone who asks their system for less motion, and
// holds once they scroll in or pick a name. Without this script every app
// reads top to bottom, one after another, and each step's app stays beside
// its words by CSS alone (`position: sticky`).
let EVERY = 9000
let SEEN = 'yak-walk'

let walk = (root) => {
  let apps = [...root.querySelectorAll('.Walk_App')]
  if (apps.length < 2) return
  let names = root.querySelector('.Walk_Names')
  let buttons = [...names.querySelectorAll('[data-walk-name]')]
  let calm = matchMedia('(prefers-reduced-motion: reduce)')
  let held = false, timer = 0

  let show = (i) => {
    apps.forEach((app, n) => (app.hidden = n != i))
    buttons.forEach((b) =>
      b.setAttribute(
        'aria-pressed',
        String(b.dataset.walkName == apps[i].dataset.walk),
      )
    )
    try {
      localStorage.setItem(SEEN, apps[i].dataset.walk)
    } catch { /* storage refused: every visit starts on the first */ }
  }
  let at = () => apps.findIndex((app) => !app.hidden)
  let above = () =>
    apps[at()].querySelector('.Walk_Step').getBoundingClientRect().top >
      innerHeight
  let hold = () => (held = true, clearTimeout(timer))
  let wait = () => {
    clearTimeout(timer)
    if (held || calm.matches) return
    timer = setTimeout(() => {
      if (above() && !document.hidden) show((at() + 1) % apps.length)
      else if (!above()) return hold()
      wait()
    }, EVERY)
  }

  let last = ''
  try {
    last = localStorage.getItem(SEEN) ?? ''
  } catch { /* nothing kept */ }
  let was = apps.findIndex((app) => app.dataset.walk == last)
  show((was + 1) % apps.length)
  names.hidden = false

  names.addEventListener('click', (e) => {
    let name = e.target.closest('[data-walk-name]')?.dataset.walkName
    let i = apps.findIndex((app) => app.dataset.walk == name)
    if (i >= 0) (hold(), show(i))
  })
  // The link after the last step opens the next app at its first.
  root.addEventListener('click', (e) => {
    let next = e.target.closest('[data-walk-next]')?.dataset.walkNext
    let i = apps.findIndex((app) => app.dataset.walk == next)
    if (i < 0) return
    e.preventDefault()
    hold()
    show(i)
    apps[i].scrollIntoView({ behavior: calm.matches ? 'instant' : 'smooth' })
  })
  addEventListener('scroll', () => above() || hold(), { passive: true })
  document.addEventListener('visibilitychange', wait)
  wait()
}

for (let root of document.querySelectorAll('.Walk')) walk(root)
