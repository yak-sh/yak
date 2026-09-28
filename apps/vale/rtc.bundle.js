// packages/rtc/door.ts
var KEY = "x-yak-rtc-key";

// packages/rtc/join.ts
var Refused = class extends Error {
  code;
  status;
  constructor(code, message, status = 0) {
    super(message);
    this.name = "Refused";
    this.code = code;
    this.status = status;
  }
};
var BITRATE = 32e3;
var VOICE = "voice";
var RENEW = 3e4;
var microphone = async () => {
  let stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  let track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new DOMException("No audio input was returned", "NotFoundError");
  }
  return track;
};
var voiced = (level, was) => level >= (was ? 0.01 : 0.04);
var wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
var join = async (opts) => {
  let door = new URL(opts.door ?? "api/rtc/", document.baseURI);
  let send = opts.fetch ?? fetch.bind(globalThis);
  let state = "joining";
  let moved = (s) => {
    if (s == state) return;
    state = s;
    opts.change?.(s);
  };
  let session = "";
  let key = "";
  let ask = async (method, path, body) => {
    let res = await send(new URL(path, door), {
      method,
      credentials: "same-origin",
      headers: {
        ...key ? {
          [KEY]: key
        } : {},
        ...body === void 0 ? {} : {
          "content-type": "application/json"
        }
      },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(15e3)
    });
    let said = await res.json().catch(() => null);
    if (!res.ok) {
      let e = said?.error ?? {};
      throw new Refused(e.code ?? "unavailable", e.message ?? `the door answered ${res.status}`, res.status);
    }
    return said;
  };
  let on = (path = "") => `sessions/${session}${path}`;
  let queue = Promise.resolve();
  let serial = (fn) => {
    let next = queue.then(fn, fn);
    queue = next.catch(() => {
    });
    return next;
  };
  let pc;
  let voice;
  let sent = /* @__PURE__ */ new Map();
  let heard = /* @__PURE__ */ new Set();
  let muted = false;
  let talking = false;
  let wear = () => opts.write([
    {
      entity: {
        eid: opts.entity
      },
      rtc: sent.size ? {
        session,
        tracks: [
          ...sent.keys()
        ],
        muted,
        talking
      } : {
        session,
        tracks: [],
        muted,
        talking: false
      }
    }
  ]);
  let open = async () => {
    key = "";
    let { iceServers } = await ask("POST", "ice");
    let opened = await ask("POST", "sessions/new");
    session = opened.sessionId;
    key = opened.key;
    pc = new RTCPeerConnection({
      iceServers,
      bundlePolicy: "max-bundle"
    });
    let mine = pc;
    let lost;
    pc.onconnectionstatechange = () => {
      if (mine != pc || state == "left") return;
      clearTimeout(lost);
      if (pc.connectionState == "failed") void rebuild();
      if (pc.connectionState == "disconnected") {
        lost = setTimeout(() => mine == pc && void rebuild(), 5e3);
      }
    };
    voice = await sender(null, VOICE);
  };
  let sender = async (track, name) => {
    let tx = pc.addTransceiver(track ?? "audio", {
      direction: "sendonly",
      sendEncodings: [
        {
          maxBitrate: BITRATE
        }
      ]
    });
    await pc.setLocalDescription(await pc.createOffer());
    let res = await ask("POST", on("/tracks/new"), {
      sessionDescription: pc.localDescription,
      tracks: [
        {
          location: "local",
          mid: tx.mid,
          trackName: name
        }
      ]
    });
    await pc.setRemoteDescription(res.sessionDescription);
    return tx;
  };
  let push = async (track, name) => {
    let tx = name == VOICE ? voice : await sender(track, name);
    if (tx == voice) await voice.sender.replaceTrack(track);
    sent.set(name, {
      track,
      tx
    });
  };
  let close = async (txs) => {
    let mids = txs.map((tx) => tx.mid).filter(Boolean);
    for (let tx of txs) tx.stop();
    if (!mids.length || pc.connectionState == "closed") return;
    let tracks = mids.map((mid) => ({
      mid
    }));
    await pc.setLocalDescription(await pc.createOffer());
    let res = await ask("PUT", on("/tracks/close"), {
      tracks,
      sessionDescription: pc.localDescription,
      force: false
    });
    if (res.sessionDescription) {
      await pc.setRemoteDescription(res.sessionDescription);
    }
  };
  let rebuilding = null;
  let rebuild = () => rebuilding ??= serial(async () => {
    moved("lost");
    for (let h of heard) h.dead = true;
    heard.clear();
    let tracks = [
      ...sent
    ].map(([name, { track }]) => ({
      name,
      track
    }));
    sent.clear();
    pc.close();
    for (let tries = 0; state != "left"; tries++) {
      try {
        await open();
        for (let t of tracks) await push(t.track, t.name);
        wear();
        moved("live");
        return;
      } catch (e) {
        if (e instanceof Refused && e.code == "limit") return moved("limit");
        await wait(Math.min(3e4, 1e3 * 2 ** tries));
      }
    }
  }).finally(() => rebuilding = null);
  let renew = async () => {
    if (state == "left" || rebuilding) return;
    try {
      await ask("POST", on("/renew"));
      moved("live");
      wear();
    } catch (e) {
      if (!(e instanceof Refused)) return;
      if (e.code == "limit") moved("limit");
      else if (e.status == 404) void rebuild();
    }
  };
  let listen = async () => {
    let voice2 = [
      ...sent.values()
    ][0];
    let level = 0;
    if (voice2 && !muted) {
      for (let r of (await voice2.tx.sender.getStats()).values()) {
        if (r.type == "media-source" && typeof r.audioLevel == "number") {
          level = r.audioLevel;
        }
      }
    }
    let now = voice2 && !muted ? voiced(level, talking) : false;
    if (now != talking) {
      talking = now;
      wear();
    }
  };
  try {
    await open();
  } catch (e) {
    if (e instanceof Refused) moved(e.code == "limit" ? "limit" : "refused");
    throw e;
  }
  moved("live");
  wear();
  let renewing = setInterval(renew, RENEW);
  let hearing = setInterval(() => void listen().catch(() => {
  }), 200);
  let call = {
    get session() {
      return session;
    },
    get state() {
      return state;
    },
    publish: (track, name = VOICE) => serial(async () => {
      await push(track, name);
      wear();
      return {
        name,
        stop: () => serial(async () => {
          let held = sent.get(name);
          if (!held || held.track != track) return;
          sent.delete(name);
          wear();
          if (held.tx == voice) await voice.sender.replaceTrack(null);
          else await close([
            held.tx
          ]);
        })
      };
    }),
    diagnose: async (name = VOICE) => {
      let selected = sent.get(name);
      if (!selected) return null;
      let stats = await selected.tx.sender.getStats();
      let level = null;
      let energy = null;
      let duration = null;
      let packets = null;
      for (let r of stats.values()) {
        if (r.type == "media-source") {
          if (typeof r.audioLevel == "number") level = r.audioLevel;
          if (typeof r.totalAudioEnergy == "number") energy = r.totalAudioEnergy;
          if (typeof r.totalSamplesDuration == "number") {
            duration = r.totalSamplesDuration;
          }
        }
        if (r.type == "outbound-rtp" && r.kind == "audio" && typeof r.packetsSent == "number") packets = r.packetsSent;
      }
      return {
        ready: selected.track.readyState == "live",
        enabled: selected.track.enabled,
        connected: pc.connectionState == "connected",
        level,
        energy,
        duration,
        packets
      };
    },
    mute: (on2) => {
      muted = on2;
      for (let { track } of sent.values()) track.enabled = !on2;
      if (on2) talking = false;
      wear();
    },
    hear: (from, name) => serial(async () => {
      if (state == "left" || state == "limit") return null;
      let res = await ask("POST", on("/tracks/new"), {
        tracks: [
          {
            location: "remote",
            sessionId: from,
            trackName: name
          }
        ]
      });
      let got = res.tracks?.[0];
      if (!got?.mid || got.errorCode) return null;
      await pc.setRemoteDescription(res.sessionDescription);
      await pc.setLocalDescription(await pc.createAnswer());
      await ask("PUT", on("/renegotiate"), {
        sessionDescription: pc.localDescription
      });
      let tx = pc.getTransceivers().find((t) => t.mid == got.mid);
      if (!tx) return null;
      let stream = new MediaStream([
        tx.receiver.track
      ]);
      let el = new Audio();
      el.muted = true;
      el.srcObject = stream;
      el.play().catch(() => {
      });
      let mark = {
        dead: false
      };
      heard.add(mark);
      let at = pc;
      return {
        stream,
        get live() {
          return !mark.dead;
        },
        stop: () => serial(async () => {
          el.srcObject = null;
          if (mark.dead) return;
          mark.dead = true;
          heard.delete(mark);
          if (at == pc) await close([
            tx
          ]);
        })
      };
    }),
    // After whatever negotiation is in flight, so none lands on a closed
    // connection.
    leave: () => serial(() => {
      clearInterval(renewing);
      clearInterval(hearing);
      moved("left");
      for (let h of heard) h.dead = true;
      heard.clear();
      sent.clear();
      pc.close();
      opts.write([
        {
          entity: {
            eid: opts.entity
          },
          rtc: null
        }
      ]);
      return Promise.resolve();
    })
  };
  return call;
};

