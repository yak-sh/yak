// The drop zone (controls.css `.Drop`): a file input a person presses to
// choose from, or drags files onto, and the list of what is chosen. Every
// page's shell loads it once, and it listens on the document, so a zone a
// script draws later (public/data.js) works the same as one in the page.
//
// The input is the form's own: pressing the zone, or Enter or Space on it,
// opens the chooser (a phone's picker on a phone), a drop sets its files, and
// each change says `change`, so a page's own listener hears a drop the same
// as a choice. Nothing here is needed for the form to send.
{
  let zoneOf = (e) => e.target.closest?.('.Drop_Zone')
  let carriesFiles = (e) => e.dataTransfer?.types.includes('Files')

  let size = (n) =>
    n < 1000
      ? `${n} B`
      : n < 1e6
      ? `${Math.round(n / 1e3)} KB`
      : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`

  // Sets the input's files and says so, as a choice would.
  let put = (input, files) => {
    let held = new DataTransfer()
    for (let f of input.multiple ? files : files.slice(0, 1)) held.items.add(f)
    input.files = held.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
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
    let name = document.createElement('span')
    name.className = 'Drop_Name'
    name.textContent = file.name
    let meta = document.createElement('span')
    meta.className = 'Drop_Size'
    meta.textContent = size(file.size)
    let remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'Button Button-quiet'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove ${file.name}`)
    remove.onclick = () => {
      put(input, [...input.files].filter((_, j) => j != i))
      input.focus()
    }
    li.append(name, meta, remove)
    return li
  }

  let show = (input) => {
    let list = input.closest('.Drop')?.querySelector('.Drop_Chosen')
    if (list) {
      list.replaceChildren(...[...input.files].map((f, i) => row(input, f, i)))
    }
  }

  addEventListener('change', (e) => {
    if (e.target.matches?.('.Drop_File')) show(e.target)
  })
  // A form's reset empties its inputs without a change.
  addEventListener('reset', (e) => {
    setTimeout(() => e.target.querySelectorAll('.Drop_File').forEach(show))
  })

  let over = (e) => {
    if (!carriesFiles(e)) return
    // A file let go beside a zone would open in place of the page, and take
    // what was typed in it along.
    e.preventDefault()
    let zone = zoneOf(e)
    let input = zone?.querySelector('.Drop_File')
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
    if (!carriesFiles(e)) return
    e.preventDefault()
    let zone = zoneOf(e)
    zone?.classList.remove('Drop_Zone-over')
    let input = zone?.querySelector('.Drop_File')
    if (input && !input.disabled && e.dataTransfer.files.length) {
      put(input, [...e.dataTransfer.files])
    }
  })
}
