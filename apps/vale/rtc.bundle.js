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
var join = async (opts) => {
  let door = new URL(opts.door ?? "api/rtc/", document.baseURI);
  let send = opts.fetch ?? fetch.bind(globalThis);
  let state = "joining";
  let moved = (s) => {
    if (s == state) return;
    state = s;
    opts.change?.(s);
  };
  let leaving = new AbortController();
  let hasLeft = () => leaving.signal.aborted;
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
      signal: AbortSignal.any([
        AbortSignal.timeout(15e3),
        leaving.signal
      ])
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
  let cancelBackoff = null;
  let muted = false;
  let talking = false;
  let writes = Promise.resolve();
  let writePresence = (rtc) => {
    let next = writes.then(() => opts.write([
      {
        entity: {
          eid: opts.entity
        },
        rtc
      }
    ])).then(() => {
    });
    writes = next.catch(() => {
    });
    return next;
  };
  let wear = () => hasLeft() ? Promise.resolve() : writePresence(sent.size ? {
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
  });
  let open = async () => {
    key = "";
    let { iceServers } = await ask("POST", "ice");
    if (hasLeft()) return;
    let opened = await ask("POST", "sessions/new");
    if (hasLeft()) return;
    session = opened.sessionId;
    key = opened.key;
    pc = new RTCPeerConnection({
      iceServers,
      bundlePolicy: "max-bundle"
    });
    let mine = pc;
    let lost;
    pc.onconnectionstatechange = () => {
      if (mine != pc || hasLeft()) return;
      clearTimeout(lost);
      if (pc.connectionState == "failed") void rebuild();
      if (pc.connectionState == "disconnected") {
        lost = setTimeout(() => mine == pc && void rebuild(), 5e3);
      }
    };
    voice = await sender(null, VOICE);
    if (hasLeft()) pc.close();
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
    let previous = sent.get(name);
    let live = () => track.readyState != "ended";
    let tx = name == VOICE ? voice : await sender(track, name);
    if (hasLeft() || !live() || previous && sent.get(name) != previous) {
      if (tx != voice) tx.stop();
      return;
    }
    if (tx == voice) await voice.sender.replaceTrack(track);
    if (hasLeft() || !live() || previous && sent.get(name) != previous) {
      await tx.sender.replaceTrack(null).catch(() => {
      });
      if (tx != voice) tx.stop();
      return;
    }
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
  let backoff = (ms) => new Promise((resolve) => {
    let timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      if (cancelBackoff == done) cancelBackoff = null;
      resolve();
    }
    cancelBackoff = done;
  });
  let rebuilding = null;
  let rebuild = () => rebuilding ??= serial(async () => {
    moved("lost");
    for (let h of heard) {
      h.dead = true;
      h.detach();
    }
    heard.clear();
    pc.close();
    for (let tries = 0; !hasLeft(); tries++) {
      try {
        await open();
        if (hasLeft()) {
          pc.close();
          return;
        }
        for (let [name, { track }] of [
          ...sent
        ]) {
          if (hasLeft()) return;
          if (sent.get(name)?.track == track) await push(track, name);
        }
        if (hasLeft()) return;
        await wear();
        if (hasLeft()) return;
        moved("live");
        return;
      } catch (e) {
        if (hasLeft()) return;
        if (e instanceof Refused && e.code == "limit") return moved("limit");
        await backoff(Math.min(3e4, 1e3 * 2 ** tries));
      }
    }
  }).finally(() => rebuilding = null);
  let renew = async () => {
    if (hasLeft() || rebuilding) return;
    try {
      await ask("POST", on("/renew"));
      if (hasLeft()) return;
      moved("live");
      await wear();
    } catch (e) {
      if (hasLeft() || !(e instanceof Refused)) return;
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
    if (hasLeft()) return;
    let now = voice2 && !muted ? voiced(level, talking) : false;
    if (now != talking) {
      talking = now;
      await wear();
    }
  };
  try {
    await open();
  } catch (e) {
    if (e instanceof Refused) moved(e.code == "limit" ? "limit" : "refused");
    throw e;
  }
  try {
    await wear();
  } catch (error) {
    leaving.abort();
    pc.close();
    throw error;
  }
  if (hasLeft()) {
    pc.close();
    throw new Error("The call has left");
  }
  moved("live");
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
      if (hasLeft()) throw new Error("The call has left");
      await push(track, name);
      if (hasLeft() || track.readyState == "ended") {
        let held = sent.get(name);
        if (held?.track == track) {
          sent.delete(name);
          await held.tx.sender.replaceTrack(null).catch(() => {
          });
        }
        throw new Error("The call or microphone has ended");
      }
      try {
        await wear();
        if (hasLeft()) throw new Error("The call has left");
      } catch (error) {
        let held = sent.get(name);
        if (held?.track == track) {
          sent.delete(name);
          if (held.tx == voice) await voice.sender.replaceTrack(null);
          else await close([
            held.tx
          ]).catch(() => {
          });
        }
        throw error;
      }
      return {
        name,
        stop: async () => {
          let held = sent.get(name);
          if (!held || held.track != track) return;
          sent.delete(name);
          if (held.tx == voice) {
            await held.tx.sender.replaceTrack(null).catch(() => {
            });
          } else {
            held.tx.stop();
            let at = pc;
            void serial(async () => {
              if (!hasLeft() && at == pc) await close([
                held.tx
              ]);
            }).catch(() => {
            });
          }
          await wear();
        }
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
      void wear().catch(() => {
      });
    },
    hear: (from, name) => serial(async () => {
      if (hasLeft() || state == "limit") return null;
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
        dead: false,
        detach: () => {
          el.srcObject = null;
        }
      };
      heard.add(mark);
      let at = pc;
      return {
        stream,
        get live() {
          return !mark.dead;
        },
        stop: () => serial(async () => {
          mark.detach();
          if (mark.dead) return;
          mark.dead = true;
          heard.delete(mark);
          if (at == pc && !hasLeft()) await close([
            tx
          ]);
        })
      };
    }),
    // Leave cannot wait behind a reconnect's backoff or a stuck door.
    // Its caller may immediately join again as this hero; the presence write
    // is performed before this promise settles.
    leave: async () => {
      if (hasLeft()) return;
      clearInterval(renewing);
      clearInterval(hearing);
      moved("left");
      leaving.abort();
      cancelBackoff?.();
      for (let h of heard) {
        h.dead = true;
        h.detach();
      }
      heard.clear();
      sent.clear();
      pc.close();
      await writePresence(null);
    }
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