// packages/rtc/loop.ts
var stereo = (d) => {
  let sdp = d.sdp ?? "";
  let pt = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp)?.[1];
  if (!pt) return d;
  return {
    type: d.type,
    sdp: sdp.replace(new RegExp(`a=fmtp:${pt} (.*)`), (_, params) => `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1;maxaveragebitrate=256000`)
  };
};
var loopback = (ctx) => {
  let into = ctx.createMediaStreamDestination();
  let send = new RTCPeerConnection();
  let hear = new RTCPeerConnection();
  let out = new Audio();
  send.onicecandidate = (e) => e.candidate && hear.addIceCandidate(e.candidate);
  hear.onicecandidate = (e) => e.candidate && send.addIceCandidate(e.candidate);
  let track = new Promise((ok) => hear.ontrack = (e) => ok(e.track));
  send.addTrack(into.stream.getAudioTracks()[0], into.stream);
  let ready = (async () => {
    let offer = await send.createOffer();
    await send.setLocalDescription(offer);
    await hear.setRemoteDescription(stereo(offer));
    let answer = stereo(await hear.createAnswer());
    await hear.setLocalDescription(answer);
    await send.setRemoteDescription(answer);
    out.srcObject = new MediaStream([
      await track
    ]);
    await out.play();
  })();
  return {
    into,
    ready,
    stop: () => {
      out.pause();
      out.srcObject = null;
      send.close();
      hear.close();
      into.disconnect();
    }
  };
};

