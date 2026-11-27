/** Save behavior for server-rendered forms, with drafts supplied by the host.
 *
 * A save shows as pending at once. A field's draft stays until its write is
 * answered, and a refusal puts its fields back to unsaved, saying why. */
import { createElement as h } from 'react'
import { surface as drawSurface } from '@yaks/react/draw'
import { Save } from './Save.ts'
import { result } from '@yaks/ui/interaction'

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
type Group = {
  form: HTMLFormElement
  name: string
  place: string
  controls: Control[]
  /** What the host last answered as saved. */
  before: string[]
  /** What a save sent and the host has not answered yet. */
  sent?: string[]
}
type Draft = { before: string[]; value: string[] }

export type SaveOptions = {
  drafts: {
    text: (place: string) => string
    type: (place: string, text: string) => void
    spend?: (place: string) => Promise<boolean>
    /** Run `fn` now and again whenever a text it read changes (@yaks/ux
     * `Drafts`). */
    follow: (fn: () => void) => () => void
  }
  /** Save the captured body, after the page already shows it is saving; a
   * rejection puts its fields back to pending, and a string it resolves to is
   * what the bar says in place of "Saved". */
  save: (form: HTMLFormElement, body: FormData) => Promise<unknown>
  report?: (error: unknown) => void
  /** Called after every changed form's write succeeds and no newer changes
   * or writes remain. */
  saved?: () => void
  /** How long the bar says a save worked before it goes, in milliseconds. */
  linger?: number
}

export type SaveBinding = {
  /** Show the changes saving and write them; resolves once every write this
   * binding has sent is answered. */
  save: () => Promise<void>
  discard: () => void
  report: (error: unknown) => void
  close: () => void
  readonly count: number
}

let controls = (form: HTMLFormElement): Control[] =>
  [...form.querySelectorAll<Control>('input[name],textarea[name],select[name]')]
    .filter((c) =>
      !['hidden', 'submit', 'button', 'file', 'reset'].includes(c.type)
    )

let read = (fields: Control[]): string[] =>
  fields.flatMap((c) =>
    'options' in c && c.multiple
      ? [...c.options].filter((o) => o.selected).map((
        o,
      ) => o.value)
      : 'checked' in c && ['radio', 'checkbox'].includes(c.type)
      ? c.checked ? [c.value] : []
      : [c.value]
  )

let put = (fields: Control[], values: string[]) => {
  for (let c of fields) {
    if ('checked' in c && ['radio', 'checkbox'].includes(c.type)) {
      c.checked = values.includes(c.value)
    } else if ('options' in c && c.multiple) {
      for (let o of c.options) {
        o.selected = values.includes(o.value)
      }
    } else if (c.value != (values[0] ?? '')) c.value = values[0] ?? ''
  }
}

let same = (a: string[], b: string[]) => JSON.stringify(a) == JSON.stringify(b)
// What the page shows as saved: the save sent, until the host answers it.
let shown = (g: Group) => g.sent ?? g.before
let changed = (g: Group) => !same(read(g.controls), shown(g))
// What a draft keeps: anything the host has not answered as saved.
let unconfirmed = (g: Group) => !same(read(g.controls), g.before)
let strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v == 'string')
let draftOf = (text: string): Draft | undefined => {
  if (!text) return
  let value = JSON.parse(text)
  if (!strings(value?.before) || !strings(value?.value)) {
    throw new Error('This draft could not be read. It is kept for recovery.')
  }
  return value
}

// Construct from the document, so this works in any DOM host, including one
// whose FormData implementation cannot read an HTML form itself.
let bodyOf = (form: HTMLFormElement) => {
  let body = new FormData()
  for (
    let c of form.querySelectorAll<Control>(
      'input[name],textarea[name],select[name]',
    )
  ) {
    if (c.disabled || ['submit', 'button', 'reset', 'file'].includes(c.type)) {
      continue
    }
    for (let value of read([c])) body.append(c.name, value)
  }
  return body
}

