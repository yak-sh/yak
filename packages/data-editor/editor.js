/**
 * The data editor: a store's rows listed, added, edited and removed,
 * generated from the words it declares, through the same `./api/*` doors its
 * own pages use. yaks.app serves it for every app at `<app>/_web/data`.
 * Nothing here knows an app: the page hands it the kinds its words keep
 * (`./mod.ts` `kinds`), and `./form.js` draws them with yaks.app's controls.
 * A field the app keeps for itself (`readOnly`) is shown, never a control.
 *
 * @module
 */
import { drawField } from '@yaks/ui/parts'
import { described, drawForm, el, MAX, notice, title } from './form.js'

export { patch, title, valued } from './form.js'

/** Draw the editor in `root`. `view` holds the route in its location's hash. */
export let open = ({ root, client, kinds: all, accepts, view, files }) => {
  let doc = root.ownerDocument
  let h = el(doc)
  let me = client.me()
  let drafts = me.then((m) => m.person ? client.drafts({ by: m.person }) : null)
  let drawn = 0

  let paint = (...kids) => root.replaceChildren(...kids)
  let failed = (e) => {
    paint(notice(h, e.message, true))
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
          ? drawField(h, {
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
        notice(h, 'That row is gone.', true),
      )
    }
    let page = await drawForm({
      doc,
      client,
      kinds: all,
      kind,
      row,
      who,
      desk,
      files,
      accepts,
      done: () => view.location.hash = `#${kind.name}`,
      redraw: () => route(),
    })
    if (at != drawn) return
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
