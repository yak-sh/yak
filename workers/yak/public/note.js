// The corner's note (operator-page.ts `notePage`): what the person types is
// kept in this browser under the note it is for (`data-note`: the app, its
// page and the passage), so closing the window loses nothing, until Send
// takes it.
for (let words of document.querySelectorAll('textarea[data-note]')) {
  let key = 'yaks:note:' + words.dataset.note
  try {
    words.value ||= localStorage.getItem(key) ?? ''
  } catch { /* no storage: the draft lives while the window does */ }
  words.addEventListener('input', () => {
    try {
      words.value
        ? localStorage.setItem(key, words.value)
        : localStorage.removeItem(key)
    } catch { /* as above */ }
  })
  words.form?.addEventListener('submit', () => {
    try {
      localStorage.removeItem(key)
    } catch { /* as above */ }
  })
}
