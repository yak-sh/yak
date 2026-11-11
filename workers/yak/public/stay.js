// The home page's button that stays on screen (index.html `[data-stay]`): it
// shows along the foot of the window while every place it would repeat, the
// ones its `data-stay` selects (the box, the closing card, the footer), is
// out of sight, and goes when one comes back. Pressing it puts the cursor in
// the box it points at. Without this script, or in a browser that cannot say
// what is on screen, it stays hidden and the closing card is the way back.
for (let bar of document.querySelectorAll('[data-stay]')) {
  if (typeof IntersectionObserver != 'function') break
  let seen = new Set()
  let watch = new IntersectionObserver((entries) => {
    for (let e of entries) {
      if (e.isIntersecting) seen.add(e.target)
      else seen.delete(e.target)
    }
    bar.hidden = seen.size > 0
  })
  for (let place of document.querySelectorAll(bar.dataset.stay)) {
    watch.observe(place)
  }
  bar.addEventListener('click', (e) => {
    let to = e.target.closest?.('a[href^="#"]')?.getAttribute('href')
    let box = to && document.getElementById(to.slice(1))
    if (!box) return
    e.preventDefault()
    box.scrollIntoView({ block: 'center' })
    box.focus({ preventScroll: true })
  })
}
