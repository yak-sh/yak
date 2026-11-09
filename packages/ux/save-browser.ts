/** Save behavior for server-rendered forms, with drafts supplied by the host. */
import { batch, effect, untracked } from '@preact/signals'
import { h, render } from 'preact'
import { Save as Paint } from '@yaks/ui/parts'
import { Save } from './Save.ts'

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
type Group = {
  form: HTMLFormElement
  name: string
  place: string
  controls: Control[]
  before: string[]
}
type Draft = { before: string[]; value: string[] }

export type SaveOptions = {
  drafts: {
    text: (place: string) => string
    type: (place: string, text: string) => void
    spend?: (place: string) => Promise<boolean>
  }
  /** Save the captured body; a rejection leaves its fields pending. */
  save: (form: HTMLFormElement, body: FormData) => Promise<unknown>
  report?: (error: unknown) => void
  /** Called after every changed form succeeds and no newer changes remain. */
  saved?: () => void
}

export type SaveBinding = {
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
let changed = (g: Group) => !same(read(g.controls), g.before)
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

/** Bind form[data-save] controls to one viewport bar. data-save names each
 * form's stable draft place; repeated names (radio/checkbox choices) are one
 * change. Drafts are reactive, with synchronous recovery supplied by the host. */
export let bindSave = (
  root: Document | HTMLElement,
  opts: SaveOptions,
): SaveBinding => {
  let doc = root.ownerDocument ?? root as Document
  let forms = [...root.querySelectorAll<HTMLFormElement>('form[data-save]')]
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
  let surface = root.nodeType == 9 ? doc.body : root as HTMLElement
  surface.append(mount)
  let marks = new Map<HTMLElement, { slot: HTMLElement; groups: Group[] }>()
  for (let g of groups) {
    for (let c of g.controls) {
      let field = c.closest<HTMLElement>('[data-save-field],.Form_Field') ??
        c.parentElement!
      let mark = marks.get(field)
      if (!mark) {
        let slot = doc.createElement('span')
        field.append(slot)
        marks.set(field, mark = { slot, groups: [] })
      }
      if (!mark.groups.includes(g)) mark.groups.push(g)
    }
  }
  let busy = false, message = '', closed = false
  let count = () => groups.filter(changed).length
  let draw = () => {
    if (closed) return
    let at = root.querySelector('dialog[open]') ?? surface
    if (mount.parentElement != at) at.append(mount)
    for (let [field, mark] of marks) {
      let pending = mark.groups.some(changed)
      field.classList.add('Save_Field')
      field.classList.toggle('Save_Field-changed', pending)
      field.toggleAttribute('data-changed', pending)
      render(pending ? h(Paint.Mark, {}, 'Changed') : null, mark.slot)
    }
    render(
      h(Save, {
        count: count(),
        busy,
        message,
        onSave: save,
        onDiscard: discard,
      }),
      mount,
    )
  }
  let keep = (g: Group) => {
    let text = changed(g)
      ? JSON.stringify({ before: g.before, value: read(g.controls) })
      : ''
    if (text != opts.drafts.text(g.place)) opts.drafts.type(g.place, text)
  }
  let report = (error: unknown) => {
    message = error instanceof Error ? error.message : String(error)
    opts.report?.(error)
  }
  let discard = () => {
    if (busy) return
    message = ''
    batch(() => {
      for (let g of groups) {
        put(g.controls, g.before)
        opts.drafts.type(g.place, '')
      }
    })
    for (let form of forms) {
      form.dispatchEvent(
        new doc.defaultView!.Event('change', { bubbles: true }),
      )
    }
    draw()
  }
  let save = async () => {
    if (busy || !count()) return
    let pending = forms.filter((form) =>
      groups.some((g) => g.form == form && changed(g))
    )
    if (pending.some((form) => form.reportValidity?.() === false)) return
    let snapshots = pending.map((form) => ({
      form,
      body: bodyOf(form),
      fields: groups.filter((g) => g.form == form).map((g) => ({
        g,
        value: read(g.controls),
      })),
    }))
    busy = true
    message = ''
    draw()
    try {
      for (let { form, body, fields } of snapshots) {
        await opts.save(form, body)
        batch(() => {
          for (let { g, value } of fields) {
            g.before = value
            if (changed(g)) keep(g)
          }
        })
        for (let { g } of fields) {
          if (changed(g) || !opts.drafts.text(g.place)) continue
          if (opts.drafts.spend) {
            if (!await opts.drafts.spend(g.place)) {
              throw new Error(
                'Your settings were saved, but their drafts could not sync. A recovery copy is kept on this device.',
              )
            }
          } else opts.drafts.type(g.place, '')
        }
      }
      if (!count()) opts.saved?.()
    } catch (error) {
      report(error)
    } finally {
      busy = false
      draw()
    }
  }
  let input = () => {
    message = ''
    batch(() => {
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
  let stop = effect(() => {
    for (let g of groups) {
      try {
        let draft = draftOf(opts.drafts.text(g.place))
        put(g.controls, draft?.value ?? g.before)
      } catch (error) {
        report(error)
      }
    }
    draw()
    untracked(() => {
      for (let form of forms) {
        form.dispatchEvent(new doc.defaultView!.Event('save-restored'))
      }
    })
  })
  let Observer = doc.defaultView?.MutationObserver
  let observer = Observer && new Observer(draw)
  for (let dialog of root.querySelectorAll('dialog')) {
    observer?.observe(dialog, { attributes: true, attributeFilter: ['open'] })
  }
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
      stop()
      observer?.disconnect()
      for (let form of forms) {
        form.removeEventListener('input', input)
        form.removeEventListener('change', input)
        form.removeEventListener('submit', submit)
      }
      for (let [field, { slot }] of marks) {
        render(null, slot)
        slot.remove()
        field.classList.remove('Save_Field', 'Save_Field-changed')
        field.removeAttribute('data-changed')
      }
      render(null, mount)
      mount.remove()
    },
  }
}
