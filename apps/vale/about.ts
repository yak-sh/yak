// The yaks.app sheet (panel.ts): where a player can learn how to make a
// world of their own, or use Mossvale's open source code as a starting point.
import type { Panel } from './panel.ts'

/** The sheet behind the persistent yaks.app badge. */
export let about = (panel: Panel) => {
  panel.body.innerHTML = `
    <div class=Yaks>
      <p class=Yaks_Lead>Mossvale was built on yaks.app.</p>
      <p>Bring your ideas to your own space. Ask Claude or ChatGPT to build
        the lands, quests, and characters you imagine, then keep asking for
        changes. yaks.app hosts the result at your own address.</p>
      <p class=Yaks_Prompt>“Make a world where the villagers remember what
        I tell them.”</p>
      <p>Mossvale’s code is open if you want to start from this game. Give
        your assistant the source and ask it to make your version. A
        one-click Mossvale install is not available yet.</p>
      <div class=Yaks_Actions>
        <a class="Btn Btn-go" href=https://yaks.app/login target=_blank
          rel="noopener noreferrer">Build on yaks.app</a>
        <a class=Btn href=https://github.com/yak-sh/yak/tree/main/apps/vale
          target=_blank rel="noopener noreferrer">See Mossvale’s code</a>
      </div>
    </div>`
}