// packages/rtc/vocab.json
var vocab_default = {
  $vocabulary: {
    "https://yak.sh/vocab/core": true
  },
  title: "rtc",
  $defs: {
    rtc: {
      component: true,
      type: "object",
      sync: "peers",
      durable: "connection",
      pace: "200ms",
      description: "What this entity is saying out loud this moment: the Realtime session it publishes from, the tracks a listener asks for, and whether it is muted or talking. Relayed and kept by nobody, so it goes with the tab that wrote it, and a listener stops hearing it then.",
      properties: {
        session: {
          type: "string",
          description: "the Realtime session the tracks are published from"
        },
        tracks: {
          type: "array",
          items: { type: "string" },
          description: "the names of the tracks it publishes, each asked for as a remote track of the session"
        },
        muted: {
          type: "boolean",
          description: "its microphone is off"
        },
        talking: {
          type: "boolean",
          description: "its microphone hears a voice this moment"
        }
      }
    },
    sfu: {
      component: true,
      type: "object",
      wire: false,
      description: "A Realtime session this app's door opened, while its lease holds: the wake beside it is when the lease ends, and the session's tracks close when it does.",
      properties: {
        session: {
          type: "string",
          unique: true,
          description: "the session's id at Cloudflare Realtime"
        },
        key: {
          type: "string",
          description: "the SHA-256 of the key the door handed whoever opened it, which every change to the session carries"
        }
      }
    }
  }
};

// packages/rtc/vocab.ts
var rtcDoc = vocab_default;
var docs = [
  rtcDoc
];
export {
  BITRATE,
  RENEW,
  Refused,
  VOICE,
  docs,
  join,
  loopback,
  microphone,
  rtcDoc,
  voiced
};
