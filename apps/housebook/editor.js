import { button, el } from './dom.js'
import { categories, fields, id, kinds, title, today } from './model.js'

let choices = (type, items) =>
  ({
    category: categories.map((v) => [v, v]),
    item: [
      ['', 'Whole house / no item'],
      ...items.map((r) => [id(r), title(r)]),
    ],
    recordkind: [
      'Maintenance',
      'Repair',
      'Installation',
      'Inspection',
      'Improvement',
      'Observation',
      'Purchase',
    ].map((v) => [v, v]),
    side: [['Left', 'Left'], ['Right', 'Right']],
  })[type]

export let editor =
  ({ dialog, desk, items, save, fail }) => (kind, row, defaults = {}) => {
    let data = {
      ...row?.[kind],
      title: row?.doc?.title,
      body: row?.doc?.body,
      ...defaults,
    }
    if (kind === 'house_record') data.date ||= today()
    if (kind === 'house_item' && !row) data.handover ??= true
    let places = [],
      cleanup = [],
      inputs = new Map(),
      key = `${kind}:${id(row) || 'new'}`
    let identity = `${key}:identity`,
      newId = id(row) || desk.text(identity) || crypto.randomUUID()
    if (!row) desk.type(identity, newId)
    let form = el(
      'form',
      {},
      el(
        'div',
        { class: 'modal-head' },
        el('h2', {}, `${row ? 'Edit' : 'Add'} ${kinds[kind]}`),
        button('×', () => dialog.close(), 'close'),
      ),
    )
    let status = el(
      'p',
      { class: 'form-status', role: 'status' },
      'Your draft is kept as you type.',
    )
    for (let [name, label, type = 'text', required] of fields[kind]) {
      let options = choices(type, items()), place = `${key}:${name}`
      let input = options
        ? el(
          'select',
          { name },
          options.map(([value, label]) => el('option', { value }, label)),
        )
        : el(type === 'textarea' ? 'textarea' : 'input', {
          name,
          type: type === 'textarea' ? null : type,
          required,
          step: type === 'number' ? 'any' : null,
          min: type === 'number' ? '0' : null,
        })
      let value = data[name] ?? (options?.[0]?.[0] ?? '')
      // Only unsent edits live in a draft; the saved record remains the baseline.
      let held = desk.text(place)
      let restored = held.startsWith('value:')
        ? JSON.parse(held.slice(6))
        : held || value
      if (type === 'checkbox') {
        input.checked = restored === true || restored === 'true'
      } else input.value = String(restored)
      let typing = () =>
        desk.type(
          place,
          'value:' +
            JSON.stringify(type === 'checkbox' ? input.checked : input.value),
        )
      input.addEventListener('input', typing)
      cleanup.push(() => input.removeEventListener('input', typing))
      places.push(place)
      inputs.set(name, { input, type })
      form.append(
        el(
          'label',
          {
            class: type === 'checkbox'
              ? 'check'
              : type === 'textarea'
              ? 'field wide'
              : 'field',
          },
          el('span', {}, label),
          input,
        ),
      )
    }
    if (kind === 'house_file') {
      form.append(
        el(
          'label',
          { class: 'field wide' },
          el('span', {}, 'Or upload a file'),
          el('input', { type: 'file', name: 'upload' }),
        ),
      )
    }
    let submit = el('button', { type: 'submit', class: 'primary' }, 'Save')
    form.append(
      status,
      el(
        'div',
        { class: 'form-actions' },
        button('Close — keep draft', () => dialog.close()),
        submit,
      ),
    )
    let saving = false
    let cancel = (event) => {
      if (saving) event.preventDefault()
    }
    dialog.addEventListener('cancel', cancel)
    cleanup.push(() => dialog.removeEventListener('cancel', cancel))
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (saving) return
      saving = true
      let controls = [...form.querySelectorAll('input,textarea,select,button')]
      controls.forEach((control) => control.disabled = true)
      status.textContent = kind === 'house_file'
        ? 'Saving your document copy…'
        : 'Saving…'
      try {
        let values = Object.fromEntries(
          [...inputs].map(([key, { input, type }]) => [
            key,
            type === 'checkbox'
              ? input.checked
              : type === 'number'
              ? (input.value === '' ? null : Number(input.value))
              : input.value,
          ]),
        )
        let saved = await save(
          kind,
          row,
          values,
          form.querySelector('[name=upload]')?.files?.[0],
          newId,
        )
        if (saved === false) {
          status.textContent =
            'Your save is queued. Your draft is kept until the store confirms it.'
          return
        }
        for (let place of [...places, ...(!row ? [identity] : [])]) {
          if (await desk.spend(place) === false) {
            status.textContent =
              'Your record is saved. Try Save again to finish syncing your draft.'
            return
          }
        }
        dialog.close()
      } catch (error) {
        status.textContent = error.message
        fail(error)
      } finally {
        saving = false
        controls.forEach((control) => control.disabled = false)
      }
    })
    dialog.replaceChildren(form)
    dialog.addEventListener('close', () => cleanup.forEach((fn) => fn()), {
      once: true,
    })
    dialog.showModal()
    form.querySelector('input,textarea,select')?.focus()
  }
