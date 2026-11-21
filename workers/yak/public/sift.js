// A long list's search and order, as a person types or picks (desk-pages.ts
// `finding`): the rows of the list a `form[data-sift]` names whose words hold
// every word typed stay, newest change first or by name, and the rest hide at
// its end; the address keeps what was asked, so a reload shows the same.
// Without this script the form, sent, asks the page for the same (`sifted`).
{
  for (let form of document.querySelectorAll('form[data-sift]')) {
    let list = document.getElementById(form.dataset.sift)
    if (!list) continue
    let rows = [...list.children]
    let box = form.querySelector('input[name=q]')
    let order = form.querySelector('select[name=sort]')
    let none = form.closest('.Card')?.querySelector('[data-none]')
    let by = {
      name: (a, b) => a.dataset.name.localeCompare(b.dataset.name),
      changed: (a, b) => b.dataset.changed.localeCompare(a.dataset.changed),
    }
    let sift = () => {
      let words = box.value.toLowerCase().split(/\s+/).filter(Boolean)
      let sorted = rows.toSorted(by[order.value] ?? by.changed)
      let held = (r) => words.every((w) => r.dataset.words.includes(w))
      let shown = sorted.filter(held)
      for (let r of sorted) r.hidden = !shown.includes(r)
      list.append(...shown, ...sorted.filter((r) => r.hidden))
      if (none) none.hidden = shown.length > 0
      let to = new URL(location.href)
      for (let [key, value] of [['q', box.value], ['sort', order.value]]) {
        if (value && !(key == 'sort' && value == 'changed')) {
          to.searchParams.set(key, value)
        } else to.searchParams.delete(key)
      }
      history.replaceState(history.state, '', to)
    }
    form.addEventListener('input', sift)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      sift()
    })
  }
}
