// A press that copies the words under it, and says so for a moment.
document.addEventListener('click', async (event) => {
  let button = event.target.closest('[data-copy]')
  let words = button?.parentElement.nextElementSibling
  if (!words) return
  await navigator.clipboard.writeText(words.textContent)
  let said = button.textContent
  button.textContent = 'Copied'
  setTimeout(() => button.textContent = said, 1500)
})
