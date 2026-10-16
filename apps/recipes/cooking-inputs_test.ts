import { client } from '@yaks/client'
import { draftDoc, drafts, type Stash } from '@yaks/draft'
import { browserDrafts, type Store } from '../../packages/draft/browser.ts'
import { mint } from '@yaks/graph'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { bindDurations, durationHTML, durationPlace } from './cooking-inputs.js'

const vocab = loadVocab([draftDoc, {
  $defs: {
    timer: { component: true, properties: { remaining: { type: 'number' } } },
  },
}])
const stash = (): Stash => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}
const fixture = () => {
  const net = client(vocab, [drafts()], { vault: false })
  const by = mint(), step = mint(), kept = stash()
  let refused = false, writes = 0
  let preparing = Promise.resolve()
  const store: Store = {
    me: () => Promise.resolve({ person: by }),
    apply: async (bundles) => {
      if (bundles.some((b) => b.timer)) {
        equal(
          bundles.some((b) =>
            typeof b.draft === 'object' && b.draft !== null &&
            'text' in b.draft && b.draft.text === ''
          ),
          true,
        )
        writes++
        if (refused) throw new Error('stale timer')
      }
      return { bundles: await net.mutate(bundles) }
    },
    subscribe: (query, hear) => {
      const watch = net.watch(query)
      hear(watch.value)
      const stop = watch.subscribe(hear)
      return () => {
        stop()
        watch.close()
      }
    },
  }
  const open = () =>
    browserDrafts(store, 'recipes', {
      by,
      stash: kept,
      pace: 0,
      report: () => {},
    })
  let desk = open()
  const { document, window } = parseHTML('<main></main>')
  const root = document.querySelector('main')!
  let unbind = () => {}, outcome = Promise.resolve(), error: unknown
  const render = (disabled = false) => {
    unbind()
    root.innerHTML = durationHTML(step, disabled)
    unbind = bindDurations(root, desk, {
      run: (button: HTMLButtonElement, operation: () => Promise<void>) => {
        if (button.disabled) return
        outcome = Promise.resolve().then(operation).catch((e) => {
          error = e
        })
      },
      bundles: async (
        id: string,
        seconds: number,
      ) => {
        await preparing
        return [{ entity: { eid: id }, timer: { remaining: seconds } }]
      },
    })
  }
  const input = () => root.querySelector('input')!
  const type = (text: string) => {
    input().value = text
    input().dispatchEvent(new window.Event('input'))
  }
  const submit = async () => {
    error = undefined
    root.querySelector('form')!.dispatchEvent(
      new window.Event('submit', {
        bubbles: true,
        cancelable: true,
      }),
    )
    await outcome
  }
  render()
  return {
    net,
    step,
    render,
    input,
    type,
    submit,
    get desk() {
      return desk
    },
    get error() {
      return error
    },
    get writes() {
      return writes
    },
    prepare: (wait: Promise<void>) => {
      preparing = wait
    },
    refuse: () => {
      refused = true
    },
    reload: () => {
      unbind()
      desk.close()
      desk = open()
      render()
    },
    close: () => {
      unbind()
      desk.close()
      net.close()
    },
  }
}

const rebind = fixture()
rebind.type('145')
test('Cooking duration draft follows its step through rerender and reload', () => {
  const f = rebind
  try {
    f.render()
    equal(f.input().value, '145')
    f.reload()
    equal(f.input().value, '145')
    equal(f.desk.text(durationPlace(f.step)), '145')
  } finally {
    f.close()
  }
})

const accepted = fixture()
accepted.type('145')
test('Cooking accepts custom seconds and spends the input in its timer transaction', async () => {
  const f = accepted
  try {
    await f.submit()
    equal(f.error, undefined)
    equal(f.net.ent(f.step)?.timer, { remaining: 145 })
    equal(f.input().value, '')
    equal(f.desk.text(durationPlace(f.step)), '')
    equal(f.writes, 1)
  } finally {
    f.close()
  }
})

const rejected = fixture()
rejected.type('215')
test('Cooking refused custom duration preserves typed input and leaves the timer unchanged', async () => {
  const f = rejected
  try {
    f.refuse()
    await f.submit()
    ok(f.error)
    equal(f.input().value, '215')
    equal(f.net.ent(f.step)?.timer, undefined)
    f.render()
    equal(f.input().value, '215')
  } finally {
    f.close()
  }
})

const invalid = fixture()
invalid.type('1e')
test('Cooking invalid custom seconds stay editable without spending or writing a timer', async () => {
  const f = invalid
  try {
    await f.submit()
    ok(f.error)
    equal(f.input().value, '1e')
    equal(f.writes, 0)
  } finally {
    f.close()
  }
})

const locked = fixture()
locked.type('90')
test('Cooking locked custom duration does not spend a saved draft', async () => {
  const f = locked
  try {
    f.render(true)
    equal(f.input().disabled, true)
    await f.submit()
    equal(f.writes, 0)
    equal(f.input().value, '90')
  } finally {
    f.close()
  }
})

const changed = fixture()
changed.type('60')
let ready!: () => void
changed.prepare(
  new Promise<void>((resolve) => {
    ready = resolve
  }),
)
test('Cooking does not spend newer typing while timer guards are prepared', async () => {
  const f = changed
  try {
    const saving = f.submit()
    await Promise.resolve()
    f.type('120')
    ready()
    await saving
    ok(f.error)
    equal(f.input().value, '120')
    equal(f.writes, 0)
  } finally {
    f.close()
  }
})