let bindForms = (
  surface: HTMLElement,
  forms: HTMLFormElement[],
  opts: SaveOptions,
  inline = false,
): SaveBinding => {
  let doc = surface.ownerDocument
  let groups: Group[] = forms.flatMap((form) => {
    let fields = controls(form)
    return [...new Set(fields.map((c) => c.name))].map((name) => {
      let cs = fields.filter((c) => c.name == name)
      return {
        form,
        name,
        controls: cs,
        before: read(cs),
        place: `${form.dataset.save}:${name}`,
      }
    })
  })
  let mount = doc.createElement('div')
  mount.setAttribute('data-save-mounted', '')
  surface.append(mount)
  let marks = new Map<HTMLElement, Group[]>()
  for (let g of groups) {
    for (let c of g.controls) {
      let field = c.closest<HTMLElement>('[data-save-field],.Form_Field') ??
        c.parentElement!
      let marked = marks.get(field)
      if (!marked) marks.set(field, marked = [])
      if (!marked.includes(g)) marked.push(g)
    }
  }
  let labels: HTMLElement[] = [], tagged: Element[] = []
  for (let field of marks.keys()) {
    for (let face of field.children) {
      let heading = face.matches('legend') ||
        face == field.firstElementChild && face.matches('label')
      if (!heading || face.matches('.Form_Label,.Save_Label')) continue
      face.classList.add('Save_Label')
      tagged.push(face)
    }
    if (!field.matches('label')) continue
    let text = [...field.childNodes].find((n) =>
      n.nodeType == 3 && n.textContent?.trim()
    )
    if (!text) continue
    let label = doc.createElement('span')
    label.className = 'Save_Label'
    text.replaceWith(label)
    label.append(text)
    labels.push(label)
  }
  let message = '', done = '', closed = false
  let face = drawSurface(mount)
  // Drafts this binding keeps from the fields it reads are already what
  // those fields show: a change it makes itself is not put back on them.
  let own = false
  let keeping = (fn: () => void) => {
    own = true
    try {
      fn()
    } finally {
      own = false
    }
  }
  let fading: ReturnType<typeof setTimeout> | undefined
  let say = (text: string) => {
    clearTimeout(fading)
    done = text
    if (text) {
      fading = setTimeout(() => {
        done = ''
        draw()
      }, opts.linger ?? 2500)
    }
  }
  let count = () => groups.filter(changed).length
  let draw = () => {
    if (closed) return
    for (let [field, groups] of marks) {
      let pending = groups.some(changed)
      field.classList.add('Save_Field')
      field.classList.toggle('Save_Field-changed', pending)
      field.toggleAttribute('data-changed', pending)
    }
    face.draw(
      h(Save, {
        count: count(),
        busy: waiting > 0,
        inline,
        message,
        done,
        onSave: save,
        onDiscard: discard,
      }),
    )
  }
  let keep = (g: Group) => {
    let text = unconfirmed(g)
      ? JSON.stringify({ before: g.before, value: read(g.controls) })
      : ''
    if (text != opts.drafts.text(g.place)) opts.drafts.type(g.place, text)
  }
  let report = (error: unknown) => {
    message = error instanceof Error ? error.message : String(error)
    opts.report?.(error)
  }
  let discard = () => {
    message = ''
    keeping(() => {
      for (let g of groups) {
        put(g.controls, shown(g))
        keep(g)
      }
    })
    for (let form of forms) {
      form.dispatchEvent(
        new doc.defaultView!.Event('change', { bubbles: true }),
      )
    }
    draw()
  }
  type Sent = {
    form: HTMLFormElement
    body: FormData
    fields: { g: Group; value: string[] }[]
  }
  let writing = Promise.resolve()
  let queued = 0
  let waiting = 0
  // A write that did not go through: its fields read as unsaved again, their
  // drafts kept.
  let unsend = (sends: Sent[]) => {
    for (let { fields } of sends) {
      for (let { g, value } of fields) {
        if (g.sent && same(g.sent, value)) g.sent = undefined
        keep(g)
      }
    }
  }
  // The writes of one save, in order; the first refused stops the rest.
  let send = async (sends: Sent[]) => {
    let said = ''
    let confirmed: Group[] = []
    try {
      for (let [i, { form, body, fields }] of sends.entries()) {
        try {
          let answer = await opts.save(form, body)
          if (typeof answer == 'string') said = answer
        } catch (error) {
          unsend(sends.slice(i))
          throw error
        }
        keeping(() => {
          for (let { g, value } of fields) {
            if (form.hasAttribute('data-save-reset')) {
              if (same(read(g.controls), value)) put(g.controls, g.before)
            } else g.before = value
            if (g.sent && same(g.sent, value)) g.sent = undefined
            if (unconfirmed(g)) keep(g)
          }
        })
        confirmed.push(...fields.map(({ g }) => g))
      }
      if (!count()) say(said || 'Saved')
    } catch (error) {
      say('')
      report(error)
    } finally {
      waiting--
      draw()
    }
    try {
      let cleared = await Promise.all(confirmed.map(async (g) => {
        if (unconfirmed(g) || !opts.drafts.text(g.place)) return true
        if (opts.drafts.spend) return await opts.drafts.spend(g.place)
        opts.drafts.type(g.place, '')
        return true
      }))
      if (cleared.includes(false)) {
        throw new Error(
          'Your settings were saved, but their drafts could not sync. A recovery copy is kept on this device.',
        )
      }
      if (!closed && queued == 1 && !count() && !message) opts.saved?.()
    } catch (error) {
      if (!closed) {
        say('')
        report(error)
      }
    } finally {
      queued--
      draw()
    }
  }
  let save = () => {
    if (!count()) return writing
    let pending = forms.filter((form) =>
      groups.some((g) => g.form == form && changed(g))
    )
    if (pending.some((form) => form.reportValidity?.() === false)) {
      return writing
    }
    let measured = result(doc)
    let sends: Sent[] = pending.map((form) => ({
      form,
      body: bodyOf(form),
      fields: groups.filter((g) => g.form == form).map((g) => ({
        g,
        value: read(g.controls),
      })),
    }))
    for (let { fields } of sends) {
      for (let { g, value } of fields) g.sent = value
    }
    keeping(() => {
      for (let { fields } of sends) {
        for (let { g } of fields) keep(g)
      }
    })
    message = ''
    say('')
    queued++
    waiting++
    draw()
    measured?.drawn(0)
    return writing = writing.then(() => send(sends))
  }
  let input = () => {
    message = ''
    say('')
    keeping(() => {
      for (let g of groups) keep(g)
    })
    draw()
  }
  let submit = (event: Event) => {
    // Action buttons such as Disconnect remain immediate. Enter and submit
    // without a named action save all pending edits.
    if ((event as SubmitEvent).submitter?.getAttribute('name')) return
    event.preventDefault()
    void save()
  }
  for (let form of forms) {
    form.addEventListener('input', input)
    form.addEventListener('change', input)
    form.addEventListener('submit', submit)
  }
  let stop = opts.drafts.follow(() => {
    let texts = groups.map((g) => opts.drafts.text(g.place))
    if (own) return
    for (let [i, g] of groups.entries()) {
      try {
        let draft = draftOf(texts[i])
        put(g.controls, draft?.value ?? shown(g))
      } catch (error) {
        report(error)
      }
    }
    draw()
    for (let form of forms) {
      form.dispatchEvent(new doc.defaultView!.Event('save-restored'))
    }
  })
  return {
    get count() {
      return count()
    },
    save,
    discard,
    report: (error) => {
      report(error)
      draw()
    },
    close: () => {
      closed = true
      clearTimeout(fading)
      stop()
      for (let form of forms) {
        form.removeEventListener('input', input)
        form.removeEventListener('change', input)
        form.removeEventListener('submit', submit)
      }
      for (let field of marks.keys()) {
        field.classList.remove('Save_Field', 'Save_Field-changed')
        field.removeAttribute('data-changed')
      }
      for (let face of tagged) face.classList.remove('Save_Label')
      for (let label of labels) label.replaceWith(...label.childNodes)
      face.close()
      mount.remove()
    },
  }
}

