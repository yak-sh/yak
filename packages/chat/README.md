# @yaks/chat

Chat platforms as plugins. Discord, Slack, Telegram: each is a value its own
package gives (`Platform`), and this package names none of them. It reads what a
platform heard as a `Said`, keeps it as rows, says it to whoever answers it, and
cuts an answer to fit, so a host wires every platform the same way.

## Stored data

- `chat_message{via, room, author, message_id, reply_to, at, addressed, connection}`
  is one message said in a room, its words in @yaks/doc's `doc{body}`: the
  platform it was said on (its plugin's name), the room and the account that
  said it (refs), the platform's id for it and for the message it answers, when,
  how it was said to the bot that heard it (`addressed`: a `mention`, a `reply`
  to the bot, or `direct`), and the connection whose bot heard it. With
  @yaks/mail's `deliver{to}` naming a room, it asks to be posted there by that
  bot: the `chat_post` effect hands it to the poster its host lends for the
  platform (`Host.chatters`) and writes `delivered` or `bounced`.
- `chat_room{via, id, server, name}` is a place messages are said: a channel, a
  direct conversation, a chat. `server` is the server or workspace it belongs
  to, none for a direct one.
- `chat_account{via, id, name}` is someone on a platform. Which person here they
  are is said by that person's connection to the platform's sign-in
  (@yaks/connections, its `account` their platform id), never on this row.

- `chat_hears{room}`, on a chat connection, is the room of its server where its
  owner's listener hears every message, not only those said to its bot: the
  room's eid (`roomEid`), which names it in every store.

Each eid is derived from `via` and the platform's id (`messageEid`, `roomEid`,
`accountEid`), so a message heard twice writes one row, and two platforms' ids
never meet. `kept(via, said, connection?)` is the three rows, the message naming
the connection whose bot heard it.

## A platform

```ts
type Platform = {
  name: string // what `integration.chat` names (@yaks/connections)
  title: string
  limit: number // the most characters one message carries
  socket?: (credential: string) => Socket<unknown>
  send: (credential: string, reply: Reply, fetch?) => Promise<Posted>
  server?: (
    credential: string,
    room: string,
    fetch?,
  ) => Promise<string | undefined>
  rooms?: (credential: string, server: string, fetch?) => Promise<Room[]>
  working?: { every: number; show: (credential, room, fetch?) => Promise<void> }
}
```

A platform that sends its messages over a socket gives it as pure steps
(`Socket`): where to connect, and for each frame what to send back, how often to
beat, what was heard, and whether to connect again; and what a beat sends, or
`again` when the last went unanswered. `ends(code)` says why a close cannot be
tried again with the same credential. A platform that posts to a webhook instead
gives that the way @yaks/phone's providers do; none does yet.

`send` posts a reply with a bot's credential. A refusal that never took it (a
rate limit, a 5xx) is @yaks/host's `Unsent`, so it is tried again.

`server` says which server a room belongs to, as the bot sees it, none for a
direct room. `confined(chatter, {serves, server})` is a chatter that posts only
into rooms of the server its connection serves and refuses anything else before
the chatter sees it, so a host can lend a bot to whoever writes rows without
holding it (an app) and still keep its posts in that one server.

`rooms` lists the rooms of a server people write in (`{id, name}`), where the
platform can, so a space chooses the one it hears in full (`chat_hears`).

`working` is how a bot shows a room it is working on an answer, where the
platform can (Discord's typing indicator): one show lasts `every` milliseconds.
`showing(working, still)` shows at once and again each `every` while `still()`
says the work goes on, for at most ten minutes; a show refused for now
(`Unsent`) waits for the next beat.

`framing(platform, {name, addressed})` is how a message is said before its words
to whoever answers it ("On Discord, naming you, from Ann: ").
`pieces(text, limit)` cuts an answer at the last paragraph, line or space that
fits.

## Holding a socket

`holder(socket, heard)` (`@yaks/chat/socket`) runs a platform's steps over a
`Wire` its host opens: `url()` to connect to, `frame(wire, text)` for each
frame, `beat(wire)` when one is due, and `ended(code)`. Each answers what the
host does next: beat every `every` milliseconds, or close and connect `again`.
What the socket remembers survives a reconnect, so a session is resumed. The
host only connects, keeps time and closes.

`listener(hosting)` (`@yaks/chat/listen`) is the loop a host runs around a
holder for as long as it lives: given the platform, the bot's credential, how to
open a socket and where heard messages go, its `alarm` opens the socket when it
is not open, and the host calls it every `WATCH` (a minute), so a socket dropped
by a deploy is open again within one. It beats when due, connects again when
told or dropped, and stops only on a close the platform says is final (`ended`),
until `close()` forgets the session, as when the credential changes.

Platforms: [@yaks/discord](../discord/README.md).

## Who answers

Whether a message is answered is never a platform's call. A platform says only
how it was `addressed`; the listener reads everything it hears, and answers when
it is addressed or the words are clearly for it, by the conversation logic every
channel shares (@yaks/session's `turn`, which a group text uses too).
