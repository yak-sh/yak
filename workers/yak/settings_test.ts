import { signal } from '@preact/signals'
import { equal, test } from '@yaks/testing'
import { bindSave } from '@yaks/ux/save'
import { parseHTML } from 'linkedom'
import { renderToString } from 'preact-render-to-string'
import { desk } from './desk-pages.ts'
import { alertsCard, nameCard } from './operator-page.ts'
import { KEY } from '@yaks/connections'

let drafts = () => {
  let texts = signal<Record<string, string>>({})
  return {
    text: (place: string) => texts.value[place] ?? '',
    type: (place: string, text: string) => {
      texts.value = { ...texts.value, [place]: text }
    },
  }
}

let editing = async (
  html: string,
  act: (at: {
    document: Document
    input: (name: string, value: string) => void
    save: ReturnType<typeof bindSave>
    writes: {
      action: string | null
      body: Record<string, FormDataEntryValue>
    }[]
  }) => Promise<void> | void,
) => {
  let { document, window } = parseHTML(html)
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let writes: {
    action: string | null
    body: Record<string, FormDataEntryValue>
  }[] = []
  for (
    let field of document.querySelectorAll<HTMLInputElement>(
      'input[type=radio],input[type=checkbox]',
    )
  ) {
    field.checked = field.hasAttribute('checked')
  }
  let save = bindSave(document, {
    drafts: drafts(),
    save: (form, body) => {
      writes.push({
        action: form.getAttribute('action'),
        body: Object.fromEntries(body),
      })
      return Promise.resolve()
    },
  })
  try {
    await act({
      document,
      save,
      writes,
      input: (name, value) => {
        let field = document.querySelector<HTMLInputElement>(
          `form[data-save] [name="${name}"]`,
        )!
        field.value = value
        field.dispatchEvent(new window.Event('input', { bubbles: true }))
      },
    })
  } finally {
    save.close()
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

let profile = await desk({
  space: 'ada',
  apps: [],
  name: 'Ada',
  view: 'profile',
}).text()
let preferences = await desk({ space: 'ada', apps: [], view: 'settings' })
  .text()
let operator = `<html><body>${
  renderToString(nameCard('/manage/ada/operator', 'Elihu'))
}${
  renderToString(
    alertsCard('/manage/ada/operator', 'updates', null, 'ada@example.test'),
  )
}</body></html>`
let connectionPage = (open?: string) =>
  desk({
    space: 'ada',
    apps: [],
    view: 'connections',
    connections: {
      on: true,
      list: [{
        eid: 'weather',
        integration: 'Weather',
        own: false,
        each: false,
        status: 'connected',
        account: '',
        keyed: true,
        hosts: ['api.weather.test'],
        face: {
          title: 'Weather',
          tagline: '',
          site: '',
          logo: '',
          image: '',
          instructions: '',
          fields: [KEY],
          theirs: false,
        },
        about: { title: 'Weather', tagline: '', site: '', instructions: '' },
        listed: false,
        scopes: [],
        available: [],
        binding: 'WEATHER',
        apps: [],
        saving: '',
        failed: '',
        instructions: '',
      }],
      services: [],
      built: [],
      borrowed: [],
      open,
    },
  }).text()

let connections = await connectionPage('weather')

test('profile and space settings save their changed fields from the page bar', async () => {
  for (
    let [html, field, value] of [[profile, 'name', 'Ada Lovelace'], [
      preferences,
      'title',
      'Family',
    ]] as const
  ) {
    await editing(html, async ({ input, save, writes, document }) => {
      input(field, value)
      equal(save.count, 1)
      equal(
        [...document.querySelectorAll('form[data-save] button')].some((b) =>
          b.textContent == 'Save'
        ),
        false,
      )
      await save.save()
      equal(writes[0].body[field], value)
      equal(save.count, 0)
    })
  }
})

test('Operator changes in separate cards are sent together, and Discard restores them', async () => {
  await editing(operator, async ({ input, save, writes, document }) => {
    input('name', 'Caleb')
    let email = document.querySelector<HTMLInputElement>(
      '[name=channel][value=email]',
    )!
    for (
      let radio of document.querySelectorAll<HTMLInputElement>('[name=channel]')
    ) radio.checked = radio == email
    email.dispatchEvent(
      new (document.defaultView!).Event('change', { bubbles: true }),
    )
    equal(save.count, 2)
    await save.save()
    equal(writes.map((w) => [w.action, w.body.name ?? w.body.channel]), [
      ['/manage/ada/operator?name=1', 'Caleb'],
      ['/manage/ada/operator?alerts=1', 'email'],
    ])
    input('name', 'Another name')
    save.discard()
    equal(
      document.querySelector<HTMLInputElement>('[name=name]')!.value,
      'Caleb',
    )
    equal(save.count, 0)
  })
})

test('connection key and description edits keep their form actions in one Save', async () => {
  await editing(connections, async ({ input, save, writes, document }) => {
    input('key', 'new-key')
    input('tagline', 'The forecast')
    equal(save.count, 2)
    equal(document.querySelector('dialog .Save') != null, true)
    await save.save()
    equal(writes.map((w) => [w.body.do, w.body.connection]), [[
      'key',
      'weather',
    ], ['about', 'weather']])
    equal(writes[0].body.key, 'new-key')
    equal(writes[1].body.tagline, 'The forecast')
  })
})

test('connection forms bind their drafts before opening from a hash and keep them across closing', async () => {
  await editing(
    await connectionPage(),
    async ({ document, input, save, writes }) => {
      let dialog = document.querySelector('dialog')!
      Object.assign(dialog, {
        close: () => dialog.removeAttribute('open'),
        showModal: () => dialog.setAttribute('open', ''),
      })
      let location = new URL('https://yaks.app/manage/ada/connections#weather')
      let code = await Deno.readTextFile(
        new URL('./public/modal.js', import.meta.url),
      )
      new Function('document', 'globalThis', 'location', 'fetch', code)(
        document,
        document.defaultView,
        location,
        () => {
          throw new Error('The connection should be ready')
        },
      )
      input('key', 'draft key')
      equal(save.count, 1)
      let field = dialog.querySelector('[name=key]')!
      for (let hash of ['', '#weather']) {
        location.hash = hash
        document.defaultView!.dispatchEvent(
          new document.defaultView!.Event('hashchange'),
        )
      }
      equal(dialog.querySelector('[name=key]'), field)
      equal(save.count, 1)
      await save.save()
      equal(writes.map((w) => [w.body.do, w.body.connection, w.body.key]), [[
        'key',
        'weather',
        'draft key',
      ]])
    },
  )
})
