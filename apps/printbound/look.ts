import spellbound from './look/spellbound.css' with { type: 'text' }
import derived from '@yaks/ui/derived.css' with { type: 'text' }
import base from '@yaks/ui/base.css' with { type: 'text' }
import surface from '@yaks/ui/Surface.css' with { type: 'text' }
import skip from '@yaks/ui/Skip.css' with { type: 'text' }
import button from '@yaks/ui/Button.css' with { type: 'text' }
import field from '@yaks/ui/Field.css' with { type: 'text' }
import form from '@yaks/ui/Form.css' with { type: 'text' }
import notice from '@yaks/ui/Notice.css' with { type: 'text' }
import rows from '@yaks/ui/Rows.css' with { type: 'text' }
import card from '@yaks/ui/Card.css' with { type: 'text' }
import cards from '@yaks/ui/Cards.css' with { type: 'text' }
import empty from '@yaks/ui/Empty.css' with { type: 'text' }
import body from '@yaks/ui/Body.css' with { type: 'text' }
import skin from './look/skin.css' with { type: 'text' }
import site from './look/site.css' with { type: 'text' }
import studio from './look/studio.css' with { type: 'text' }

let sheet = [
  spellbound,
  derived,
  base,
  surface,
  skip,
  button,
  field,
  form,
  notice,
  rows,
  card,
  cards,
  empty,
  body,
  skin,
  site,
  studio,
].join('\n')

/** The Spellbound theme, the kit's parts and the app's skin, compiled into
 * the worker in the same order the browser applies them. */
export let look = (): Response =>
  new Response(sheet, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
