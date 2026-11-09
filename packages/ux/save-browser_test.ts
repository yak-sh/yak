import { signal } from '@preact/signals'
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { bindSave, type SaveOptions } from './save-browser.ts'

let markup = `<html><body><main>
  <form data-save="operator">
    <input type="hidden" name="token" value="csrf">
    <div class="Form_Field"><label class="Form_Label" for="instructions">Instructions</label><textarea id="instructions" name="instructions">Be brief</textarea></div>
    <label class="Form_Field">Model<input name="model" value="small"></label>
    <fieldset data-save-field>
      <legend>Mode</legend>
      <label><input type="radio" name="mode" value="ask" checked>Ask</label>
      <label><input type="radio" name="mode" value="act">Act</label>
    </fieldset>
    <div class="Form_Field"><label><input type="checkbox" name="enabled" value="yes" checked>Enabled</label></div>
  </form>
  <form data-save="space">
    <div class="Form_Field"><label class="Form_Label" for="name">Name</label><input id="name" name="name" value="My space"></div>
  </form>
</main></body></html>`

let stash = () => {
  let values = signal<Record<string, string>>({})
  return {
    text: (place: string) => values.value[place] ?? '',
    type: (place: string, text: string) => {
      if ((values.peek()[place] ?? '') != text) {
        values.value = { ...values.peek(), [place]: text }
      }
    },
  }
}

let page = (
  width = 1280,
  drafts = stash(),
  more: Partial<SaveOptions> = {},
) => {
  let { document, window } = parseHTML(markup)
  let globals = { document, innerWidth: width, innerHeight: 800 }
  let prior = Object.keys(globals).map((k) =>
    [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const
  )
  for (let [k, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, k, { value, configurable: true })
  }
  // Linkedom has no control state or layout engine; supply the checked state
  // a browser gives the parsed inputs, and exercise the document at each width.
  for (let c of document.querySelectorAll<HTMLInputElement>('input')) {
    c.checked = c.hasAttribute('checked')
  }
  let sent: { form: string; body: [string, FormDataEntryValue][] }[] = []
  let errors: unknown[] = [], saved = 0
  let binding = bindSave(document, {
    drafts,
    save: (form, body) => {
      sent.push({ form: form.dataset.save!, body: [...body.entries()] })
      return Promise.resolve()
    },
    report: (error) => errors.push(error),
    saved: () => saved++,
    ...more,
  })
  let $ = <T extends Element = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!
  let field = (name: string) =>
    $<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)
  let fire = (el: Element, type = 'input') =>
    el.dispatchEvent(
      new window.Event(type, { bubbles: true, cancelable: true }),
    )
  return {
    $,
    field,
    fire,
    binding,
    drafts,
    sent,
    errors,
    saved: () => saved,
    type: (name: string, value: string) => {
      let c = field(name)
      c.value = value
      fire(c)
    },
    [Symbol.dispose]: () => {
      binding.close()
      for (let [k, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, k, descriptor)
        else delete (globalThis as Record<string, unknown>)[k]
      }
    },
  }
}

for (let width of [1280, 390]) {
  test(`marking a field leaves its label and control tree unchanged at ${width}px`, async () => {
    using p = page(width)
    let field = p.field('model').parentElement!
    let label = field.querySelector('.Save_Label')!
    let shape = () => [...field.querySelectorAll('*')]
    let before = shape()
    equal(label.textContent, 'Model')
    p.type('model', 'large')
    equal(field.hasAttribute('data-changed'), true)
    equal(shape(), before)
    equal(label.textContent, 'Model')
    p.binding.discard()
    equal(field.hasAttribute('data-changed'), false)
    equal(shape(), before)
    p.type('model', 'large')
    await p.binding.save()
    equal(field.hasAttribute('data-changed'), false)
    equal(shape(), before)
  })

  test(`one Save bar counts fields and writes every changed form at ${width}px`, async () => {
    using p = page(width)
    equal(p.$('.Save'), null)
    p.type('instructions', 'Keep my drafts')
    p.type('name', 'Our space')
    equal(p.binding.count, 2)
    equal(p.$('.Save_Count').textContent, '2 changes')
    equal(p.$('body').querySelectorAll('.Save').length, 1)
    equal(p.$('body').querySelectorAll('[data-changed]').length, 2)
    equal(p.$('.Save_Actions .Button-quiet').textContent, 'Discard')
    equal(p.$('.Save_Actions .Button-go').textContent, 'Save')
    await p.binding.save()
    equal(p.sent, [
      {
        form: 'operator',
        body: [
          ['token', 'csrf'],
          ['instructions', 'Keep my drafts'],
          ['model', 'small'],
          ['mode', 'ask'],
          ['enabled', 'yes'],
        ],
      },
      { form: 'space', body: [['name', 'Our space']] },
    ])
    equal(p.saved(), 1)
    equal(p.binding.count, 0)
    equal(p.$('.Save'), null)
    equal(p.$('body').querySelectorAll('[data-changed]').length, 0)
    equal(p.drafts.text('operator:instructions'), '')
  })
}

