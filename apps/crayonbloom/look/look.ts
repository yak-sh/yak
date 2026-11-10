/** CrayonBloom's look as the one stylesheet its pages link: the crayon theme
 * and what every theme derives, then each kit part the pages wear with the
 * skin's sheet laid over it, then the app's own parts. Each sheet is imported
 * as text, so the stylesheet is compiled into the worker and no request reads
 * a file for it. */
import crayon from './crayon.css' with { type: 'text' }
import derived from '@yaks/ui/derived.css' with { type: 'text' }
import base from '@yaks/ui/base.css' with { type: 'text' }
import baseSkin from './skin/base.css' with { type: 'text' }
import surface from '@yaks/ui/Surface.css' with { type: 'text' }
import surfaceSkin from './skin/Surface.css' with { type: 'text' }
import skip from '@yaks/ui/Skip.css' with { type: 'text' }
import button from '@yaks/ui/Button.css' with { type: 'text' }
import buttonSkin from './skin/Button.css' with { type: 'text' }
import card from '@yaks/ui/Card.css' with { type: 'text' }
import cardSkin from './skin/Card.css' with { type: 'text' }
import cards from '@yaks/ui/Cards.css' with { type: 'text' }
import cardsSkin from './skin/Cards.css' with { type: 'text' }
import field from '@yaks/ui/Field.css' with { type: 'text' }
import fieldSkin from './skin/Field.css' with { type: 'text' }
import form from '@yaks/ui/Form.css' with { type: 'text' }
import formSkin from './skin/Form.css' with { type: 'text' }
import check from '@yaks/ui/Check.css' with { type: 'text' }
import checkSkin from './skin/Check.css' with { type: 'text' }
import chip from '@yaks/ui/Chip.css' with { type: 'text' }
import chipSkin from './skin/Chip.css' with { type: 'text' }
import chips from '@yaks/ui/Chips.css' with { type: 'text' }
import dot from '@yaks/ui/Dot.css' with { type: 'text' }
import state from '@yaks/ui/State.css' with { type: 'text' }
import body from '@yaks/ui/Body.css' with { type: 'text' }
import bodySkin from './skin/Body.css' with { type: 'text' }
import notice from '@yaks/ui/Notice.css' with { type: 'text' }
import noticeSkin from './skin/Notice.css' with { type: 'text' }
import empty from '@yaks/ui/Empty.css' with { type: 'text' }
import emptySkin from './skin/Empty.css' with { type: 'text' }
import mast from './parts/Mast.css' with { type: 'text' }
import foot from './parts/Foot.css' with { type: 'text' }
import band from './parts/Band.css' with { type: 'text' }
import lead from './parts/Lead.css' with { type: 'text' }
import kicker from './parts/Kicker.css' with { type: 'text' }
import squig from './parts/Squig.css' with { type: 'text' }
import hero from './parts/Hero.css' with { type: 'text' }
import doodles from './parts/Doodles.css' with { type: 'text' }
import wave from './parts/Wave.css' with { type: 'text' }
import spark from './parts/Spark.css' with { type: 'text' }
import steps from './parts/Steps.css' with { type: 'text' }
import sheet from './parts/Sheet.css' with { type: 'text' }
import ticks from './parts/Ticks.css' with { type: 'text' }
import desk from './parts/Desk.css' with { type: 'text' }
import tray from './parts/Tray.css' with { type: 'text' }

/** The stylesheet, each sheet in the order a browser reads them. */
export let stylesheet = [
  crayon,
  derived,
  base,
  baseSkin,
  surface,
  surfaceSkin,
  skip,
  button,
  buttonSkin,
  card,
  cardSkin,
  cards,
  cardsSkin,
  field,
  fieldSkin,
  form,
  formSkin,
  check,
  checkSkin,
  chip,
  chipSkin,
  chips,
  dot,
  state,
  body,
  bodySkin,
  notice,
  noticeSkin,
  empty,
  emptySkin,
  mast,
  foot,
  band,
  lead,
  kicker,
  squig,
  hero,
  doodles,
  wave,
  spark,
  steps,
  sheet,
  ticks,
  desk,
  tray,
].join('\n')
