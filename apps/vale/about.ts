// The yaks.app sheet: making a world, its source, and the carried UI guide.
import { h, render } from 'preact'
import { Body, Button } from '@yaks/ui'
import type { Panel } from './panel.ts'

/** The sheet behind the persistent yaks.app badge. */
export let about = (panel: Panel) =>
  render(
    h(
      Body,
      { class: 'Yaks' },
      h('p', { class: 'Yaks_Lead' }, 'Mossvale was built on yaks.app.'),
      h(
        'p',
        {},
        'Bring your ideas to your own space. Ask Claude or ChatGPT to build ' +
          'the lands, quests, and characters you imagine, then keep asking for ' +
          'changes. yaks.app hosts the result at your own address.',
      ),
      h(
        'p',
        { class: 'Yaks_Prompt' },
        '“Based on what we’ve talked about, how would you make Mossvale mine?”',
      ),
      h(
        'p',
        {},
        'Mossvale’s code is open if you want to start from this game. Give ' +
          'your assistant the source and ask it to make your version.',
      ),
      h(
        'div',
        { class: 'Yaks_Actions' },
        h(Button, {
          class: 'Btn Btn-go',
          href: 'https://yaks.app/login',
          target: '_blank',
          rel: 'noopener noreferrer',
        }, 'Build on yaks.app'),
        h(Button, {
          class: 'Btn',
          href: 'https://github.com/yak-sh/yak/tree/main/apps/vale',
          target: '_blank',
          rel: 'noopener noreferrer',
        }, 'See Mossvale’s code'),
        h(
          Button,
          { class: 'Btn', href: './guide.html' },
          'Explore the UI guide',
        ),
      ),
    ),
    panel.body,
  )
