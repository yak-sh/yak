import { button, el } from './dom.js'
import { id, title } from './model.js'

export let transfer = (
  { heading, items, select, selected, navigate, handover },
) =>
  el(
    'div',
    {},
    heading(
      'For the next chapter',
      'Make a portable house manual for a future owner, or a copy to keep offline.',
    ),
    el(
      'div',
      { class: 'handover-intro' },
      el('span', { class: 'handover-intro_Icon' }, '↗'),
      el(
        'div',
        {},
        el(
          'h2',
          { class: 'handover-intro_Title' },
          'Choose what goes with the house',
        ),
        el(
          'p',
          { class: 'handover-intro_Text' },
          'Download a standalone HTML file to open or print to PDF. Selected items, their documents and your circuit directory travel with it. Review the contents before you give it to someone. Contacts are not included.',
        ),
      ),
    ),
    el(
      'div',
      { class: 'section-head' },
      el('h2', { class: 'section-head_Title' }, 'Included items'),
      button('Select all', () => {
        items().forEach((r) => select(id(r), true))
        navigate('handover')
      }, 'section-head_Action'),
    ),
    el(
      'div',
      { class: 'handover-list' },
      items().map((row) =>
        el(
          'label',
          { class: 'check' },
          el('input', {
            class: 'check_Input',
            type: 'checkbox',
            checked: selected.has(id(row)),
            onChange: (event) => select(id(row), event.target.checked),
          }),
          el(
            'span',
            {},
            el('strong', { class: 'check_Title' }, title(row)),
            el('small', { class: 'check_Detail' }, row.house_item.category),
          ),
        )
      ),
    ),
    el(
      'label',
      { class: 'check' },
      el('input', {
        class: 'check_Input',
        type: 'checkbox',
        id: 'include-history',
      }),
      'Include the selected items’ logbook history (may contain costs and names)',
    ),
    el(
      'p',
      { class: 'muted' },
      'Home name, address, welcome notes and shutoff locations are included. Uploaded documents are embedded in the download. Linked documents keep their original addresses.',
    ),
    button(
      'Download handover manual',
      () => handover(!!document.getElementById('include-history')?.checked),
      'primary',
    ),
  )
