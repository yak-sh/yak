import { fileMark, fileUrl, imageUrl, preview } from './media.js'
import { transfer } from './handover-view.js'
import { button, el, empty, part, tag } from './dom.js'
import { categories, date, due, id, itemName, safeUrl, title } from './model.js'

export let view = (
  {
    data,
    edit,
    open,
    navigate,
    complete,
    remove,
    handover,
    select,
    selected,
    who,
  },
) => {
  let items = () => data.house_item
  let add = (kind, label, defaults) =>
    who.writes
      ? button(label, () => edit(kind, null, defaults), 'primary')
      : null
  let heading = (name, body, action) =>
    el(
      'div',
      { class: 'page-heading' },
      el(
        'div',
        {},
        el('h1', { class: 'page-heading_Title' }, name),
        el('p', { class: 'page-heading_Text' }, body),
      ),
      part(action, 'page-heading_Action'),
    )
  let card = (row) =>
    el(
      'button',
      {
        class: 'item-card',
        type: 'button',
        onClick: () => open(id(row)),
      },
      preview(
        data.house_file.find((file) =>
          file.house_file.item === id(row) && imageUrl(file)
        ),
        'item-photo',
        () =>
          el(
            'div',
            { class: 'item-symbol' },
            symbol(row.house_item.category),
          ),
      ),
      el(
        'div',
        { class: 'item-card_Body' },
        tag(row.house_item.category),
        el('h3', { class: 'item-card_Title' }, title(row)),
        el(
          'p',
          { class: 'item-card_Text' },
          [row.house_item.brand, row.house_item.model].filter(Boolean).join(
            ' · ',
          ) || 'Details ready to add',
        ),
        el(
          'small',
          { class: 'item-card_Location' },
          row.house_item.location || 'Location not recorded',
        ),
      ),
      el('span', { class: 'arrow' }, '↗'),
    )
  let rowActions = (kind, row) =>
    who.writes
      ? el(
        'div',
        { class: 'row-actions' },
        button('Edit', () => edit(kind, row), 'row-actions_Button'),
        button('Remove', () => remove(row), 'row-actions_Button quiet'),
      )
      : null
  let doc = (row) => {
    let f = row.house_file,
      url = fileUrl(row)
    return el(
      'article',
      { class: 'list-row' },
      imageUrl(row)
        ? el(
          'a',
          {
            href: url,
            target: '_blank',
            rel: 'noopener',
            class: 'list-row_Link photo-link',
            'aria-label': `Open ${title(row)}`,
          },
          preview(row, 'document-photo', () =>
            el('span', { class: 'file-icon' }, fileMark(row))),
        )
        : el('span', { class: 'file-icon' }, fileMark(row)),
      el(
        'div',
        { class: 'grow' },
        url
          ? el(
            'a',
            {
              class: 'list-row_Link',
              href: url,
              target: '_blank',
              rel: 'noopener',
            },
            title(row),
          )
          : el('strong', {}, title(row)),
        el(
          'p',
          { class: 'list-row_Text related-item' },
          f.item
            ? el('a', {
              class: 'list-row_Link related-item_Link',
              href: '#item/' + f.item,
              onClick: (event) => {
                event.preventDefault()
                open(f.item)
              },
            }, itemName(items(), f.item))
            : 'House reference',
        ),
        row.doc?.body
          ? el('p', { class: 'list-row_Text document-notes' }, row.doc.body)
          : null,
      ),
      el(
        'small',
        {},
        f.blob
          ? 'Saved copy'
          : f.reference
          ? 'Website reference'
          : 'Copy not saved yet',
      ),
      rowActions('house_file', row),
    )
  }
  let log = (row) =>
    el(
      'article',
      { class: 'log-row' },
      el('time', { class: 'log-row_Date' }, date(row.house_record.date)),
      el(
        'div',
        { class: 'grow' },
        tag(row.house_record.kind || 'Note'),
        el('h3', { class: 'log-row_Title' }, title(row)),
        row.house_record.item
          ? el(
            'p',
            { class: 'log-row_Text muted' },
            itemName(items(), row.house_record.item),
          )
          : null,
        el('p', { class: 'log-row_Text notes' }, row.doc?.body || ''),
        el(
          'small',
          {},
          [
            row.house_record.provider,
            row.house_record.cost != null
              ? `$${row.house_record.cost.toFixed(2)}`
              : '',
          ].filter(Boolean).join(' · '),
        ),
      ),
      rowActions('house_record', row),
    )
  let reminder = (row) =>
    el(
      'article',
      { class: 'list-row' },
      el(
        'div',
        { class: 'date-chip ' + (due(row) ? 'overdue' : '') },
        el(
          'strong',
          { class: 'date-chip_Day' },
          row.house_care.due?.slice(8) || '—',
        ),
        el(
          'span',
          { class: 'date-chip_Month' },
          row.house_care.due
            ? new Date(row.house_care.due + 'T12:00:00').toLocaleDateString(
              undefined,
              { month: 'short' },
            )
            : '',
        ),
      ),
      el(
        'div',
        { class: 'grow' },
        el('h3', { class: 'list-row_Title' }, title(row)),
        el(
          'p',
          { class: 'list-row_Text' },
          row.house_care.item
            ? itemName(items(), row.house_care.item)
            : 'Whole house',
        ),
        el(
          'small',
          {},
          `${date(row.house_care.due)}${
            row.house_care.months
              ? ` · Every ${row.house_care.months} months`
              : ' · One time'
          }`,
        ),
        row.doc?.body
          ? el('p', { class: 'list-row_Text notes' }, row.doc.body)
          : null,
      ),
      who.writes
        ? el(
          'div',
          { class: 'row-actions' },
          button(
            'Mark done',
            () => complete(row),
            'row-actions_Button primary',
          ),
          button('Edit', () => edit('house_care', row), 'row-actions_Button'),
          button('Remove', () => remove(row), 'row-actions_Button quiet'),
        )
        : null,
    )
  let docs = (rows) =>
    rows.length ? el('div', { class: 'list' }, rows.map(doc)) : empty(
      'Keep the paperwork with the house',
      'Add manuals, receipts, warranties, plans and photos. Upload a file or save a link.',
    )
  let logs = (rows) =>
    rows.length
      ? el(
        'div',
        { class: 'logbook' },
        [...rows].sort((a, b) =>
          (b.house_record.date || '').localeCompare(a.house_record.date || '')
        ).map(log),
      )
      : empty(
        'The next chapter starts here',
        'Record a repair, a service visit, a new appliance or a small detail worth remembering.',
      )
  let reminders = (rows) =>
    rows.length
      ? el(
        'div',
        { class: 'list' },
        [...rows].sort((a, b) =>
          (a.house_care.due || '').localeCompare(b.house_care.due || '')
        ).map(reminder),
      )
      : empty(
        'A little care, on time',
        'Add your own maintenance dates. Completing a reminder writes to the logbook and schedules its next occurrence.',
      )
  let overview = () => {
    let profile = data.house_profile[0], p = profile?.house_profile || {}
    return el(
      'div',
      {},
      el(
        'section',
        { class: 'hero' },
        el(
          'div',
          {},
          el('span', { class: 'eyebrow' }, 'A home, well remembered'),
          el(
            'h1',
            { class: 'hero_Title' },
            title(profile) === 'Untitled'
              ? 'Your house, in one place'
              : title(profile),
          ),
          el(
            'p',
            { class: 'hero_Text' },
            'The details that make a house yours. The knowledge that helps you care for it.',
          ),
          el(
            'div',
            { class: 'hero-actions' },
            part(add('house_item', '+ Add an item'), 'hero-actions_Action'),
            button(
              'Write in the logbook',
              () => navigate('logbook'),
              'hero-actions_Action',
            ),
          ),
        ),
        houseDrawing(),
      ),
      el(
        'div',
        { class: 'stats' },
        [
          ['Items in your manual', items().length, 'manual'],
          ['Documents & links', data.house_file.length, 'documents'],
          ['Due for attention', data.house_care.filter(due).length, 'care'],
          ['Logbook entries', data.house_record.length, 'logbook'],
        ].map(([label, n, page]) =>
          el(
            'button',
            {
              class: 'stats_Button',
              type: 'button',
              onClick: () => navigate(page),
            },
            el('strong', { class: 'stats_Value' }, String(n)),
            el('span', { class: 'stats_Label' }, label),
          )
        ),
      ),
      el(
        'div',
        { class: 'section-head' },
        el('h2', { class: 'section-head_Title' }, 'Explore your home'),
        button(
          'See the full manual →',
          () => navigate('manual'),
          'section-head_Action text-button',
        ),
      ),
      el(
        'div',
        { class: 'category-grid' },
        categories.map((category) =>
          el(
            'button',
            {
              type: 'button',
              class: 'category',
              onClick: () => navigate('manual', category),
            },
            el('span', { class: 'category-icon' }, symbol(category)),
            el('strong', { class: 'category_Title' }, category),
            el(
              'small',
              { class: 'category_Count' },
              `${
                items().filter((r) => r.house_item.category === category).length
              } items`,
            ),
          )
        ),
      ),
      el(
        'div',
        { class: 'two-columns' },
        el(
          'section',
          {},
          el(
            'div',
            { class: 'section-head' },
            el('h2', { class: 'section-head_Title' }, 'Next on the list'),
            button(
              'All care →',
              () => navigate('care'),
              'section-head_Action text-button',
            ),
          ),
          reminders(
            [...data.house_care].sort((a, b) =>
              (a.house_care.due || '').localeCompare(b.house_care.due || '')
            ).slice(0, 3),
          ),
        ),
        el(
          'section',
          {},
          el(
            'div',
            { class: 'section-head' },
            el('h2', { class: 'section-head_Title' }, 'Know where to look'),
            who.writes
              ? button(
                'Edit',
                () => edit('house_profile', profile),
                'section-head_Action text-button',
              )
              : null,
          ),
          el(
            'div',
            { class: 'shutoffs' },
            [['Water shutoff', p.water], ['Gas shutoff', p.gas], [
              'Electrical disconnect',
              p.electric,
            ]].map(([label, value]) =>
              el(
                'div',
                { class: 'shutoffs_Row' },
                el('strong', { class: 'shutoffs_Title' }, label),
                el(
                  'p',
                  { class: 'shutoffs_Text' },
                  value || 'Location not recorded',
                ),
              )
            ),
          ),
        ),
      ),
      profile?.doc?.body
        ? el(
          'section',
          { class: 'home-note' },
          el('h2', {}, 'About this home'),
          el('p', { class: 'notes' }, profile.doc.body),
        )
        : null,
    )
  }
  let manual = (rows, category) =>
    el(
      'div',
      {},
      heading(
        'The house manual',
        'Every system, fixture and finish — with its details close at hand.',
        add('house_item', '+ Add an item', {
          category: category || categories[0],
        }),
      ),
      el(
        'div',
        { class: 'filters' },
        button(
          'Everything',
          () => navigate('manual'),
          !category ? 'filters_Button active' : 'filters_Button',
        ),
        categories.map((c) =>
          button(
            c,
            () => navigate('manual', c),
            c === category ? 'filters_Button active' : 'filters_Button',
          )
        ),
      ),
      rows.length ? el('div', { class: 'items-grid' }, rows.map(card)) : empty(
        'Room for the details',
        'Add the model number, paint color, warranty or instructions you will be glad to find later.',
        add('house_item', 'Add the first item', {
          category: category || categories[0],
        }),
      ),
    )
  let detail = (row) => {
    let p = row.house_item,
      related = (kind) => data[kind].filter((r) => r[kind].item === id(row))
    let section = (name, kind, render) =>
      el(
        'section',
        {},
        el(
          'div',
          { class: 'section-head' },
          el('h2', { class: 'section-head_Title' }, name),
          part(add(kind, '+ Add', { item: id(row) }), 'section-head_Action'),
        ),
        render(related(kind)),
      )
    return el(
      'div',
      {},
      button('← House manual', () => navigate('manual'), 'text-button'),
      heading(
        title(row),
        [p.category, p.location].filter(Boolean).join(' / '),
        who.writes
          ? button('Edit details', () => edit('house_item', row), 'primary')
          : null,
      ),
      el(
        'div',
        { class: 'detail-grid' },
        el(
          'section',
          { class: 'details' },
          el('h2', { class: 'details_Title' }, 'At a glance'),
          el(
            'dl',
            { class: 'details_List' },
            [
              ['Brand', p.brand],
              ['Model', p.model],
              ['Serial number', p.serial],
              ['Manufactured', p.manufactured],
              ['Installed', p.installed],
              ['Warranty', p.warranty],
            ].map((
              [label, value],
            ) => [
              el('dt', { class: 'details_Label' }, label),
              el('dd', { class: 'details_Value' }, value || 'Not recorded'),
            ])
              .flat(),
          ),
        ),
        el(
          'section',
          { class: 'details' },
          el('h2', { class: 'details_Title' }, 'Good to know'),
          el(
            'p',
            { class: 'details_Text notes' },
            row.doc?.body ||
              'Add specifications, instructions and the little things only you know.',
          ),
        ),
      ),
      section('Documents & photos', 'house_file', docs),
      section('Maintenance', 'house_care', reminders),
      section('History', 'house_record', logs),
      who.writes
        ? el(
          'div',
          { class: 'detail-footer' },
          button('Remove this item', () => remove(row), 'quiet'),
          el('small', {}, 'Linked documents and history are kept.'),
        )
        : null,
    )
  }
  let panel = (rows) =>
    el(
      'div',
      {},
      heading(
        'Electrical directory',
        'Labels transcribed from your panel notes. Verify at the panel before use.',
        add('house_circuit', '+ Add a circuit'),
      ),
      el(
        'div',
        { class: 'panel-columns' },
        ['Left', 'Right'].map((side) =>
          el(
            'section',
            { class: 'breaker-panel' },
            el('h2', { class: 'breaker-panel_Title' }, side + ' slots'),
            rows.filter((r) => r.house_circuit.side === side).sort((a, b) =>
              parseInt(a.house_circuit.slots) - parseInt(b.house_circuit.slots)
            ).map((row) =>
              el(
                'article',
                { class: 'breaker ' + (row.house_circuit.off ? 'off' : '') },
                el('strong', { class: 'slot' }, row.house_circuit.slots),
                el(
                  row.house_circuit.off ? 's' : 'span',
                  { class: 'amps' },
                  row.house_circuit.amps,
                ),
                el(
                  'span',
                  { class: 'grow' },
                  title(row),
                  row.house_circuit.off ? tag('OFF') : null,
                ),
                who.writes
                  ? button('Edit', () => edit('house_circuit', row), 'quiet')
                  : null,
              )
            ),
          )
        ),
      ),
    )
  let contacts = (rows) =>
    el(
      'div',
      {},
      heading(
        'People who know the house',
        'The right number when you need a hand.',
        add('house_contact', '+ Add a contact'),
      ),
      rows.length
        ? el(
          'div',
          { class: 'items-grid' },
          rows.map((row) =>
            el(
              'article',
              { class: 'contact' },
              tag(row.house_contact.trade || 'Contact'),
              el('h2', { class: 'contact_Name' }, title(row)),
              row.house_contact.phone
                ? el(
                  'a',
                  {
                    class: 'contact_Link',
                    href: 'tel:' + row.house_contact.phone,
                  },
                  row.house_contact.phone,
                )
                : null,
              row.house_contact.email
                ? el(
                  'a',
                  {
                    class: 'contact_Link',
                    href: 'mailto:' + row.house_contact.email,
                  },
                  row.house_contact.email,
                )
                : null,
              safeUrl(row.house_contact.website)
                ? el('a', {
                  class: 'contact_Link',
                  href: safeUrl(row.house_contact.website),
                  target: '_blank',
                  rel: 'noopener',
                }, 'Visit website ↗')
                : null,
              el('p', { class: 'contact_Notes notes' }, row.doc?.body || ''),
              rowActions('house_contact', row),
            )
          ),
        )
        : empty(
          'Your trusted people',
          'Keep the plumber, electrician, HVAC technician, insurer and other contacts here.',
        ),
    )
  return {
    overview,
    manual,
    detail,
    panel,
    contacts,
    transfer: () =>
      transfer({ heading, items, select, selected, navigate, handover }),
    docs,
    logs,
    reminders,
    heading,
    add,
  }
}
let symbol = (name) =>
  ({
    'Kitchen & appliances': '▦',
    'Heating & cooling': '≈',
    'Plumbing & water': '◉',
    'Electrical': 'ϟ',
    'Paint & finishes': '◒',
    'Roof & exterior': '⌂',
    'Structure & insulation': '▤',
    'Doors & windows': '⊞',
    'Garden & grounds': '❧',
    'Safety & security': '◇',
    'Insurance & property': '▧',
    'Other': '⋯',
  })[name] || '⌂'
let houseDrawing = () => {
  let drawing = el('div', { class: 'house-drawing', 'aria-hidden': 'true' })
  drawing.innerHTML =
    '<svg class="house-drawing_Image" viewBox="0 0 320 230" fill="none"><g stroke="currentColor" stroke-width="1.5"><path d="M35 115 155 33l124 82M56 100v99h202v-99M37 202h245M70 209h198M155 34v-9l-16-8M224 77V42h20v48M89 197v-65h37v65M159 122h68v42h-68zM193 123v40M160 143h66M103 90h27V66M153 57l87 58M67 107l85-60"/><circle cx="116" cy="163" r="2"/><path d="M281 195c-25-22-16-51-2-60 18 17 21 43 2 60Zm0-3v20M26 198c-13-12-9-27-1-32 9 9 11 23 1 32Zm0-2v15"/></g><g stroke="currentColor" opacity=".25" stroke-dasharray="3 5"><path d="M19 216h283M19 15v200M298 15v200M18 16h282"/></g></svg>'
  return drawing
}
