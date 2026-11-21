# @yaks/discord-voice

A relay that joins a Discord voice room for its host and streams the room's
audio both ways over a WebSocket, as a phone provider streams a call's. A
Discord voice room needs UDP and Discord's end-to-end encryption (DAVE), which a
Cloudflare Worker cannot hold, so this is a small process of its own: Discord's
voice protocol in
([@discordjs/voice](https://discord.js.org/docs/packages/voice), with
[@snazzah/davey](https://www.npmjs.com/package/@snazzah/davey) for DAVE and
opusscript for Opus), the line [@yaks/discord](../discord/README.md)'s `line`
reads out. It holds no bot token and no model key.

## How a room is joined

1. The host's own Gateway socket sends `join(server, room)` (@yaks/discord), and
   Discord answers with the bot's voice session and its voice server
   (@yaks/chat/voice `voiceRooms` keeps both).
2. The host posts them to the relay's `/join` with the `wss://` address the
   room's audio streams to, carrying `authorization: Bearer <RELAY_KEY>`.
3. The relay connects to the voice server and opens the stream. It sends the
   room's audio, everyone mixed, every 100 ms, silence included, so the host can
   tell a quiet room from a lost line; who began speaking as `speaking{user}`;
   and plays what the host sends once the room's connection is ready.
4. A second join for the same server follows Discord to a new voice server with
   the same stream. A stream that drops is opened again while the room is held.
   The relay lets a room go when the host posts `/leave`, when Discord lets it
   go, or when the host refuses its stream, and tells the stream it stopped.

`GET /` answers how many rooms it holds.

## Audio

`./audio.ts` is the pure part: `mixed(frames)`, one 20 ms frame of 48 kHz stereo
from each speaker made into 24 kHz mono; `widener()`, the host's 24 kHz mono
made into Discord's 48 kHz stereo a chunk at a time; `frames(size)`, a queue cut
into frames, the last drained padded; `sent(data)` and `say`, the line's frames;
and `joined(body, hosts)`, a join read, refused unless its stream goes to a host
the relay serves.

## Running it

```sh
RELAY_KEY=… RELAY_HOSTS=yaks.app PORT=8080 deno run -A packages/discord-voice/relay.ts
```

`deploy.sh` puts it on one Compute Engine e2-micro (Google Cloud's free tier in
us-central1), behind Caddy at `<address>.sslip.io`, as a systemd service, and
puts yaks.app's `VOICE_RELAY` and `VOICE_RELAY_KEY` secrets. Run it again to
update.

What it costs: the VM and its address are free under the free tier, and about
$10 a month outside it. A room's audio leaves Google at about 0.2 GB an hour of
talk, $0.12 a GB past the first GB a month.
