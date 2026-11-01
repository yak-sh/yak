// An app's data editor (apps.ts serves it at `<app>/_web/data`): its rows
// listed, added, edited and removed, generated from the words its vocab.json
// declares, through the same `./api/*` doors its own pages use. Nothing here
// knows an app: `kinds` and `fields` read a declaration into data, `valued` and
// `patch` turn a row and a form into a bundle, and `open` draws them with
// yaks.app's controls (controls.css).

// What is not a row a person keeps: a link between rows, what lives only in a
// page or a moment, and what each person holds privately.
let kept = (def) =>
  def.properties && !def.edge && !def.personal && !def.tool && !def.tools &&
  (def.sync == null || def.sync == 'server') &&
  (def.durable == null || def.durable == 'forever')

let MAX = 200

let spoken = (word) => {
  let text = word.replaceAll('_', ' ')
  return text[0].toUpperCase() + text.slice(1)
}

let lines = (s) => s.type == 'array' && (s.items?.type ?? 'string') == 'string'

// The control a property is edited with, from what it declares. A file is a
// reference to the platform's `blob`, or the guide's `blob` text property.
let control = (prop, s) => {
  if (s.ref == 'blob' || (prop == 'blob' && s.type == 'string')) return 'file'
  if (s.ref) return 'pick'
  if (s.enum) return 'choice'
  if (s.type == 'number' || s.type == 'integer') return 'number'
  if (s.type == 'boolean') return 'bool'
  if (lines(s)) return 'lines'
  if (s.type != 'string') return 'json'
  if (s.format == 'date-time') return 'time'
  if (s.format == 'uri') return 'url'
  return 'text'
}

/// fields('note', { properties: { when: { type: 'string', format: 'date-time' } } }).map((f) => f.control)
///   -> ['text', 'text', 'time']
export let fields = (name, def) => [
  ...[['title', 'Title'], ['body', 'Text']]
    .filter(([prop]) => !def.properties?.[prop])
    .map(([prop, label]) => ({
      comp: 'doc',
      prop,
      label,
      control: 'text',
    })),
  ...Object.entries(def.properties ?? {})
    .filter(([, s]) =>
      !s.computed && !s.stamped && !s.status && !s.contentEncoding
    )
    .map(([prop, s]) => ({
      comp: name,
      prop,
      label: spoken(prop),
      hint: s.description,
      control: control(prop, s),
      ref: s.ref,
      choices: s.enum,
    })),
]

// What a row's list shows of a kind, and the rows that kind's words have no
// row for: an app whose rows are plain docs still has rows to edit.
/// kinds({ link: { properties: { url: { type: 'string' } } }, tap: { edge: true, properties: {} } }).map((k) => k.name)
///   -> ['link', 'doc']
export let kinds = (defs = {}) => {
  let own = Object.entries(defs).filter(([, def]) => kept(def))
    .map(([name, def]) => ({
      name,
      label: spoken(name),
      hint: def.description,
      line: `.${name}`,
      fields: fields(name, def),
    }))
  return [...own, {
    name: 'doc',
    label: own.length ? 'Other rows' : 'Rows',
    line: ['.doc', '!comment', ...own.map((k) => `!${k.name}`)].join('&'),
    fields: fields('doc', { properties: {} }),
  }]
}

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
export let patch = (kind, row, typed) => {
  let out = { entity: { eid: row?.entity.eid ?? '$row' } }
  if (!row) out[kind.name] = {}
  for (let f of kind.fields) {
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
export let title = (row, name) => {
  let own = row[name] ?? {}
  let text = row.doc?.title || own.title || own.name ||
    row.attachment?.name || row.doc?.body ||
    Object.values(own).find((v) => typeof v == 'string' && v)
  return text ? String(text).split('\n')[0].slice(0, 120) : 'Untitled'
}

let says = (f, raw) => {
  if (raw == null || raw === '') return null
  if (f.control == 'time') return new Date(raw).toLocaleString()
  if (f.control == 'bool') return raw ? f.label : null
  if (['pick', 'file', 'json'].includes(f.control)) return null
  return `${raw}`.split('\n')[0].slice(0, 60)
}

// What a row's line adds under its name: the kind's first few plain values
// beside what the name already said.
let described = (kind, row) => {
  let name = title(row, kind.name)
  return kind.fields.filter((f) => f.comp != 'doc')
    .map((f) => says(f, row[f.comp]?.[f.prop]))
    .filter((s) => s && !name.startsWith(s)).slice(0, 3).join(' · ')
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
export let open = ({ root, client, words, view, files }) => {
  let h = el(root.ownerDocument)
  let all = kinds(words.$defs)
  let me = client.me()
  let drafts = me.then((m) => m.person ? client.drafts({ by: m.person }) : null)
  let drawn = 0
  let accepts = words.blob?.contentMediaType

  let say = (text, no = false) =>
    h('p', { class: `Say${no ? ' Say-no' : ''}`, role: 'status' }, text)
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
                title(r, kind.name),
              ),
              h('span', { class: 'Rows_Meta' }, described(kind, r)),
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
                { class: 'Button', href: `#${kind.name}/new` },
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
    ).map((r) => [r.entity.eid, title(r, f.ref)])
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
              ? h('img', { src: files + sha, alt: at.name ?? '' })
              : '',
            h(
              'a',
              { href: files + sha, target: '_blank', rel: 'noopener' },
              at.name ?? 'The file',
            ),
            writes
              ? h('button', {
                class: 'Button Button-quiet',
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
    let pick = h('input', {
      class: 'Field',
      id,
      type: 'file',
      accept: accepts,
      onchange: async (e) => {
        let file = e.target.files?.[0]
        if (!file) return
        said.textContent = `Uploading ${file.name}…`
        said.className = 'Say'
        try {
          await set((await client.upload(file)).eid)
          said.textContent = ''
          e.target.value = ''
        } catch (err) {
          said.textContent = err.message
          said.className = 'Say Say-no'
        }
      },
    })
    void show(value).catch(failed)
    return [hold, shown, writes ? pick : null, said]
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
        { class: 'Choice' },
        h('input', {
          ...attrs,
          class: null,
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
      note.className = `Say${no ? ' Say-no' : ''}`
    }
    // What the form says now, beside what the row holds.
    let saying = () =>
      Object.fromEntries(
        kind.fields.map((f) => {
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
      kind.fields.map(async (f, i) => {
        let id = `field-${i}`
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
      { class: 'Form', onsubmit: save, oninput: changed, onchange: changed },
      parts,
      writes
        ? h(
          'div',
          { class: 'Form_Actions' },
          h('button', { class: 'Button', type: 'submit' }, 'Save'),
          Object.keys(typed).length
            ? h('button', {
              class: 'Button Button-quiet',
              type: 'button',
              onclick: discard,
            }, 'Discard changes')
            : null,
          eid
            ? h('button', {
              class: 'Button Button-quiet',
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
            row ? title(row, kind.name) : `New: ${kind.label.toLowerCase()}`,
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
