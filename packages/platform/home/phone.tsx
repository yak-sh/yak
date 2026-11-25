/** @jsxImportSource preact */
import { Button, Card, Chip, Chips } from '@yaks/ui'
import { type Feature, FEATURES } from './parts.ts'
import { ServiceLogo } from './scenes.tsx'
import type { Demo, Line, Scene } from './demos.ts'

/** What the phone plays: a page's features in order, its demos, each a turn
 * for each feature, and each demo's pictures by its slug. */
export type Told = {
  features: readonly Feature[]
  demos: readonly Demo[]
  scenes: Record<string, Scene>
}

let Message = (
  { line, turn, section, at, count, logo }: {
    line: Line
    turn: number
    section: string
    at: number
    count: number
    logo?: string
  },
) => (
  <li
    class={`Home_Message Home_Message-${line.who}`}
    data-turn={turn}
    data-line={at}
    data-count={count}
    hidden={turn != 0}
  >
    <div class={`Chat_Bubble Chat_Bubble-${line.who}`}>
      <a class='Home_MessageLink' href={`#${section}`}>
        {logo && <ServiceLogo slug={logo} />}
        {line.text}
      </a>
      {line.shot && (
        <a
          class='Home_Shot'
          href={line.link?.href}
          tabindex={-1}
          aria-hidden='true'
        >
          <img
            class='Home_Image'
            src={line.shot.src}
            alt=''
            width={line.shot.width}
            height={line.shot.height}
            loading='lazy'
          />
        </a>
      )}
      {!line.shot && line.link && <a href={line.link.href}>{line.link.label}
      </a>}
    </div>
  </li>
)

// The service whose logo a reply in a feature's turn wears.
let logoOf = (feature: Feature, scene?: Scene) =>
  feature == 'connect'
    ? scene?.connects
    : feature == 'sell'
    ? 'stripe'
    : undefined

let Conversation = (
  { demo, first, told }: { demo: Demo; first: boolean; told: Told },
) => (
  <div
    class='Home_Track'
    data-conversation={demo.slug}
    hidden={!first}
    role='group'
    aria-label='Example messages'
  >
    <ol class='Home_Messages'>
      {demo.turn.flatMap((lines, turn) => {
        let feature = told.features[turn]
        return lines.map((line, at) => (
          <Message
            line={line}
            turn={turn}
            section={FEATURES[feature].section}
            at={at}
            count={lines.length}
            logo={line.who == 'them'
              ? logoOf(feature, told.scenes[demo.slug])
              : undefined}
          />
        ))
      })}
    </ol>
  </div>
)

/** A demo stays openable after its first reply scrolls out of the phone. */
export let DemoLinks = ({ demos }: { demos: readonly Demo[] }) => (
  <div class='Home_DemoLinks'>
    {demos.map(({ slug, turn }, i) => {
      let link = turn[0].find((line) => line.link)?.link
      return link && (
        <a href={link.href} data-demo-scene={slug} hidden={i != 0}>
          {link.label}
        </a>
      )
    })}
  </div>
)

export let Picks = ({ demos }: { demos: readonly Demo[] }) => (
  <Chips
    class='Home_Picks'
    role='group'
    aria-label='Example apps'
    data-picks=''
    hidden
  >
    {demos.map(({ slug, name }, i) => (
      <Chip
        as='button'
        class='Home_Pick'
        type='button'
        data-pick={slug}
        aria-pressed={i == 0}
      >
        {name}
      </Chip>
    ))}
    <Button
      type='button'
      mod='quiet'
      class='Home_Pause'
      aria-label='Pause example rotation'
      data-pause=''
      hidden
    >
      <span aria-hidden='true'>Ⅱ</span>
    </Button>
  </Chips>
)

export let Phone = ({ told }: { told: Told }) => (
  <Card class='Home_Phone'>
    <div class='Home_Log' data-log=''>
      {told.demos.map((demo, i) => (
        <Conversation key={demo.slug} demo={demo} first={i == 0} told={told} />
      ))}
    </div>
  </Card>
)
