// The song-take editor is controlled by graph rows and emits the output id to
// choose. No player or choice state belongs in this rendering.
import { h } from 'preact'
import { Button, Head, Panes, Rows, Tile } from '@yaks/ui'
import { ValeRecording } from './ui-kit.ts'
import type { Song } from './music_takes.ts'

export let Takes = ({ songs, editor, busy, message, choose }: {
  songs: Song[]
  editor: boolean
  busy: string | null
  message: string
  choose: (id: string) => void
}) =>
  h(
    Panes,
    {},
    h(
      Panes.Pane,
      { mod: 'main' },
      h(
        Panes.Top,
        {},
        h(
          Head,
          {},
          h(Head.Title, {}, 'Mossvale recordings'),
          h(
            Head.Sub,
            {},
            message || 'Listen to each take and choose what the land plays.',
          ),
          h(Button, { href: './' }, 'Back to the Vale'),
        ),
      ),
      h(
        Panes.Body,
        {},
        !editor &&
          h(
            'p',
            {},
            'Only an app editor can choose recordings. Listening is open to everyone.',
          ),
        !songs.length && h('p', {}, 'No recordings yet.'),
        songs.map((song) =>
          h(
            'section',
            { key: song.id },
            h(Head, {}, h(Head.Title, {}, `${song.land} · ${song.theme}`)),
            h(
              Rows,
              {},
              song.takes.map((take, i) =>
                h(
                  Rows.Item,
                  { key: take.id },
                  h(
                    Tile,
                    {},
                    h(Tile.Title, {}, `Take ${song.takes.length - i}`),
                    h(Tile.Note, {}, take.chosen ? 'In use' : 'Retained'),
                    h(
                      Tile.Note,
                      {},
                      take.at ? new Date(take.at).toLocaleString() : '',
                    ),
                  ),
                  h(ValeRecording, {
                    controls: true,
                    preload: 'none',
                    src: `api/blob/${take.sha}`,
                    'aria-label': `${song.land} ${song.theme} take ${
                      song.takes.length - i
                    }`,
                  }),
                  h(
                    Button,
                    {
                      disabled: !editor || !!busy || take.chosen,
                      onClick: () => choose(take.id),
                    },
                    busy == take.id
                      ? 'Choosing…'
                      : take.chosen
                      ? 'In use'
                      : 'Use this take',
                  ),
                )
              ),
            ),
          )
        ),
      ),
    ),
  )
