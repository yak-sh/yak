// The drop zone (@yaks/ui `Drop`): a file input a person presses to
// choose from, or drags files onto, and the list of what is chosen. Every
// page's shell loads it once, and it listens on the document, so a zone a
// script draws later (public/data.js) works the same as one in the page.
//
// The input is the form's own: pressing the zone, or Enter or Space on it,
// opens the chooser (a phone's picker on a phone), a drop sets its files, and
// each change says `change`, so a page's own listener hears a drop the same
// as a choice. Nothing here is needed for the form to send.
//
// A gathering part (`.Drop-gather`, a chat app's message box) takes a drop or
// a paste anywhere on it, and adds each choice, drop or paste to what it
// holds; what it holds its page draws, hearing `change`, each with a button
// that takes it back (`data-drop-remove`). The input says what it takes:
// `data-size` the most bytes of one file and `data-count` the most files,
// past which a file is left out and the part says so (`.Drop_Said`).
{
  let zoneOf = (e) =>
    e.target.closest?.('.Drop_Zone') ?? e.target.closest?.('.Drop-gather')
  let carriesFiles = (e) => e.dataTransfer?.types.includes('Files')
  let gathers = (input) => !!input.closest('.Drop-gather')
  let fileOf = (zone) => zone?.querySelector('.Drop_File')
  let lit = (zone) => zone.matches('.Drop') ? 'Drop-over' : 'Drop_Zone-over'

  let size = (n) =>
    n < 1000
      ? `${n} B`
      : n < 1e6
      ? `${Math.round(n / 1e3)} KB`
      : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`

  // What each input was last given, so a gathering part adds a choice to it.
  let holding = new WeakMap()

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
    holding.set(input, [...input.files])
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  let add = (input, files) =>
    put(input, [...holding.get(input) ?? [], ...files])

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

  // A zone lists what is chosen under it; a gathering part's page draws it.
  let show = (input) => {
    let list = input.closest('.Drop')?.querySelector('.Drop_Chosen')
    if (list && !gathers(input)) {
      list.replaceChildren(...[...input.files].map((f, i) => row(input, f, i)))
    }
  }

  addEventListener('change', (e) => {
    let input = e.target
    if (!input.matches?.('.Drop_File')) return
    let had = holding.get(input) ?? []
    let now = [...input.files]
    // A choice in a gathering part joins what it holds; emptied, it lets go.
    if (gathers(input) && now.some((f) => !had.includes(f))) {
      return add(input, now.filter((f) => !had.includes(f)))
    }
    holding.set(input, now)
    show(input)
    if (input.hasAttribute('data-sends') && now.length) {
      input.form?.requestSubmit()
    }
  })
  // A file a gathering part's page drew taken back by its button
  // (`data-drop-remove`, the file's place among them).
  addEventListener('click', (e) => {
    let button = e.target.closest?.('[data-drop-remove]')
    let input = fileOf(button?.closest('.Drop-gather'))
    if (!input) return
    let at = Number(button.dataset.dropRemove)
    put(input, [...input.files].filter((_, j) => j != at))
    input.focus()
  })
  // A form's reset empties its inputs without a change.
  addEventListener('reset', (e) => {
    setTimeout(() =>
      e.target.querySelectorAll('.Drop_File').forEach((input) => {
        holding.set(input, [])
        show(input)
      })
    )
  })
  // Files pasted into a gathering part, a picture copied or a screenshot,
  // join what it holds; pasted words stay words.
  addEventListener('paste', (e) => {
    let input = fileOf(e.target.closest?.('.Drop-gather'))
    let files = [...e.clipboardData?.files ?? []]
    if (!input || input.disabled || !files.length) return
    e.preventDefault()
    add(input, files)
  })

  let over = (e) => {
    if (!carriesFiles(e)) return
    // A file let go beside a zone would open in place of the page, and take
    // what was typed in it along.
    e.preventDefault()
    let zone = zoneOf(e)
    let input = fileOf(zone)
    if (!input || input.disabled) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    e.dataTransfer.dropEffect = 'copy'
    zone.classList.add(lit(zone))
  }
  addEventListener('dragenter', over)
  addEventListener('dragover', over)
  addEventListener('dragleave', (e) => {
    let zone = zoneOf(e)
    if (zone && !zone.contains(e.relatedTarget)) {
      zone.classList.remove(lit(zone))
    }
  })
  addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    let zone = zoneOf(e)
    zone?.classList.remove(lit(zone))
    let input = fileOf(zone)
    if (input && !input.disabled && e.dataTransfer.files.length) {
      let files = [...e.dataTransfer.files]
      if (gathers(input)) add(input, files)
      else put(input, files)
    }
  })
}
