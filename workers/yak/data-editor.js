import { day } from '@yaks/ui/relative'
import { stamp } from './dates.ts'
// An app's data editor (apps.ts serves it at `<app>/_web/data`): its rows
// listed, added, edited and removed, generated from the words its vocab.json
// declares, through the same `./api/*` doors its own pages use. Nothing here
// knows an app: the page hands it the kinds its words keep (data.ts `kinds`),
// `valued` and `patch` turn a row and a form into a bundle, and `open` draws
// them with yaks.app's controls (@yaks/ui's parts, drawn by the pencil skin).
// A field the app keeps for itself (`readOnly`) is shown, never a control.

let MAX = 200

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
export let valued = (f, raw) => {
  if (raw == null || raw === false) return ''
  if (f.control == 'time') return local(raw)
  if (f.control == 'lines') return raw.join('\n')
  if (f.control == 'json') return JSON.stringify(raw, null, 2)
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

let place = (f) => `${f.comp}.${f.prop}`

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

let says = (doc, f, raw) => {
  if (raw == null || raw === '') return null
  if (f.control == 'time') return stamp(doc, raw)
  if (f.control == 'bool') return raw ? f.label : null
  if (['pick', 'file', 'json'].includes(f.control)) return null
  return `${raw}`.split('\n')[0].slice(0, 60)
}

// What a row's line adds under its name: the kind's first few plain values
// beside what the name already said.
let described = (doc, kind, row) => {
  let name = title(row, kind.name, kind.fields)
  return kind.fields.filter((f) => f.comp != 'doc')
    .map((f) => says(doc, f, row[f.comp]?.[f.prop]))
    .filter((s) => s && (typeof s != 'string' || !name.startsWith(s))).slice(
      0,
      3,
    )
    .flatMap((part, i) => i ? [' · ', part] : [part])
}

let el = (doc) => (tag, attrs = {}, ...kids) => {
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

/** Draw the editor in `root`. `view` holds the route in its location's hash. */
export let open = ({ root, client, kinds: all, accepts, view, files }) => {
  let doc = root.ownerDocument
  let h = el(doc)
  let me = client.me()
  let drafts = me.then((m) => m.person ? client.drafts({ by: m.person }) : null)
  let drawn = 0

  let say = (text, no = false) =>
    h(
      'p',
      { class: `Notice${no ? ' Notice-negative' : ''}`, role: 'status' },
      text,
    )
  let paint = (...kids) => root.replaceChildren(...kids)
  let failed = (e) => {
    paint(say(e.message, true))
    if (!e.refused && e.status == null) throw e
  }
  let card = (head, ...kids) =>
    h(
      'section',
      { class: 'Card' },
      h('header', { class: 'Card_Head' }, ...head),
      ...kids,
    )
  let back = (href, text) => h('p', {}, h('a', { href }, `← ${text}`))

  let overview = async () => {
    let at = drawn
    let counts = await Promise.all(
      all.map((k) => client.query(`${k.line}&.count`)),
    )
    if (at != drawn) return
    let shown = all.map((k, i) => ({ ...k, count: counts[i]?.count ?? 0 }))
      // A word with nothing in it to write and no rows has nothing to edit, and
      // "Other rows" shows only where there are some.
      .filter((k) =>
        k.count ||
        (k.name == 'doc'
          ? all.length == 1
          : k.fields.some((f) => f.comp != 'doc'))
      )
    paint(card(
      [h('h2', { class: 'Card_Title' }, 'What this app keeps')],
      h(
        'ul',
        { class: 'Rows' },
        shown.map((k) =>
          h(
            'li',
            { class: 'Rows_Item' },
            h(
              'div',
              { class: 'Rows_Main' },
              h(
                'a',
                { class: 'Rows_Name', href: `#${k.name}` },
                k.label,
              ),
              h(
                'span',
                { class: 'Rows_Meta' },
                `${k.count} ${k.count == 1 ? 'row' : 'rows'}`,
              ),
            ),
          )
        ),
      ),
    ))
  }

  let list = async (kind) => {
    let at = drawn
    let [rows, who] = await Promise.all([
      client.query(`${kind.line}&?doc&.order=-created.at&.limit=${MAX}`),
      me,
    ])
    if (at != drawn) return
    let items = h('ul', { class: 'Rows' })
    let fill = (words = '') => {
      let matching = rows.filter((r) =>
        JSON.stringify([r.doc, r[kind.name]]).toLowerCase()
          .includes(words.toLowerCase())
      )
      items.replaceChildren(
        ...matching.map((r) =>
          h(
            'li',
            { class: 'Rows_Item' },
            h(
              'div',
              { class: 'Rows_Main' },
              h(
                'a',
                { class: 'Rows_Name', href: `#${kind.name}/${r.entity.eid}` },
                title(r, kind.name, kind.fields),
              ),
              h('span', { class: 'Rows_Meta' }, ...described(doc, kind, r)),
            ),
          )
        ),
      )
    }
    fill()
    paint(
      all.length > 1 ? back('#', 'Everything') : '',
      card(
        [
          h('h2', { class: 'Card_Title' }, kind.label),
          who.writes
            ? h(
              'div',
              { class: 'Card_Actions' },
              h(
                'a',
                { class: 'Button Button-go', href: `#${kind.name}/new` },
                'Add',
              ),
            )
            : null,
        ],
        kind.hint ? h('p', { class: 'Card_Sub' }, kind.hint) : null,
        rows.length > 8
          ? h('input', {
            class: 'Field',
            type: 'search',
            placeholder: 'Find a row',
            'aria-label': 'Find a row',
            oninput: (e) => fill(e.target.value),
          })
          : null,
        rows.length ? items : h('p', {}, 'Nothing here yet.'),
        rows.length == MAX
          ? h('p', { class: 'Form_Hint' }, `The newest ${MAX} rows.`)
          : null,
      ),
    )
  }

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
    ).map((
      r,
    ) => [
      r.entity.eid,
      title(r, f.ref, all.find((k) => k.name == f.ref)?.fields),
    ])
  }

  // A file's name and whether it is a picture, from its attachment row.
  let named = async (sha) =>
    sha
      ? (await client.query(`.attachment.blob=${sha}`))[0]?.attachment ?? {}
      : {}

  let fileControl = (f, id, value, writes, changed) => {
    let hold = h('input', { type: 'hidden', name: place(f), value })
    let shown = h('div', { class: 'Form_Line' })
    let said = say('')
    let show = async (sha) => {
      let at = await named(sha)
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
    // The drop zone (@yaks/ui `Drop`, public/drop.js); what is kept
    // shows above it, so it lists nothing chosen of its own.
    let pick = h('input', {
      class: 'Drop_File',
      id,
      type: 'file',
      accept: accepts,
      onchange: async (e) => {
        let file = e.target.files?.[0]
        if (!file) return
        said.textContent = `Uploading ${file.name}…`
        said.className = 'Notice'
        try {
          await set((await client.upload(file)).eid)
          said.textContent = ''
          e.target.value = ''
        } catch (err) {
          said.textContent = err.message
          said.className = 'Notice Notice-negative'
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
    void show(value).catch(failed)
    return [hold, shown, writes ? zone : null, said]
  }

  // A value the app keeps for itself, as words where a control would be: a
  // reference by its row's name, a file by its link.
  let valueOf = async (f, id, raw) => {
    if (f.control == 'file') {
      let [, link] = fileControl(f, id, raw ?? '', false, () => {})
      return link
    }
    let none = h('p', { class: 'Form_Value Form_Value-none' }, 'None')
    if (f.control == 'bool') {
      return h('p', { class: 'Form_Value' }, raw ? 'Yes' : 'No')
    }
    if (raw == null || raw === '') return none
    if (f.control == 'pick') {
      let [to] = await client.query(`id=${raw}&*`)
      return h(
        'p',
        { class: 'Form_Value' },
        to ? title(to, f.ref, all.find((k) => k.name == f.ref)?.fields) : raw,
      )
    }
    let text = f.control == 'time' ? stamp(doc, raw) : valued(f, raw)
    return text ? h('p', { class: 'Form_Value' }, text) : none
  }

  let controlOf = async (f, id, value, writes, changed) => {
    let attrs = { class: 'Field', id, name: place(f), disabled: !writes }
    if (f.control == 'file') {
      return fileControl(f, id, value, writes, changed)
    }
    if (f.control == 'pick' || f.control == 'choice') {
      let choices = f.control == 'pick'
        ? await picks(f, value)
        : f.choices.map((c) => [c, c])
      return h(
        'select',
        attrs,
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
        h('input', {
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
      let area = h('textarea', attrs)
      area.value = value
      return area
    }
    return h('input', {
      ...attrs,
      type: { number: 'number', time: 'datetime-local', url: 'url' }[f.control],
      step: f.control == 'number' ? 'any' : null,
      value,
    })
  }

  let form = async (kind, eid) => {
    let at = drawn
    let [rows, who, desk] = await Promise.all([
      eid ? client.query(`id=${eid}&*`) : [],
      me,
      drafts,
    ])
    if (at != drawn) return
    let row = rows[0]
    if (eid && !row) {
      return paint(
        back(`#${kind.name}`, kind.label),
        say('That row is gone.', true),
      )
    }
    let writes = who.writes
    // What was typed and not saved, here or on another device (M-59093).
    let spot = `data:${kind.name}:${eid ?? 'new'}`
    let unsaved = desk?.text(spot) ||
      (await client.query(`id=${client.draftEid(who.person, spot)}&*`).catch(
        () => [],
      ))[0]?.draft?.text
    let typed = {}
    try {
      typed = unsaved ? JSON.parse(unsaved) : {}
    } catch { /* two devices' edits merged into something else: start over */ }
    if (at != drawn) return

    let page
    let note = say('')
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
      shown.map(async (f, i) => {
        let id = `field-${i}`
        if (f.readOnly) {
          return h(
            'div',
            { class: 'Form_Field' },
            h('span', { class: 'Form_Label' }, f.label),
            await valueOf(f, id, row[f.comp]?.[f.prop]),
            f.hint ? h('p', { class: 'Form_Hint' }, f.hint) : null,
          )
        }
        let value = typed[place(f)] ?? valued(f, row?.[f.comp]?.[f.prop])
        let control = await controlOf(f, id, value, writes, changed)
        return h(
          'div',
          { class: 'Form_Field' },
          f.control == 'bool'
            ? null
            : h('label', { class: 'Form_Label', for: id }, f.label),
          control,
          f.hint ? h('p', { class: 'Form_Hint' }, f.hint) : null,
        )
      }),
    )
    if (at != drawn) return

    let saved = (also) =>
      desk
        ? desk.spend(spot, also).then((ok) => ok || client.apply(also))
        : client.apply(also)
    let leave = () => {
      view.location.hash = `#${kind.name}`
    }
    let save = async (e) => {
      e.preventDefault()
      try {
        let bundle = patch(kind, row, saying())
        if (!bundle) return leave()
        telling('Saving…')
        await saved([bundle])
        leave()
      } catch (err) {
        telling(err.message, true)
      }
    }
    let sure = false
    let remove = async (e) => {
      if (!sure) {
        sure = true
        e.target.textContent = 'Press again to delete'
        return
      }
      try {
        telling('Deleting…')
        await saved([{ entity: { eid }, tombstone: {} }])
        leave()
      } catch (err) {
        telling(err.message, true)
      }
    }
    let discard = () =>
      desk.spend(spot).then(() => route()).catch((err) =>
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
    paint(
      back(`#${kind.name}`, kind.label),
      card(
        [
          h(
            'h2',
            { class: 'Card_Title' },
            row
              ? title(row, kind.name, kind.fields)
              : `New: ${kind.label.toLowerCase()}`,
          ),
        ],
        page,
      ),
    )
  }

  let route = () => {
    drawn++
    let [name, eid] = view.location.hash.slice(1).split('/')
    let kind = all.find((k) => k.name == name)
    let only = all.filter((k) => k.name != 'doc')
    if (!kind && only.length == 1) kind = only[0]
    let drawing = !kind
      ? overview()
      : eid
      ? form(kind, eid == 'new' ? undefined : eid)
      : list(kind)
    return drawing.catch(failed)
  }
  view.addEventListener('hashchange', route)
  return route()
}