let formsIn = (
  root: Document | HTMLElement,
) => [...root.querySelectorAll<HTMLFormElement>('form[data-save]')]

/** Bind page forms to the viewport bar and each dialog form to its own Save.
 * A form can place those actions beside a field with Save.Slot. */
export let bindSave = (
  root: Document | HTMLElement,
  opts: SaveOptions,
): SaveBinding => {
  let doc = root.ownerDocument ?? root as Document
  let surface = root.nodeType == 9 ? doc.body : root as HTMLElement
  let page = bindForms(
    surface,
    formsIn(root).filter((form) => !form.closest('dialog')),
    opts,
  )
  let dialogs = new Map<HTMLFormElement, SaveBinding>()
  let refresh = () => {
    for (let [form, binding] of dialogs) {
      if (root.contains(form)) continue
      binding.close()
      dialogs.delete(form)
    }
    for (let form of formsIn(root)) {
      if (!form.closest('dialog') || dialogs.has(form)) continue
      let slot = form.querySelector<HTMLElement>('[data-save-slot]') ?? form
      dialogs.set(form, bindForms(slot, [form], opts, true))
    }
  }
  refresh()
  let Observer = doc.defaultView?.MutationObserver
  let hasForm = (n: Node) =>
    n.nodeType == 1 && ((n as Element).matches('form[data-save]') ||
      !!(n as Element).querySelector('form[data-save]'))
  let observer = Observer && new Observer((records) => {
    if (
      !records.some((r) => [...r.addedNodes, ...r.removedNodes].some(hasForm))
    ) return
    refresh()
  })
  observer?.observe(surface, { childList: true, subtree: true })
  let bindings = () => [page, ...dialogs.values()]
  return {
    get count() {
      return bindings().reduce((n, binding) => n + binding.count, 0)
    },
    save: () =>
      dialogs.size
        ? Promise.all(bindings().map((b) => b.save())).then(() => {})
        : page.save(),
    discard: () => bindings().forEach((binding) => binding.discard()),
    report: (error) => {
      let dirty = [...dialogs.values()].filter((binding) => binding.count)
      for (let binding of dirty.length ? dirty : [page]) binding.report(error)
    },
    close: () => {
      observer?.disconnect()
      bindings().forEach((binding) => binding.close())
      dialogs.clear()
    },
  }
}
