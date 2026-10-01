// Exercise chat's DOM boundary with the real local graphs and command grammar.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { client, type Saved, stash } from '@yaks/client'
import { draftEid, type Stash } from '@yaks/draft'
import { test, tick, until } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { chatbox } from './chatbox.ts'
import type { CommandFieldOpts } from './command-field.ts'
import { seedDesigns } from './designs_fixture.ts'
import type { overlay } from './fx.ts'
import type { Net } from './net.ts'
import type { Frame } from './play.ts'
import type { Command, Tools } from './slash.ts'
import type { Village } from './village.ts'
import words from './vocab.json' with { type: 'json' }

seedDesigns()

let tools: Tools = Object.fromEntries(
  Object.entries(words.$defs).filter(([, def]) => 'tool' in def && def.tool),
)
let vocab = loadVocab([{
  $defs: {
    beast_design: {
      component: true,
      type: 'object',
      properties: { name: { type: 'string' } },
    },
    alias: { component: true, type: 'object', properties: {} },
    key: {
      component: true,
      type: 'object',
      properties: { of: { type: 'string' }, value: { type: 'string' } },
    },
    position: {
      component: true,
      type: 'object',
      properties: { x: { type: 'number' }, z: { type: 'number' } },
    },
    chat: {
      component: true,
      type: 'object',
      properties: { level: { type: 'string' }, player: { type: 'string' } },
    },
    doc: {
      component: true,
      type: 'object',
      properties: { body: { type: 'string' } },
    },
    created: {
      component: true,
      type: 'object',
      properties: { at: { type: 'number' }, by: { type: 'string' } },
    },
  },
}])
let deferred = <T>() => {
  let resolve!: (value: T) => void
  let promise = new Promise<T>((yes) => resolve = yes)
  return { promise, resolve }
}
let memory = (): Stash => {
  let rows = new Map<string, string>()
  return {
    get length() {
      return rows.size
    },
    key: (i) => [...rows.keys()][i] ?? null,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  }
}

