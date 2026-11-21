/** @jsxImportSource preact */
import { Button, Card, Chip, Chips } from '@yaks/ui'
import { type Demo, DEMOS, type Line } from './demos.ts'

let Message = (
  { line, turn, at, first }: {
    line: Line
    turn: number
    at: number
    first: boolean
  },
) => (
  <li
    class={`Home_Message Home_Message-${line.who}`}
    data-turn={turn}
    data-line={at}
    data-recent={first ? '' : undefined}
    hidden={!first}
  >
    <div class={`Chat_Bubble Chat_Bubble-${line.who}`}>
      {line.text}
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
      {line.link?.href && (
        <>
          <a href={line.link.href}>{line.link.label}</a>
        </>
      )}
    </div>
  </li>
)

let Conversation = ({ demo, first }: { demo: Demo; first: boolean }) => (
  <div
    class='Home_Track'
    data-conversation={demo.slug}
    hidden={!first}
    tabindex={0}
    role='group'
    aria-label='Example messages'
  >
    <ol class='Home_Messages'>
      {demo.turn.flatMap((lines, turn) =>
        lines.map((line, at) => (
          <Message line={line} turn={turn} at={at} first={turn == 0} />
        ))
      )}
    </ol>
  </div>
)

/** The same selector fits under the desktop phone and above the mobile strip. */
export let Picks = () => (
  <Chips
    class='Home_Picks'
    role='group'
    aria-label='Example apps'
    data-picks=''
    hidden
  >
    {DEMOS.map(({ slug, name }, i) => (
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

export let Phone = () => (
  <Card class='Home_Phone'>
    <div class='Home_Log' data-log=''>
      {DEMOS.map((demo, i) => (
        <Conversation key={demo.slug} demo={demo} first={i == 0} />
      ))}
    </div>
  </Card>
)
