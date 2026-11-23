/**
 * A store's rows as forms, drawn in a page's DOM with yaks.app's controls
 * (@yaks/ui's parts): a field per property (`./mod.ts` `fields`), a row's
 * value as its control holds it (`valued`) and back as a bundle (`patch`), a
 * row's name (`title`) and line (`described`), what a row holds shown as words
 * (`drawValue`), and the whole form a row is added, edited and deleted with
 * (`drawForm`). Nothing here knows an app or a store: `client` is any store's
 * names (`./api/client.js`, or `store(base)` for another app's store).
 *
 * @module
 */
import { drawField, drawNativeInput, time } from '@yaks/ui/parts'
import { day } from '@yaks/ui/relative'

/** The most rows a list or a picker reads. */
export let MAX = 200

// A date-time as a datetime-local control holds it: the writer's own clock.
let local = (iso) => {
  let at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  let two = (n) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${
    two(at.getHours())
  }:${two(at.getMinutes())}`
}

/** A stored value as its control holds it, always text. */
/// valued({ control: 'lines' }, ['a', 'b']) -> 'a\nb'
/// valued({ control: 'bool' }, true) -> 'true'
/// valued({ control: 'bool' }, false) -> ''
/// valued({ control: 'text' }, null) -> ''
/// valued({ control: 'pick' }, { eid: 'u1', name: 'Ada' }) -> 'u1'
export let valued = (f, raw) => {
  if (raw == null || raw === false) return ''
  // A reference a read names (`created.by` as `{eid, name}`) holds its eid.
  if (typeof raw == 'object' && typeof raw.eid == 'string') return raw.eid
  if (f.control == 'time') return local(raw)
  if (f.control == 'lines') return raw.join('\n')
  if (f.control == 'json' || typeof raw == 'object') {
    return JSON.stringify(raw, null, 2)
  }
  return String(raw)
}

// What a control holds, as the value to store: null clears it.
let stored = (f, text) => {
  if (f.control == 'bool') return text == 'true'
  if (text.trim() == '') return null
  if (f.control == 'number') {
    let n = Number(text)
    if (Number.isNaN(n)) throw new Error(`${f.label} should be a number`)
    return n
  }
  if (f.control == 'time') {
    let at = new Date(text)
    if (Number.isNaN(at.getTime())) {
      throw new Error(`${f.label} should be a date and time`)
    }
    return at.toISOString()
  }
  if (f.control == 'lines') {
    return text.split('\n').map((l) => l.trim()).filter(Boolean)
  }
  if (f.control == 'json') {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${f.label} should be JSON`)
    }
  }
  return text
}

/** Where a field's value sits in a row, and its control's name. */
/// place({ comp: 'doc', prop: 'title' }) -> 'doc.title'
export let place = (f) => `${f.comp}.${f.prop}`

/** The bundle that makes a row say what its form says: only what changed, so
 * a value nobody touched is never rewritten. Nothing changed is null. */
/// let f = [{ comp: 'note', prop: 'n', control: 'number', label: 'N' }]
/// patch({ name: 'note', fields: f }, { entity: { eid: 'a' }, note: { n: 1 } }, { 'note.n': '2' })
///   -> { entity: { eid: 'a' }, note: { n: 2 } }
/// patch({ name: 'note', fields: f }, null, {})
///   -> { entity: { eid: '$row' }, note: {} }
/// patch({ name: 'note', fields: f }, { entity: { eid: 'a' }, note: { n: 1 } }, { 'note.n': '1' })
///   -> null
/// patch({ name: 'note', fields: [{ ...f[0], readOnly: true }] }, { entity: { eid: 'a' }, note: { n: 1 } }, { 'note.n': '2' })
///   -> null
export let patch = (kind, row, typed) => {
  let out = { entity: { eid: row?.entity.eid ?? '$row' } }
  if (!row) out[kind.name] = {}
  for (let f of kind.fields) {
    if (f.readOnly) continue
    let text = typed[place(f)]
    if (text == null || text == valued(f, row?.[f.comp]?.[f.prop])) continue
    let value = stored(f, text)
    if (value == null && !row) continue
    out[f.comp] = { ...out[f.comp], [f.prop]: value }
  }
  return Object.keys(out).length > 1 ? out : null
}

/** What a row is called in a list and a picker. */
/// title({ doc: { title: 'Budget' } }) -> 'Budget'
/// title({ notice: { posted: null, text: 'Road closed' } }, 'notice') -> 'Road closed'
/// title({ attachment: { name: 'a.pdf' } }) -> 'a.pdf'
/// title({ entity: {} }) -> 'Untitled'
export let title = (row, name, fields = []) => {
  let own = row[name] ?? {}
  let [key, value] =
    Object.entries(own).find(([, v]) => typeof v == 'string' && v) ?? []
  let date = fields.some((f) =>
    f.comp == name && f.prop == key && f.control == 'time'
  )
  let text = row.doc?.title || own.title || own.name ||
    row.attachment?.name || row.doc?.body ||
    (date ? day(value) : value)
  return text ? String(text).split('\n')[0].slice(0, 120) : 'Untitled'
}