let setup = (
  opts: CommandFieldOpts = {},
  listing: () => Promise<Tools> = () => Promise.resolve(tools),
  execute?: (cmd: Command) => Promise<string>,
) => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let globals = {
    document,
    HTMLElement: window.HTMLElement,
    addEventListener: window.addEventListener.bind(window),
  }
  let before = Object.keys(globals).map((key) =>
    [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ] as const
  )
  for (let [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  // linkedom has no selection API; completion still uses the native input
  // event boundary, with the browser's caret contract supplied here.
  let proto = window.HTMLInputElement.prototype
  let selection = Object.getOwnPropertyDescriptor(proto, 'setSelectionRange')
  Object.defineProperty(proto, 'setSelectionRange', {
    configurable: true,
    value(this: HTMLInputElement, from: number, to = from) {
      this.selectionStart = from
      this.selectionEnd = to
    },
  })
  // linkedom omits the browser's AbortSignal listener option. Supply that
  // platform contract, so close exercises chat's real abort/unbind lifecycle.
  let events = window.EventTarget.prototype
  let add = events.addEventListener
  events.addEventListener = function (type, listener, options) {
    let signal = typeof options == 'object' ? options?.signal : undefined
    if (signal?.aborted) return
    add.call(this, type, listener, options)
    if (signal) {
      signal.addEventListener('abort', () => {
        this.removeEventListener(type, listener, options)
      }, { once: true })
    }
  }
  // The global handler must bind the adapted method, not the earlier one.
  Object.defineProperty(globalThis, 'addEventListener', {
    configurable: true,
    value: (
      type: string,
      listener: EventListener,
      options?: AddEventListenerOptions,
    ) => {
      if (options?.signal?.aborted) return
      globals.addEventListener(type, listener, options)
      options?.signal?.addEventListener('abort', () => {
        window.removeEventListener(type, listener, options)
      }, { once: true })
    },
  })
  let world = client(vocab, [], { vault: false, wireVault: false })
  let store = memory()
  let vault = stash()
  let calls: Command[] = []
  let listings = 0
  let glass = document.createElement('div')
  let opener = document.createElement('button')
  document.body.append(glass, opener)
  let net = {
    client: world,
    hero: 'hero',
    now: () => 1,
    commands: () => {
      listings++
      return listing()
    },
    who: () => null,
  } as unknown as Net
  let folk = {
    near: () => null,
    lines: () => [],
    who: () => null,
  } as unknown as Village
  let chat = chatbox(
    glass,
    opener,
    net,
    {} as ReturnType<typeof overlay>,
    folk,
    (cmd) => {
      calls.push(cmd)
      return execute?.(cmd) ?? Promise.resolve('Done.')
    },
    { vault, stash: store, pace: 0, ...opts },
  )
  chat.me({
    person: 'player',
    name: 'Player',
    role: null,
    reads: true,
    writes: true,
    signIn: null,
  })
  let form = glass.querySelector('form')!
  let input = glass.querySelector('input')!
  let focused = false
  input.focus = () => focused = true
  input.blur = () => focused = false
  let event = (target: EventTarget, type: string, more = {}) => {
    let e = Object.assign(
      new window.Event(type, { bubbles: true, cancelable: true }),
      more,
    )
    target.dispatchEvent(e)
    return e
  }
  let press = (target: EventTarget, key: string, mods = {}) =>
    event(target, 'keydown', { key, ...mods })
  let type = (text: string, caret = text.length) => {
    input.value = text
    input.setSelectionRange(caret, caret)
    event(input, 'input')
  }
  let draw = () => {
    chat.tick({
      level: 'test-level',
      body: { x: 0, z: 0 },
      others: [],
      givers: [],
    } as unknown as Frame, () => null)
    return glass.querySelector('.Chat_Log')!.textContent ?? ''
  }
  return {
    document,
    glass,
    opener,
    world,
    store,
    savedDraft: async () =>
      (await vault.load()).find((row) =>
        row.eid == draftEid('player', 'mossvale.chat')
      )?.comps.draft?.text,
    chat,
    form,
    input,
    calls,
    event,
    press,
    type,
    draw,
    get focused() {
      return focused
    },
    get listings() {
      return listings
    },
    ready: () => until(() => !input.disabled, { label: 'chat ready' }),
    choices: () => [...glass.querySelectorAll('.Choices_Item')],
    close: async () => {
      chat.close()
      world.close()
      await tick()
      events.addEventListener = add
      if (selection) {
        Object.defineProperty(proto, 'setSelectionRange', selection)
      } else Reflect.deleteProperty(proto, 'setSelectionRange')
      for (let [key, descriptor] of before) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

test('chat shortcuts focus a line without taking another field’s keys', async () => {
  let h = setup()
  try {
    await h.ready()
    h.type('old draft')
    assertEquals(h.press(h.document.body, '/').defaultPrevented, true)
    assertEquals(h.form.hidden, false)
    assertEquals(h.focused, true)
    assertEquals(h.input.value, '/')

    h.type('/help')
    assertEquals(h.press(h.input, '/').defaultPrevented, false)
    assertEquals(h.input.value, '/help')
    h.press(h.input, 'Escape')
    assertEquals(h.form.hidden, true)
    assertEquals(h.focused, false)

    for (let tag of ['input', 'textarea', 'select', 'div']) {
      let field = h.document.createElement(tag)
      if (tag == 'div') field.setAttribute('contenteditable', 'true')
      h.document.body.append(field)
      assertEquals(h.press(field, '/').defaultPrevented, false)
      assertEquals(h.form.hidden, true)
    }
    for (let modifier of ['ctrlKey', 'altKey', 'metaKey']) {
      assertEquals(
        h.press(h.document.body, '/', { [modifier]: true }).defaultPrevented,
        false,
      )
      assertEquals(h.form.hidden, true)
    }
    h.glass.hidden = true
    assertEquals(h.press(h.document.body, '/').defaultPrevented, false)
    h.glass.hidden = false
    h.type('')
    assertEquals(h.press(h.document.body, 'Enter').defaultPrevented, true)
    assertEquals(h.form.hidden, false)
    assertEquals(h.focused, true)
    assertEquals(h.input.value, '')
    h.event(h.opener, 'click')
    assertEquals(h.form.hidden, true)
    h.event(h.opener, 'click')
    assertEquals(h.form.hidden, false)
    assertEquals(h.event(h.opener, 'pointerdown').defaultPrevented, true)
    assertEquals(h.form.hidden, false)
    h.event(h.document.body, 'pointerdown')
    assertEquals(h.form.hidden, true)
  } finally {
    await h.close()
  }
})

test('chat gates typing and submission until its isolated draft vault is ready', async () => {
  let load = deferred<Saved[]>()
  let h = setup({ vault: { ...stash(), load: () => load.promise } })
  try {
    assertEquals(h.input.disabled, true)
    h.press(h.document.body, '/')
    assertEquals(h.form.hidden, false)
    assertEquals(h.input.value, '')
    h.type('attempt before ready') // Cannot overwrite the still-loading draft.
    h.input.value = '/where'
    h.event(h.form, 'submit')
    await tick()
    assertEquals(h.calls, [])
    assertEquals(h.listings, 0)
    assertEquals(h.input.disabled, true)
    load.resolve([{
      eid: draftEid('player', 'mossvale.chat'),
      comps: {
        draft: { by: 'player', place: 'mossvale.chat', text: 'saved words' },
      },
    }])
    await h.ready()
    await until(() => h.input.value == 'saved words', {
      label: 'restored draft',
    })
    h.type('/where')
    h.event(h.form, 'submit')
    await until(() => h.calls.length == 1, { label: 'ready submission' })
    assertEquals(h.calls, [{ name: 'where', args: {} }])
    assertEquals(h.input.value, '')
  } finally {
    load.resolve([])
    await h.close()
  }
})

test('chat slash choices use graph references and accept through native input', async () => {
  let h = setup()
  try {
    await h.ready()
    await h.world.mutate([{
      entity: { eid: 'test-beast' },
      beast_design: { name: 'Bog Beast' },
    }])
    h.press(h.document.body, 'Enter')
    let inputs: string[] = []
    h.input.addEventListener('input', () => inputs.push(h.input.value))
    h.type('/sp')
    await until(() => h.choices().length == 1, { label: 'command choices' })
    assertStringIncludes(h.choices()[0].textContent!, 'spawn')
    assertEquals(h.press(h.input, 'Tab').defaultPrevented, true)
    assertEquals(h.input.value, '/spawn')
    assertEquals(h.input.selectionStart, 6)
    assertEquals(inputs, ['/sp', '/spawn'])

    h.type('/spawn --beast=B')
    await until(
      () => h.choices().some((c) => c.textContent!.includes('Bog Beast')),
      { label: 'graph reference choices' },
    )
    let candidate = h.choices().find((c) =>
      c.textContent!.includes('Bog Beast')
    )!
    assertEquals(h.event(candidate, 'mousedown').defaultPrevented, true)
    assertEquals(h.input.value, '/spawn --beast="Bog Beast"')
    assertEquals(h.input.selectionStart, h.input.value.length)
    assertEquals(inputs.at(-1), h.input.value)
    h.event(h.form, 'submit')
    await until(() => h.calls.length == 1, {
      label: 'accepted reference executes',
    })
    assertEquals(h.calls, [{ name: 'spawn', args: { beast: 'Bog Beast' } }])

    h.type('/sp')
    await until(() => h.choices().length == 1, { label: 'escape choices' })
    assertEquals(h.press(h.input, 'Escape').defaultPrevented, true)
    assertEquals(h.form.hidden, false)
    await until(() => h.choices().length == 0, { label: 'dismissed choices' })
    h.press(h.input, 'Escape')
    assertEquals(h.form.hidden, true)
  } finally {
    await h.close()
  }
})

test('chat submits declared flag forms and retains drafts on schema errors', async () => {
  let h = setup()
  try {
    await h.ready()
    h.press(h.document.body, 'Enter')
    for (
      let [text, cmd] of [
        ['/teleport --x=-1152 --z 624', {
          name: 'teleport',
          args: { x: -1152, z: 624 },
        }],
        ['/teleport --to "Elder Wren"', {
          name: 'teleport',
          args: { to: 'Elder Wren' },
        }],
        ['/damage --on', { name: 'damage', args: { on: true } }],
        ['/damage --on=false', { name: 'damage', args: { on: false } }],
      ] as const
    ) {
      let count = h.calls.length
      h.type(text)
      assertEquals(h.event(h.form, 'submit').defaultPrevented, true)
      await until(() => h.calls.length == count + 1, { label: text })
      assertEquals(h.calls.at(-1), cmd)
      assertEquals(h.input.value, '')
    }
    for (
      let [text, error] of [
        ['/teleport --x=nope --z=624', '--x wants a number, got nope'],
        ['/damage maybe', '--on wants true or false, got maybe'],
        ['/unknown', 'Unknown command: /unknown'],
      ]
    ) {
      h.type(text)
      h.event(h.form, 'submit')
      await until(() => h.draw().includes(error), { label: error })
      assertEquals(h.input.value, text)
      assertEquals(await h.savedDraft(), text)
      assertEquals(h.calls.length, 4)
      assertEquals(h.form.hidden, false)
    }
  } finally {
    await h.close()
  }
})

test('chat async submission executes its snapshot without spending newer text', async () => {
  let listed = deferred<Tools>()
  let completed = deferred<string>()
  let h = setup({}, () => listed.promise, () => completed.promise)
  try {
    await h.ready()
    h.press(h.document.body, 'Enter')
    h.type('/teleport --x=1 --z 2')
    h.event(h.form, 'submit')
    await until(() => h.listings == 1, { label: 'pending listing' })
    h.type('newer words')
    listed.resolve(tools)
    await until(() => h.calls.length == 1, { label: 'snapshot executes' })
    assertEquals(h.calls, [{ name: 'teleport', args: { x: 1, z: 2 } }])
    assertEquals(h.input.value, 'newer words')
    h.type('newest words')
    completed.resolve('Finished snapshot.')
    await until(() => h.draw().includes('Finished snapshot.'), {
      label: 'async command result',
    })
    assertEquals(h.input.value, 'newest words')
    assertEquals(await h.savedDraft(), 'newest words')
    assertEquals(h.choices().length, 0)
  } finally {
    listed.resolve(tools)
    completed.resolve('Done.')
    await h.close()
  }
})

test('chat close releases watches and all DOM listeners, including pending readiness', async () => {
  let load = deferred<Saved[]>()
  let h = setup({ vault: { ...stash(), load: () => load.promise } })
  try {
    let form = h.form
    let input = h.input
    assertEquals(h.world.watches.size(), 3)
    h.chat.close()
    h.chat.close()
    assertEquals(h.glass.querySelector('.Chat'), null)
    assertEquals(h.world.watches.size(), 0)
    assertEquals(h.press(h.document.body, '/').defaultPrevented, false)
    assertEquals(h.event(h.opener, 'pointerdown').defaultPrevented, false)
    h.event(h.opener, 'click')
    assertEquals(form.hidden, true)
    assertEquals(h.focused, false)
    assertEquals(h.event(form, 'submit').defaultPrevented, false)
    h.type('/sp')
    assertEquals(h.press(input, 'Tab').defaultPrevented, false)
    load.resolve([])
    await tick()
    assertEquals(input.disabled, true)
    assertEquals(h.listings, 0)
    assertEquals(h.calls, [])
    assertEquals(h.world.watches.size(), 0)
  } finally {
    load.resolve([])
    await h.close()
  }
})

test('chat close drops an in-flight submission and completion result', async () => {
  let listed = deferred<Tools>()
  let h = setup({}, () => listed.promise)
  try {
    await h.ready()
    h.press(h.document.body, 'Enter')
    h.type('/where')
    h.event(h.form, 'submit')
    await until(() => h.listings == 1, { label: 'listing before close' })
    // Install the level watch too; close must release it along with refs.
    h.draw()
    assertEquals(h.world.watches.size(), 4)
    h.chat.close()
    assertEquals(h.world.watches.size(), 0)
    listed.resolve(tools)
    await tick()
    assertEquals(h.calls, [])
    assertEquals(h.glass.querySelector('.Chat'), null)
    assertEquals(h.input.value, '/where')
    assertEquals(h.press(h.input, 'Escape').defaultPrevented, false)
    assertEquals(h.form.hidden, false)
    h.event(h.document.body, 'pointerdown')
    assertEquals(h.form.hidden, false)
    assertEquals(h.press(h.document.body, 'Enter').defaultPrevented, false)
    h.type('/sp')
    await tick()
    assertEquals(h.listings, 1)
    assertEquals(h.choices().length, 0)
  } finally {
    listed.resolve(tools)
    await h.close()
  }
})