test('Discard restores text, radios and checkboxes without writing', () => {
  using p = page()
  p.type('instructions', 'Unsaved words')
  let ask = p.$<HTMLInputElement>('[value="ask"]')
  let act = p.$<HTMLInputElement>('[value="act"]')
  ask.checked = false
  act.checked = true
  p.fire(act, 'change')
  let enabled = p.$<HTMLInputElement>('[name="enabled"]')
  enabled.checked = false
  p.fire(enabled, 'change')
  equal(p.binding.count, 3)
  p.binding.discard()
  equal(p.field('instructions').value, 'Be brief')
  equal([ask.checked, act.checked, enabled.checked], [true, false, true])
  equal(p.binding.count, 0)
  equal(p.sent, [])
  equal(p.drafts.text('operator:instructions'), '')
})

test('reload restores unsaved fields and Discard restores their saved values', () => {
  let drafts = stash()
  {
    using p = page(1280, drafts)
    p.type('instructions', 'Do not lose this')
    p.type('name', 'Draft space')
  }
  using p = page(390, drafts)
  equal(p.field('instructions').value, 'Do not lose this')
  equal(p.field('name').value, 'Draft space')
  equal(p.binding.count, 2)
  p.binding.discard()
  equal(p.field('instructions').value, 'Be brief')
  equal(p.field('name').value, 'My space')
  equal(p.binding.count, 0)
})

test('a failed write keeps its draft and leaves successfully saved forms clean', async () => {
  let failed = new Error('Connection interrupted')
  using p = page(1280, stash(), {
    save: (form) =>
      form.dataset.save == 'space' ? Promise.reject(failed) : Promise.resolve(),
  })
  p.type('instructions', 'Saved words')
  p.type('name', 'Pending space')
  await p.binding.save()
  equal(p.binding.count, 1)
  equal(p.errors, [failed])
  equal(p.saved(), 0)
  equal(p.$('[role="alert"]').textContent, failed.message)
  equal(p.drafts.text('operator:instructions'), '')
  ok(p.drafts.text('space:name'))
  p.binding.discard()
  equal(p.field('instructions').value, 'Saved words')
  equal(p.field('name').value, 'My space')
})

test('typing during Save keeps newer edits for the next Save', async () => {
  let pending = Promise.withResolvers<void>()
  let bodies: string[] = []
  using p = page(1280, stash(), {
    save: (_form, body) => {
      bodies.push(String(body.get('instructions')))
      return bodies.length == 1 ? pending.promise : Promise.resolve()
    },
  })
  p.type('instructions', 'First edit')
  let saving = p.binding.save()
  equal(p.$('.Save').getAttribute('aria-busy'), 'true')
  p.type('instructions', 'Second edit')
  await p.binding.save()
  equal(bodies, ['First edit'])
  pending.resolve()
  await saving
  equal(p.field('instructions').value, 'Second edit')
  equal(p.binding.count, 1)
  equal(p.saved(), 0)
  ok(p.drafts.text('operator:instructions'))
  await p.binding.save()
  equal(bodies, ['First edit', 'Second edit'])
  equal(p.binding.count, 0)
  equal(p.saved(), 1)
})

test('Save awaits the draft clear receipt before announcing completion', async () => {
  let drafts = stash()
  let entered = Promise.withResolvers<void>()
  let accepted = Promise.withResolvers<boolean>()
  let order: string[] = []
  using p = page(1280, drafts, {
    drafts: {
      ...drafts,
      spend: (place) => {
        order.push('spend')
        drafts.type(place, '')
        entered.resolve()
        return accepted.promise
      },
    },
    save: () => {
      order.push('write')
      return Promise.resolve()
    },
    saved: () => void order.push('saved'),
  })
  p.type('instructions', 'Accepted settings')
  let saving = p.binding.save()
  await entered.promise
  equal(order, ['write', 'spend'])
  equal(drafts.text('operator:instructions'), '')
  accepted.resolve(true)
  await saving
  equal(order, ['write', 'spend', 'saved'])
})

test('a refused draft clear preserves its recovery copy and reports failure', async () => {
  let drafts = stash()
  using p = page(1280, drafts, {
    drafts: { ...drafts, spend: () => Promise.resolve(false) },
  })
  p.type('instructions', 'Keep the recovery copy')
  let copy = drafts.text('operator:instructions')
  await p.binding.save()
  equal(p.sent.length, 1)
  equal(drafts.text('operator:instructions'), copy)
  equal(p.saved(), 0)
  equal(p.errors.length, 1)
  ok(p.$('.Save [role="alert"]').textContent?.includes('recovery copy'))
})

test('typing while a draft clear awaits its receipt stays pending', async () => {
  let drafts = stash()
  let entered = Promise.withResolvers<void>()
  let accepted = Promise.withResolvers<boolean>()
  using p = page(390, drafts, {
    drafts: {
      ...drafts,
      spend: (place) => {
        drafts.type(place, '')
        entered.resolve()
        return accepted.promise
      },
    },
  })
  p.type('instructions', 'First edit')
  let saving = p.binding.save()
  await entered.promise
  p.type('instructions', 'Newer edit')
  accepted.resolve(true)
  await saving
  equal(
    p.sent[0].body.find(([name]) => name == 'instructions')?.[1],
    'First edit',
  )
  equal(p.field('instructions').value, 'Newer edit')
  equal(p.binding.count, 1)
  equal(p.$('.Save_Count').textContent, '1 change')
  equal(p.saved(), 0)
  ok(drafts.text('operator:instructions'))
})
