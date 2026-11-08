// The side's fold (desk-pages.ts `fold`), pressed without leaving the page:
// the side collapses to its rail of icons, or opens again, at once, and the
// choice is sent to be kept on the person's row. Where it could not be sent,
// the form is sent as it would be without this script, and the page is drawn
// again from what was kept.
addEventListener('submit', async (e) => {
  let form = e.target.closest?.('form[data-side]')
  if (!form) return
  e.preventDefault()
  let field = form.querySelector('[name=sidebar]')
  let body = new URLSearchParams()
  for (let input of form.querySelectorAll('input[name]')) {
    body.set(input.name, input.value)
  }
  let collapsed = field.value == 'collapsed'
  let said = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'
  document.body.classList.toggle(form.dataset.side, collapsed)
  for (let nav of document.querySelectorAll('#menu .SideNav')) {
    nav.classList.toggle('SideNav-rail', collapsed)
  }
  field.value = collapsed ? 'open' : 'collapsed'
  let button = form.querySelector('button')
  button.title = said
  button.setAttribute('aria-label', said)
  button.setAttribute('aria-expanded', String(!collapsed))
  let sent = await fetch(form.action, { method: 'POST', body })
    .then((r) => r.ok, () => false)
  if (!sent) {
    field.value = body.get('sidebar')
    form.submit()
  }
})
