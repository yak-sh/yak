// The drop zone (@yaks/ui `Drop`): a file input a person presses to
// choose from, or drags files onto, and the list of what is chosen. Every
// page's shell loads it once, and it listens on the document, so a zone a
// script draws later (public/data.js) works the same as one in the page.
//
// The input is the form's own: pressing the zone, or Enter or Space on it,
// opens the chooser (a phone's picker on a phone), a drop sets its files, and
// each change says `change`, so a page's own listener hears a drop the same
// as a choice. Nothing here is needed for the form to send. The input says
// what it takes: `data-size` the most bytes of one file and `data-count` the
// most files, past which a file is left out and the zone says so
// (`.Drop_Said`).
//
// A file let go anywhere else on a page is kept from opening in place of
// it, which would take what was typed there along. A part that takes files
// of its own (a chat app's message box, @yaks/ux `Conversation.Box`) takes
// its drop first, and this leaves that drop be.
{
  let zoneOf = (e) => e.target.closest?.('.Drop_Zone')
  let ours = (e) =>
    e.dataTransfer?.types.includes('Files') && !e.defaultPrevented
  let fileOf = (zone) => zone?.querySelector('.Drop_File')

  let size = (n) =>
    n < 1000
      ? `${n} B`
      : n < 1e6
      ? `${Math.round(n / 1e3)} KB`
      : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`

  // Sets the input's files and says so, as a choice would: within its
  // ceilings, and saying what was left out.
  let put = (input, files) => {
    let most = Number(input.dataset.size) || Infinity
    let count = input.multiple ? Number(input.dataset.count) || Infinity : 1
    let big = files.filter((f) => f.size > most)
    let kept = files.filter((f) => f.size <= most)
    let left = [
      ...big.map((f) =>
        `${f.name} is larger than ${size(most)}, so it was left out.`
      ),
      ...kept.length > count
        ? [`Up to ${count} files go at a time, so the rest were left out.`]
        : [],
    ]
    let said = input.closest('.Drop')?.querySelector('.Drop_Said')
    if (said) said.textContent = left.join(' ')
    let held = new DataTransfer()
    for (let f of kept.slice(0, count)) held.items.add(f)
    input.files = held.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  let span = (className, text) => {
    let s = document.createElement('span')
    s.className = className
    s.textContent = text
    return s
  }

  let row = (input, file, i) => {
    let li = document.createElement('li')
    li.className = 'Drop_Item'
    if (file.type.startsWith('image/')) {
      let img = document.createElement('img')
      img.className = 'Drop_Picture'
      img.alt = ''
      img.src = URL.createObjectURL(file)
      img.onload = () => URL.revokeObjectURL(img.src)
      li.append(img)
    }
    li.append(span('Drop_Name', file.name), span('Drop_Size', size(file.size)))
    let remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'Button'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove ${file.name}`)
    remove.onclick = () => {
      put(input, [...input.files].filter((_, j) => j != i))
      input.focus()
    }
    li.append(remove)
    return li
  }

  // A zone lists what is chosen under it.
  let show = (input) => {
    let list = input.closest('.Drop')?.querySelector('.Drop_Chosen')
    list?.replaceChildren(...[...input.files].map((f, i) => row(input, f, i)))
  }

  addEventListener('change', (e) => {
    let input = e.target
    if (!input.matches?.('.Drop_File')) return
    show(input)
    if (input.hasAttribute('data-sends') && input.files.length) {
      input.form?.requestSubmit()
    }
  })
  // A form's reset empties its inputs without a change.
  addEventListener('reset', (e) => {
    setTimeout(() => e.target.querySelectorAll('.Drop_File').forEach(show))
  })

  let over = (e) => {
    if (!ours(e)) return
    e.preventDefault()
    let zone = zoneOf(e)
    let input = fileOf(zone)
    if (!input || input.disabled) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    e.dataTransfer.dropEffect = 'copy'
    zone.classList.add('Drop_Zone-over')
  }
  addEventListener('dragenter', over)
  addEventListener('dragover', over)
  addEventListener('dragleave', (e) => {
    let zone = zoneOf(e)
    if (zone && !zone.contains(e.relatedTarget)) {
      zone.classList.remove('Drop_Zone-over')
    }
  })
  addEventListener('drop', (e) => {
    if (!ours(e)) return
    e.preventDefault()
    let zone = zoneOf(e)
    zone?.classList.remove('Drop_Zone-over')
    let input = fileOf(zone)
    if (input && !input.disabled && e.dataTransfer.files.length) {
      put(input, [...e.dataTransfer.files])
    }
  })
}
