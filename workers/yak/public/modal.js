// The server opens the dialog already; making it modal gives it the browser's
// focus trap and restores the same close URL when Escape is pressed.
for (let dialog of document.querySelectorAll('dialog.Modal')) {
  let close = dialog.querySelector('[data-modal-close]')
  if (!close || typeof dialog.showModal != 'function') continue
  dialog.close()
  dialog.showModal()
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    location.assign(close.href)
  })
}
