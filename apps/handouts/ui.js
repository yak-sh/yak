// What every page of this app needs and nothing particular to it: escaping,
// a toast, one dialog for every form, and the foot that offers a copy.

export let esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )

export let toaster = (el) => {
  let t = 0
  return (text) => {
    el.textContent = text
    el.classList.add('is-on')
    clearTimeout(t)
    t = setTimeout(() => el.classList.remove('is-on'), 3200)
  }
}

/** Throws the message a person reads when a value will not do. */
export let need = (cond, text) => {
  if (!cond) throw new Error(text)
}

// A field is {name, label, type, value, options, hint, required, accept}.
let field = (f) => {
  let id = `f-${f.name}`
  let label = `<label class="field_Label" for="${id}">${esc(f.label)}</label>`
  let hint = f.hint ? `<small class="field_Hint">${esc(f.hint)}</small>` : ''
  if (f.type == 'textarea') {
    return `<p class="field">${label}<textarea class="field_Control field_Area" id="${id}" name="${f.name}" rows="4">${
      esc(f.value)
    }</textarea>${hint}</p>`
  }
  if (f.type == 'select') {
    return `<p class="field">${label}<select class="field_Control" id="${id}" name="${f.name}">${
      f.options.map(([v, l]) =>
        `<option value="${esc(v)}"${v == f.value ? ' selected' : ''}>${
          esc(l)
        }</option>`
      ).join('')
    }</select>${hint}</p>`
  }
  let extra = f.type == 'number'
    ? ' inputmode="numeric" min="1" max="240"'
    : f.type == 'file' && f.accept
    ? ` accept="${esc(f.accept)}"`
    : ''
  let value = f.type == 'file' ? '' : ` value="${esc(f.value)}"`
  return `<p class="field">${label}<input class="field_Control" id="${id}" name="${f.name}" type="${
    f.type ?? 'text'
  }"${value}${f.required ? ' required' : ''}${extra}>${hint}</p>`
}

// One dialog for every form. The form's one textarea is kept as a draft at
// `place`: words typed and not saved come back on any device, and saving
// empties the draft in the same write as what it became. `save` turns the
// form's values into bundles (and may wait, to upload a file first).
// `ask` resolves true once saved or deleted, false when closed without saving.
export let forms = ({ box, desk, apply }) => ({
  ask: ({ title, fields, place, save, remove, change }) =>
    new Promise((done) => {
      box.innerHTML = `<form method="dialog" class="ask">
        <h2 class="ask__title">${esc(title)}</h2>
        ${fields.map(field).join('')}
        <p class="ask__err" role="alert"></p>
        <div class="ask__row">
          ${
        remove
          ? '<button type="button" class="link link--danger" data-remove>Delete</button>'
          : ''
      }
          <span class="ask__gap"></span>
          <button type="button" class="btn btn--quiet" data-cancel>Cancel</button>
          <button type="submit" class="btn">Save</button>
        </div>
      </form>`
      let form = box.querySelector('form')
      let err = form.querySelector('.ask__err')
      let send = form.querySelector('[type=submit]')
      let area = place ? form.querySelector('textarea') : null
      let was = area?.value ?? ''
      let unbind = null
      if (area) {
        try {
          if (!desk.text(place) && was) desk.type(place, was)
        } catch { /* the desk is not ready; the field still holds the text */ }
        unbind = desk.bind(area, place)
      }
      let finish = (result) => {
        unbind?.()
        box.close()
        done(result)
      }
      // Closing without saving keeps what was typed, unless nothing changed.
      let cancel = async () => {
        if (area && area.value == was) {
          await desk.spend(place, []).catch(() => {})
        }
        finish(false)
      }
      let named = (name) => form.querySelector(`[name="${name}"]`)
      let changed = (ev) => change?.(ev, named)
      form.addEventListener('input', changed)
      form.addEventListener('change', changed)
      form.querySelector('[data-cancel]').onclick = cancel
      box.oncancel = (ev) => {
        ev.preventDefault()
        cancel()
      }
      form.querySelector('[data-remove]')?.addEventListener(
        'click',
        async () => {
          if (!confirm('Delete this for good?')) return
          try {
            await remove()
            if (area) await desk.spend(place, []).catch(() => {})
            finish(true)
          } catch (e) {
            err.textContent = e.message || String(e)
          }
        },
      )
      form.onsubmit = async (ev) => {
        ev.preventDefault()
        err.textContent = ''
        send.disabled = true
        try {
          let bundles = await save(Object.fromEntries(new FormData(form)))
          let ok = area
            ? await desk.spend(place, bundles)
            : (await apply(bundles), true)
          if (!ok) {
            throw new Error('That did not save. What you typed is kept here.')
          }
          finish(true)
        } catch (e) {
          err.textContent = e.message || String(e)
        } finally {
          send.disabled = false
        }
      }
      box.showModal()
      form.querySelector('input,select,textarea')?.focus()
    }),
})

// The foot: where the app was made, and on the demo space, how to get a copy
// of your own by saying one line to your assistant.
export let footer = (el, { published, readOnly }) => {
  let words = `Install the yaks.app app called ${published}`
  let demo = location.hostname.split('.')[0] == 'yourname'
  el.innerHTML =
    `<p class="foot_Text">Made on <a class="foot_Link" href="https://yaks.app/">yaks.app</a>: you ask your assistant for an app, and it builds it.</p>` +
    (demo
      ? `<p class="foot_Text">${
        readOnly ? 'This is an example, so it is read-only here. ' : ''
      }Want your own? Say this to your assistant:</p>
       <button type="button" class="say" data-copy>${esc(words)}</button>
       <p class="foot_Text">No assistant yet? <a class="foot_Link" href="https://yaks.app/connect">Start here</a>. Your copy starts empty, at your own address.</p>`
      : '')
  el.onclick = async (ev) => {
    let b = ev.target.closest('[data-copy]')
    if (!b) return
    try {
      await navigator.clipboard.writeText(words)
      b.textContent = 'Copied. Now say it to your assistant.'
      setTimeout(() => (b.textContent = words), 2400)
    } catch {
      getSelection().selectAllChildren(b)
    }
  }
}
