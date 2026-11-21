// The folds of the frame, pressed without leaving the page: the side's
// (sidebar.ts `fold`), which collapses it to its rail of icons, and the
// aside's (frame.ts `toggle`), which puts it away and the page
// centers in the whole width; each opens again the same way. The change is
// drawn at once and the choice sent to be kept on the person's row. Where it
// could not be sent, the form is sent as it would be without this script, and
// the page is drawn again from what was kept.
let folds = {
  sidebar: {
    shut: 'collapsed',
    said: (shut) => shut ? 'Expand the sidebar' : 'Collapse the sidebar',
    draw: (shut) => {
      document.getElementById('menu').classList.toggle('Sidebar-rail', shut)
      for (let nav of document.querySelectorAll('#menu .SideNav')) {
        nav.classList.toggle('SideNav-rail', shut)
      }
    },
  },
  aside: {
    shut: 'shut',
    said: (shut) => shut ? 'Show the panel' : 'Hide the panel',
    draw: (shut) =>
      document.getElementById('aside').closest('.Shell')
        .classList.toggle('Shell-shut', shut),
  },
}

addEventListener('submit', async (e) => {
  let form = e.target.closest?.('form[data-side]')
  if (!form) return
  let name = Object.keys(folds).find((n) => form.querySelector(`[name=${n}]`))
  if (!name) return
  e.preventDefault()
  let fold = folds[name]
  let field = form.querySelector(`[name=${name}]`)
  let body = new URLSearchParams()
  for (let input of form.querySelectorAll('input[name]')) {
    body.set(input.name, input.value)
  }
  let shut = field.value == fold.shut
  fold.draw(shut)
  field.value = shut ? 'open' : fold.shut
  let button = form.querySelector('button')
  button.title = fold.said(shut)
  button.setAttribute('aria-label', fold.said(shut))
  button.setAttribute('aria-expanded', String(!shut))
  let sent = await fetch(form.action, { method: 'POST', body })
    .then((r) => r.ok, () => false)
  if (!sent) {
    field.value = body.get(name)
    form.submit()
  }
})