/** `h` for a document: `h(tag, attrs, ...kids)` makes an element, listening
 * for each `on…` attribute. */
export let el = (doc) => (tag, attrs = {}, ...kids) => {
  let node = doc.createElement(tag)
  for (let [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (k == 'value') node.value = v
    else node.setAttribute(k, v === true ? '' : v)
  }
  for (let kid of kids.flat()) {
    if (kid != null) node.append(kid)
  }
  return node
}

/** A kit timestamp (@yaks/ui `time`) in a document. */
export let stamp = (doc, at) =>
  time((tag, props, ...children) => {
    let node = doc.createElement(tag)
    for (let [key, value] of Object.entries(props ?? {})) {
      if (value != null) node.setAttribute(key, String(value))
    }
    node.textContent = children.join('')
    return node
  }, { at }) ?? doc.createElement('span')

let says = (doc, f, raw) => {
  if (raw == null || raw === '') return null
  if (f.control == 'time') return stamp(doc, raw)
  if (f.control == 'bool') return raw ? f.label : null
  if (['pick', 'file', 'json'].includes(f.control)) return null
  return `${raw}`.split('\n')[0].slice(0, 60)
}

/** What a row's line adds under its name: the kind's first few plain values
 * beside what the name already said. */
export let described = (doc, kind, row) => {
  let name = title(row, kind.name, kind.fields)
  return kind.fields.filter((f) => f.comp != 'doc')
    .map((f) => says(doc, f, row[f.comp]?.[f.prop]))
    .filter((s) => s && (typeof s != 'string' || !name.startsWith(s))).slice(
      0,
      3,
    )
    .flatMap((part, i) => i ? [' · ', part] : [part])
}

/** A notice: what a form or a page says to the person. */
export let notice = (h, text, no = false) =>
  h(
    'p',
    { class: `Notice${no ? ' Notice-negative' : ''}`, role: 'status' },
    text,
  )

/** The controls of a store's rows, drawn in `doc`: `client` is the store's
 * names, `kinds` what it keeps (`./mod.ts` `kinds`), `files` the address its
 * uploads are read at, and `accepts` the files its uploads take. */
export let controls = ({ doc, client, kinds = [], files, accepts }) => {
  let h = el(doc)
  let fieldsOf = (name) => kinds.find((k) => k.name == name)?.fields

  // The rows a reference can point at, the one it points at first in case it
  // is too old to be among them.
  let picks = async (f, value) => {
    let line = f.ref == 'entity' || !f.ref ? '.doc' : `.${f.ref}`
    let [rows, held] = await Promise.all([
      client.query(`${line}&?doc&.order=-created.at&.limit=${MAX}`),
      value ? client.query(`id=${value}&*`) : [],
    ])
    let seen = new Set()
    return [...held, ...rows].filter((r) =>
      !seen.has(r.entity.eid) && seen.add(r.entity.eid)
    ).map((r) => [r.entity.eid, title(r, f.ref, fieldsOf(f.ref))])
  }

  // A file's name and whether it is a picture, from its attachment row.
  let attachment = async (sha) =>
    sha
      ? (await client.query(`.attachment.blob=${sha}`))[0]?.attachment ?? {}
      : {}

  let fileControl = (f, id, value, writes, changed) => {
    let hold = drawNativeInput(h, { type: 'hidden', name: place(f), value })
    let shown = h('div', { class: 'Form_Line' })
    let said = notice(h, '')
    let tell = (text, no = false) => {
      said.textContent = text
      said.className = `Notice${no ? ' Notice-negative' : ''}`
    }
    let show = async (sha) => {
      let at = await attachment(sha)
      shown.replaceChildren(
        ...sha
          ? [
            at.mime?.startsWith('image/')
              ? h('img', {
                class: 'Data_Image',
                src: files + sha,
                alt: at.name ?? '',
              })
              : '',
            h(
              'a',
              { href: files + sha, target: '_blank', rel: 'noopener' },
              at.name ?? 'The file',
            ),
            writes
              ? h('button', {
                class: 'Button',
                type: 'button',
                onclick: () => set(''),
              }, 'Remove')
              : '',
          ]
          : [h('span', { class: 'Rows_Meta' }, 'No file')],
      )
    }
    let set = (sha) => {
      hold.value = sha
      changed()
      return show(sha)
    }
    // The drop zone (@yaks/ui `Drop`, the platform's drop.js); what is kept
    // shows above it, so it lists nothing chosen of its own.
    let pick = drawNativeInput(h, {
      class: 'Drop_File',
      id,
      type: 'file',
      accept: accepts,
      onchange: async (e) => {
        let file = e.target.files?.[0]
        if (!file) return
        tell(`Uploading ${file.name}…`)
        try {
          await set((await client.upload(file)).eid)
          tell('')
          e.target.value = ''
        } catch (err) {
          tell(err.message, true)
        }
      },
    })
    let zone = h(
      'div',
      { class: 'Drop' },
      h(
        'label',
        { class: 'Drop_Zone' },
        pick,
        h(
          'span',
          { class: 'Drop_Say' },
          h('span', { class: 'Drop_Choose' }, 'Choose a file'),
          ' or drop it here',
        ),
      ),
    )
    void show(value).catch((err) => tell(err.message, true))
    return [hold, shown, writes ? zone : null, said]
  }

  /** A value kept and not edited here, as words where a control would be: a
   * reference by its row's name, a file by its link. */
  let drawValue = async (f, id, raw) => {
    if (f.control == 'file') {
      let [, link] = fileControl(f, id, raw ?? '', false, () => {})
      return link
    }
    let none = h('p', { class: 'Form_Value Form_Value-none' }, 'None')
    if (f.control == 'bool') {
      return h('p', { class: 'Form_Value' }, raw ? 'Yes' : 'No')
    }
    if (raw == null || raw === '') return none
    if (typeof raw == 'object' && typeof raw.name == 'string') {
      return h('p', { class: 'Form_Value' }, raw.name)
    }
    if (f.control == 'pick') {
      let [to] = await client.query(`id=${raw}&*`)
      return h(
        'p',
        { class: 'Form_Value' },
        to ? title(to, f.ref, fieldsOf(f.ref)) : raw,
      )
    }
    if (f.control == 'url') {
      return h(
        'p',
        { class: 'Form_Value' },
        h('a', { href: raw, target: '_blank', rel: 'noopener' }, raw),
      )
    }
    let text = f.control == 'time' ? stamp(doc, raw) : valued(f, raw)
    let long = f.control == 'json' || typeof raw == 'object'
    return text ? h(long ? 'pre' : 'p', { class: 'Form_Value' }, text) : none
  }

  /** The control a field is edited with, holding `value` (`valued`). */
  let drawControl = async (f, id, value, writes, changed) => {
    let attrs = { id, name: place(f), disabled: !writes }
    if (f.control == 'file') {
      return fileControl(f, id, value, writes, changed)
    }
    if (f.control == 'pick' || f.control == 'choice') {
      let choices = f.control == 'pick'
        ? await picks(f, value)
        : f.choices.map((c) => [c, c])
      return drawField(
        h,
        { ...attrs, choose: true },
        h('option', { value: '' }, 'None'),
        choices.map(([v, label]) =>
          h('option', { value: v, selected: v == value }, label)
        ),
      )
    }
    if (f.control == 'bool') {
      return h(
        'label',
        { class: 'Check' },
        drawNativeInput(h, {
          ...attrs,
          class: 'Check_Input',
          type: 'checkbox',
          value: 'true',
          checked: value == 'true',
        }),
        h('span', {}, f.label),
      )
    }
    if (['text', 'lines', 'json'].includes(f.control)) {
      return drawField(h, {
        ...attrs,
        lines: true,
        placeholder: {
          text: 'Type a value…',
          lines: 'One item per line',
          json: 'Enter a JSON value',
        }[f.control],
        value,
      })
    }
    if (f.control == 'time') {
      return drawField(h, { ...attrs, type: 'datetime-local', value })
    }
    // An address may be relative to the app, a file beside its page
    // (`tee.svg`), which a browser's url field refuses.
    if (f.control == 'url') {
      return drawField(h, {
        ...attrs,
        type: 'text',
        inputmode: 'url',
        placeholder: 'https://example.com or a file name',
        value,
      })
    }
    return drawField(h, {
      ...attrs,
      type: f.control,
      step: f.control == 'number' ? 'any' : null,
      placeholder: 'e.g. 12',
      value,
    })
  }

  /** A field shown with its label and hint: a control where `writes` and the
   * field is not the app's own, else its value as words. */
  let drawFieldOf = async (f, i, row, value, writes, changed) => {
    let id = `field-${f.comp}-${f.prop}-${i}`
    if (f.readOnly) {
      return h(
        'div',
        { class: 'Form_Field' },
        h('span', { class: 'Form_Label' }, f.label),
        await drawValue(f, id, row?.[f.comp]?.[f.prop]),
        f.hint ? h('p', { class: 'Form_Hint' }, f.hint) : null,
      )
    }
    return h(
      'div',
      { class: 'Form_Field' },
      f.control == 'bool'
        ? null
        : h('label', { class: 'Form_Label', for: id }, f.label),
      await drawControl(f, id, value, writes, changed),
      f.hint ? h('p', { class: 'Form_Hint' }, f.hint) : null,
    )
  }

  return { h, picks, drawValue, drawControl, drawField: drawFieldOf }
}

/** The form a row of `kind` is added (`row` absent) or edited with, kept as a
 * draft while it is typed (M-59093): `who` is the store's `me()`, `desk` its
 * `drafts()` (null for nobody signed in), `done` is called once it saved or
 * deleted, and `redraw` once its draft was discarded. The form is the
 * element answered; it saves through `client.apply`. */
export let drawForm = async (
  { doc, client, kinds, kind, row, who, desk, files, accepts, done, redraw },
) => {
  let { h, drawField } = controls({ doc, client, kinds, files, accepts })
  let eid = row?.entity.eid
  let writes = who.writes
  // What was typed and not saved, here or on another device (M-59093).
  let spot = `data:${kind.name}:${eid ?? 'new'}`
  let unsaved = desk?.text(spot) ||
    (client.draftEid && who.person
      ? (await client.query(`id=${client.draftEid(who.person, spot)}&*`)
        .catch(() => []))[0]?.draft?.text
      : '')
  let typed = {}
  try {
    typed = unsaved ? JSON.parse(unsaved) : {}
  } catch { /* two devices' edits merged into something else: start over */ }

  let page
  let note = notice(h, '')
  let telling = (text, no = false) => {
    note.textContent = text
    note.className = `Notice${no ? ' Notice-negative' : ''}`
  }
  // What the form writes, and what it shows: a new row has nothing yet of
  // what the app keeps for itself.
  let written = kind.fields.filter((f) => !f.readOnly)
  let shown = row ? kind.fields : written
  // What the form says now, beside what the row holds.
  let saying = () =>
    Object.fromEntries(
      written.map((f) => {
        let field = page.querySelector(`[name="${place(f)}"]`)
        let text = f.control == 'bool'
          ? field.checked ? 'true' : ''
          : field.value
        return [place(f), text]
      }),
    )
  let changes = () =>
    Object.fromEntries(
      Object.entries(saying()).filter(([name, text]) => {
        let f = kind.fields.find((f) => place(f) == name)
        return text != valued(f, row?.[f.comp]?.[f.prop])
      }),
    )
  let changed = () =>
    page && writes && desk?.type(
      spot,
      Object.keys(changes()).length ? JSON.stringify(changes()) : '',
    )
  let parts = await Promise.all(
    shown.map((f, i) =>
      drawField(
        f,
        i,
        row,
        typed[place(f)] ?? valued(f, row?.[f.comp]?.[f.prop]),
        writes,
        changed,
      )
    ),
  )

  let saved = (also) =>
    desk
      ? desk.spend(spot, also).then((ok) => ok || client.apply(also))
      : client.apply(also)
  let save = async (e) => {
    e.preventDefault()
    try {
      let bundle = patch(kind, row, saying())
      if (!bundle) return done()
      telling('Saving…')
      await saved([bundle])
      done()
    } catch (err) {
      telling(err.message, true)
    }
  }
  let sure = false
  let remove = async (e) => {
    if (!sure) {
      sure = true
      e.target.textContent =
        globalThis.matchMedia?.('(pointer: coarse)').matches
          ? 'Tap again to delete'
          : 'Click again to delete'
      return
    }
    try {
      telling('Deleting…')
      await saved([{ entity: { eid }, tombstone: {} }])
      done()
    } catch (err) {
      telling(err.message, true)
    }
  }
  let discard = () =>
    desk.spend(spot).then(() => redraw()).catch((err) =>
      telling(err.message, true)
    )
  if (Object.keys(typed).length) {
    telling('Your unsaved changes are back.')
  }
  page = h(
    'form',
    {
      class: 'Form Page_Form',
      onsubmit: save,
      oninput: changed,
      onchange: changed,
    },
    parts,
    writes
      ? h(
        'div',
        { class: 'Form_Actions' },
        h('button', { class: 'Button Button-go', type: 'submit' }, 'Save'),
        Object.keys(typed).length
          ? h('button', {
            class: 'Button',
            type: 'button',
            onclick: discard,
          }, 'Discard changes')
          : null,
        eid
          ? h('button', {
            class: 'Button',
            type: 'button',
            onclick: remove,
          }, 'Delete')
          : null,
      )
      : null,
    note,
  )
  return page
}
