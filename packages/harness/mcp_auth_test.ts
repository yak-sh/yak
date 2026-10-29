import { derivedEid } from '@yaks/graph/identity'
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import { MCPAuthPanel } from './MCPAuthPanel.ts'
import { frontend } from './frontend.ts'

import type { UIAgent } from './panels.ts'

import { mount } from './testing.ts'

test('authorization UI captures pasted callback privately, preserving draft and never sending it', async () => {
  const ui = frontend()
  ui.keys({ mode: 'NORMAL' })
  const received: string[] = []
  const api = {
    authorizeMCP: (action: string, _name?: string, callback?: string) => {
      if (action === 'complete') received.push(callback!)
      return Promise.resolve(
        action === 'list' ? { servers: ['site'] } : action === 'begin'
          ? {
            url: 'https://issuer.test/authorize?state=public-state',
            redirectUrl: 'http://127.0.0.1/callback',
          }
          : { message: 'Connected' },
      )
    },
  } as UIAgent
  const view = await mount(() => h(MCPAuthPanel, { ui, agent: api }), 100, 15)
  try {
    await view.send('A')
    await view.send('\r')
    const callback =
      'http://127.0.0.1/callback?code=VERY_SECRET&state=public-state'
    await view.send('\x1b[200~' + callback + '\x1b[201~')
    assert(!view.out.join('').includes('VERY_SECRET'))
    assert(
      !JSON.stringify(ui.client.ent(derivedEid('harness-frontend|draft')))
        .includes('VERY_SECRET'),
    )
    await view.send('\r')
    assertEquals(received, [callback])
    assert(view.text().includes('Connected'))
  } finally {
    view.free()
    ui.close()
  }
})
