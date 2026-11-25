var ge = (e) => {
  let r = e.ownerDocument.createElement('script')
  for (let { name: n, value: i } of [...e.attributes]) r.setAttribute(n, i)
  r.textContent = e.textContent,
    r.hasAttribute('src') && (r.async = !1),
    e.replaceWith(r)
}
var he = 'yak-draw'
var ye = {
  $vocabulary: { 'https://yak.sh/vocab/core': !0 },
  title: 'inbox front',
  description: "The inbox views' own state in their page graph, never synced.",
  $defs: {
    inboxAction: {
      component: !0,
      durable: 'connection',
      sync: 'server',
      description: 'an action taken on an inbox card',
      properties: {
        space: { type: 'string' },
        kind: { type: 'string' },
        target: { type: 'string' },
        answer: { type: 'string' },
      },
    },
    inboxReceipt: {
      component: !0,
      durable: 'connection',
      sync: 'server',
      description: "the inbox host's answer to the card action",
      properties: { label: { type: 'string' } },
    },
    inboxActionNote: {
      component: !0,
      durable: 'connection',
      sync: 'none',
      description: 'an action error shown beside the inbox card',
      properties: { message: { type: 'string' } },
    },
    inboxView: {
      component: !0,
      type: 'object',
      sync: 'none',
      durable: 'connection',
      description:
        "the inbox's expanded threads and search switches; words remain synced drafts",
      properties: {
        open: { type: 'boolean', description: 'the thread is expanded' },
        direction: { type: 'string', enum: ['both', 'said', 'received'] },
        all: { type: 'boolean', description: 'include archived threads' },
      },
    },
  },
}
var _e = [ye]
import { shared as ht, wireStash as yt } from '@yaks/client'
var J = '/manage/account/reach',
  Z = 'x-yak-tab-person',
  _t = 'script[data-page-graph]'
var xt = (e, t = globalThis.document) => {
    let r = t?.querySelector(_t)?.textContent, n = r ? JSON.parse(r) : void 0
    return n?.person == e ? n : void 0
  },
  xe = (e, t) => {
    let r = xt(t)
    return ht(new URL(J, globalThis.location?.href ?? 'http://page').href, e, {
      vault: !1,
      wireVault: r ? yt(r) : !1,
      epoch: r?.epoch,
      headers: { [Z]: t },
      connect: (n) => {
        let i = new URL(n)
        return i.searchParams.set(Z, t), new WebSocket(i)
      },
      outboxScope: `${J}:${t}`,
    })
  }
var re,
  m,
  ke,
  bt,
  T,
  be,
  Ae,
  Se,
  Y,
  D,
  U,
  Ee,
  ne,
  Q,
  ee,
  Te,
  $e = {},
  V = [],
  vt = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,
  K = Array.isArray
function E(e, t) {
  for (var r in t) e[r] = t[r]
  return e
}
function oe(e) {
  e && e.parentNode && e.parentNode.removeChild(e)
}
function _(e, t, r) {
  var n, i, o, s = {}
  for (o in t) o == 'key' ? n = t[o] : o == 'ref' ? i = t[o] : s[o] = t[o]
  if (
    arguments.length > 2 &&
    (s.children = arguments.length > 3 ? re.call(arguments, 2) : r),
      typeof e == 'function' && e.defaultProps != null
  ) { for (o in e.defaultProps) s[o] === void 0 && (s[o] = e.defaultProps[o]) }
  return O(e, s, n, i, null)
}
function O(e, t, r, n, i) {
  var o = {
    type: e,
    props: t,
    key: r,
    ref: n,
    __k: null,
    __: null,
    __b: 0,
    __e: null,
    __c: null,
    constructor: void 0,
    __v: i ?? ++ke,
    __i: -1,
    __u: 0,
  }
  return i == null && m.vnode != null && m.vnode(o), o
}
function B(e) {
  return e.children
}
function j(e, t) {
  this.props = e, this.context = t
}
function L(e, t) {
  if (t == null) return e.__ ? L(e.__, e.__i + 1) : null
  for (var r; t < e.__k.length; t++) {
    if ((r = e.__k[t]) != null && r.__e != null) return r.__e
  }
  return typeof e.type == 'function' ? L(e) : null
}
function wt(e) {
  if (e.__P && e.__d) {
    var t = e.__v, r = t.__e, n = [], i = [], o = E({}, t)
    o.__v = t.__v + 1,
      m.vnode && m.vnode(o),
      Ce(
        e.__P,
        o,
        t,
        e.__n,
        e.__P.namespaceURI,
        32 & t.__u ? [r] : null,
        n,
        r ?? L(t),
        !!(32 & t.__u),
        i,
      ),
      o.__v = t.__v,
      o.__.__k[o.__i] = o,
      St(n, o, i),
      t.__e = t.__ = null,
      o.__e != r && Re(o)
  }
}
function Re(e) {
  if ((e = e.__) != null && e.__c != null) {
    return e.__e = e.__c.base = null,
      e.__k.some(function (t) {
        if (t != null && t.__e != null) return e.__e = e.__c.base = t.__e
      }),
      Re(e)
  }
}
function te(e) {
  ;(!e.__d && (e.__d = !0) && T.push(e) && !W.__r++ ||
    be != m.debounceRendering) && ((be = m.debounceRendering) || Ae)(W)
}
function W() {
  try {
    for (var e, t = 1; T.length;) {
      T.length > t && T.sort(Se), e = T.shift(), t = T.length, wt(e)
    }
  } finally {
    T.length = W.__r = 0
  }
}
function Pe(e, t, r, n, i, o, s, p, c, a, d) {
  var g, l, u, h, A, b, y, f = n && n.__k || V, k = t.length
  for (c = kt(r, t, f, c, k), g = 0; g < k; g++) {
    ;(u = r.__k[g]) != null &&
      (l = u.__i != -1 && f[u.__i] || $e,
        u.__i = g,
        b = Ce(e, u, l, i, o, s, p, c, a, d),
        h = u.__e,
        u.ref && l.ref != u.ref &&
        (l.ref && ie(l.ref, null, u), d.push(u.ref, u.__c || h, u)),
        A == null && h != null && (A = h),
        (y = !!(4 & u.__u)) || l.__k === u.__k
          ? (c = Le(u, c, e, y), y && l.__e && (l.__e = null))
          : typeof u.type == 'function' && b !== void 0
          ? c = b
          : h && (c = h.nextSibling),
        u.__u &= -7)
  }
  return r.__e = A, c
}
function kt(e, t, r, n, i) {
  var o, s, p, c, a, d = r.length, g = d, l = 0
  for (e.__k = new Array(i), o = 0; o < i; o++) {
    ;(s = t[o]) != null && typeof s != 'boolean' && typeof s != 'function'
      ? (typeof s == 'string' || typeof s == 'number' || typeof s == 'bigint' ||
          s.constructor == String
        ? s = e.__k[o] = O(null, s, null, null, null)
        : K(s)
        ? s = e.__k[o] = O(B, { children: s }, null, null, null)
        : s.constructor === void 0 && s.__b > 0
        ? s = e.__k[o] = O(s.type, s.props, s.key, s.ref ? s.ref : null, s.__v)
        : e.__k[o] = s,
        c = o + l,
        s.__ = e,
        s.__b = e.__b + 1,
        p = null,
        (a = s.__i = At(s, r, c, g)) != -1 && (g--, (p = r[a]) && (p.__u |= 2)),
        p == null || p.__v == null
          ? (a == -1 && (i > d ? l-- : i < d && l++),
            typeof s.type != 'function' && (s.__u |= 4))
          : a != c &&
            (a == c - 1
              ? l--
              : a == c + 1
              ? l++
              : (a > c ? l-- : l++, s.__u |= 4)))
      : e.__k[o] = null
  }
  if (g) {
    for (o = 0; o < d; o++) {
      ;(p = r[o]) != null && (2 & p.__u) == 0 &&
        (p.__e == n && (n = L(p)), Ue(p, p))
    }
  }
  return n
}
function Le(e, t, r, n) {
  var i, o
  if (typeof e.type == 'function') {
    for (i = e.__k, o = 0; i && o < i.length; o++) {
      i[o] && (i[o].__ = e, t = Le(i[o], t, r, n))
    }
    return t
  }
  e.__e != t &&
    (n &&
      (t && e.type && !t.parentNode && (t = L(e)),
        r.insertBefore(e.__e, t || null)),
      t = e.__e)
  do t = t && t.nextSibling
  while (t != null && t.nodeType == 8)
  return t
}
function At(e, t, r, n) {
  var i,
    o,
    s,
    p = e.key,
    c = e.type,
    a = t[r],
    d = a != null && (2 & a.__u) == 0
  if (a === null && p == null || d && p == a.key && c == a.type) return r
  if (n > (d ? 1 : 0)) {
    for (i = r - 1, o = r + 1; i >= 0 || o < t.length;) {
      if (
        (a = t[s = i >= 0 ? i-- : o++]) != null && (2 & a.__u) == 0 &&
        p == a.key && c == a.type
      ) return s
    }
  }
  return -1
}
function ve(e, t, r) {
  t[0] == '-'
    ? e.setProperty(t, r ?? '')
    : e[t] = r == null ? '' : typeof r != 'number' || vt.test(t) ? r : r + 'px'
}
function H(e, t, r, n, i) {
  var o, s
  e: if (t == 'style') {
    if (typeof r == 'string') e.style.cssText = r
    else {
      if (typeof n == 'string' && (e.style.cssText = n = ''), n) {
        for (t in n) r && t in r || ve(e.style, t, '')
      }
      if (r) { for (t in r) n && r[t] == n[t] || ve(e.style, t, r[t]) }
    }
  } else if (t[0] == 'o' && t[1] == 'n') {
    o = t != (t = t.replace(Ee, '$1')),
      s = t.toLowerCase(),
      t = s in e || t == 'onFocusOut' || t == 'onFocusIn'
        ? s.slice(2)
        : t.slice(2),
      e.l || (e.l = {}),
      e.l[t + o] = r,
      r
        ? n ? r[U] = n[U] : (r[U] = ne, e.addEventListener(t, o ? ee : Q, o))
        : e.removeEventListener(t, o ? ee : Q, o)
  } else {
    if (i == 'http://www.w3.org/2000/svg') {
      t = t.replace(/xlink(H|:h)/, 'h').replace(/sName$/, 's')
    } else if (
      t != 'width' && t != 'height' && t != 'href' && t != 'list' &&
      t != 'form' && t != 'tabIndex' && t != 'download' && t != 'rowSpan' &&
      t != 'colSpan' && t != 'role' && t != 'popover' && t in e
    ) {
      try {
        e[t] = r ?? ''
        break e
      } catch {}
    }
    typeof r == 'function' ||
      (r == null || r === !1 && t[4] != '-'
        ? e.removeAttribute(t)
        : e.setAttribute(t, t == 'popover' && r == 1 ? '' : r))
  }
}
function we(e) {
  return function (t) {
    if (this.l) {
      var r = this.l[t.type + e]
      if (t[D] == null) t[D] = ne++
      else if (t[D] < r[U]) return
      return r(m.event ? m.event(t) : t)
    }
  }
}
function Ce(e, t, r, n, i, o, s, p, c, a) {
  var d, g, l, u, h, A, b, y, f, k, N, R, M, me, F, X, S = t.type
  if (t.constructor !== void 0) return null
  128 & r.__u && (c = !!(32 & r.__u), o = [p = t.__e = r.__e]),
    (d = m.__b) && d(t)
  e: if (typeof S == 'function') {
    g = s.length
    try {
      if (
        f = t.props,
          k = S.prototype && S.prototype.render,
          N = (d = S.contextType) && n[d.__c],
          R = d ? N ? N.props.value : d.__ : n,
          r.__c
            ? y = (l = t.__c = r.__c).__ = l.__E
            : (k
              ? t.__c = l = new S(f, R)
              : (t.__c = l = new j(f, R), l.constructor = S, l.render = Tt),
              N && N.sub(l),
              l.state || (l.state = {}),
              l.__n = n,
              u = l.__d = !0,
              l.__h = [],
              l._sb = []),
          k && l.__s == null && (l.__s = l.state),
          k && S.getDerivedStateFromProps != null &&
          (l.__s == l.state && (l.__s = E({}, l.__s)),
            E(l.__s, S.getDerivedStateFromProps(f, l.__s))),
          h = l.props,
          A = l.state,
          l.__v = t,
          u
      ) {
        k && S.getDerivedStateFromProps == null &&
        l.componentWillMount != null && l.componentWillMount(),
          k && l.componentDidMount != null && l.__h.push(l.componentDidMount)
      } else {
        if (
          k && S.getDerivedStateFromProps == null && f !== h &&
          l.componentWillReceiveProps != null &&
          l.componentWillReceiveProps(f, R),
            t.__v == r.__v ||
            !l.__e && l.shouldComponentUpdate != null &&
              l.shouldComponentUpdate(f, l.__s, R) === !1
        ) {
          t.__v != r.__v && (l.props = f, l.state = l.__s, l.__d = !1),
            t.__e = r.__e,
            t.__k = r.__k,
            t.__k.some(function (P) {
              P && (P.__ = t)
            }),
            V.push.apply(l.__h, l._sb),
            l._sb = [],
            l.__h.length && s.push(l)
          break e
        }
        l.componentWillUpdate != null && l.componentWillUpdate(f, l.__s, R),
          k && l.componentDidUpdate != null && l.__h.push(function () {
            l.componentDidUpdate(h, A, b)
          })
      }
      if (
        l.context = R, l.props = f, l.__P = e, l.__e = !1, M = m.__r, me = 0, k
      ) {
        l.state = l.__s,
          l.__d = !1,
          M && M(t),
          d = l.render(l.props, l.state, l.context),
          V.push.apply(l.__h, l._sb),
          l._sb = []
      } else {do l.__d = !1,
          M && M(t),
          d = l.render(l.props, l.state, l.context),
          l.state = l.__s
        while (l.__d && ++me < 25)}
      l.state = l.__s,
        l.getChildContext != null && (n = E(E({}, n), l.getChildContext())),
        k && !u && l.getSnapshotBeforeUpdate != null &&
        (b = l.getSnapshotBeforeUpdate(h, A)),
        F = d != null && d.type === B && d.key == null
          ? Me(d.props.children)
          : d,
        p = Pe(e, K(F) ? F : [F], t, r, n, i, o, s, p, c, a),
        l.base = t.__e,
        t.__u &= -161,
        l.__h.length && s.push(l),
        y && (l.__E = l.__ = null)
    } catch (P) {
      if (s.length = g, t.__v = null, c || o != null) {
        if (P.then) {
          for (
            t.__u |= c ? 160 : 128;
            p && p.nodeType == 8 && p.nextSibling;
          ) p = p.nextSibling
          o != null && (o[o.indexOf(p)] = null), t.__e = p
        } else if (o != null) { for (X = o.length; X--;) oe(o[X]) }
      } else t.__e = r.__e
      t.__k == null && (t.__k = r.__k || []), P.then || Ne(t), m.__e(P, t, r)
    }
  } else {o == null && t.__v == r.__v
      ? (t.__k = r.__k, t.__e = r.__e)
      : p = t.__e = Et(r.__e, t, r, n, i, o, s, c, a)}
  return (d = m.diffed) && d(t), 128 & t.__u ? void 0 : p
}
function Ne(e) {
  e && (e.__c && (e.__c.__e = !0), e.__k && e.__k.some(Ne))
}
function St(e, t, r) {
  for (var n = 0; n < r.length; n++) ie(r[n], r[++n], r[++n])
  m.__c && m.__c(t, e),
    e.some(function (i) {
      try {
        e = i.__h,
          i.__h = [],
          e.some(function (o) {
            o.call(i)
          })
      } catch (o) {
        m.__e(o, i.__v)
      }
    })
}
function Me(e) {
  return typeof e != 'object' || e == null || e.__b > 0
    ? e
    : K(e)
    ? e.map(Me)
    : e.constructor !== void 0
    ? null
    : E({}, e)
}
function Et(e, t, r, n, i, o, s, p, c) {
  var a, d, g, l, u, h, A, b = r.props || $e, y = t.props, f = t.type
  if (
    f == 'svg'
      ? i = 'http://www.w3.org/2000/svg'
      : f == 'math'
      ? i = 'http://www.w3.org/1998/Math/MathML'
      : i || (i = 'http://www.w3.org/1999/xhtml'), o != null
  ) {
    for (a = 0; a < o.length; a++) {
      if (
        (u = o[a]) && 'setAttribute' in u == !!f &&
        (f ? u.localName == f : u.nodeType == 3)
      ) {
        e = u, o[a] = null
        break
      }
    }
  }
  if (e == null) {
    if (f == null) return document.createTextNode(y)
    e = document.createElementNS(i, f, y.is && y),
      p && (m.__m && m.__m(t, o), p = !1),
      o = null
  }
  if (f == null) b === y || p && e.data == y || (e.data = y)
  else {
    if (
      o = f == 'textarea' && y.defaultValue != null
        ? null
        : o && re.call(e.childNodes), !p && o != null
    ) {
      for (
        b = {}, a = 0;
        a < e.attributes.length;
        a++
      ) b[(u = e.attributes[a]).name] = u.value
    }
    for (a in b) {
      u = b[a],
        a == 'dangerouslySetInnerHTML'
          ? g = u
          : a == 'children' || a in y || a == 'value' && 'defaultValue' in y ||
            a == 'checked' && 'defaultChecked' in y || H(e, a, null, u, i)
    }
    for (a in y) {
      u = y[a],
        a == 'children'
          ? l = u
          : a == 'dangerouslySetInnerHTML'
          ? d = u
          : a == 'value'
          ? h = u
          : a == 'checked'
          ? A = u
          : p && typeof u != 'function' || b[a] === u || H(e, a, u, b[a], i)
    }
    if (d) {
      p || g && (d.__html == g.__html || d.__html == e.innerHTML) ||
      (e.innerHTML = d.__html), t.__k = []
    } else if (
      g && (e.innerHTML = ''),
        Pe(
          t.type == 'template' ? e.content : e,
          K(l) ? l : [l],
          t,
          r,
          n,
          f == 'foreignObject' ? 'http://www.w3.org/1999/xhtml' : i,
          o,
          s,
          o ? o[0] : r.__k && L(r, 0),
          p,
          c,
        ),
        o != null
    ) { for (a = o.length; a--;) oe(o[a]) }
    p && f != 'textarea' ||
      (a = 'value',
        f == 'progress' && h == null ? e.removeAttribute('value') : h != null &&
          (h !== e[a] || f == 'progress' && !h || f == 'option' && h != b[a]) &&
          H(e, a, h, b[a], i),
        a = 'checked',
        A != null && A != e[a] && H(e, a, A, b[a], i))
  }
  return e
}
function ie(e, t, r) {
  try {
    if (typeof e == 'function') {
      var n = typeof e.__u == 'function'
      n && e.__u(), n && t == null || (e.__u = e(t))
    } else e.current = t
  } catch (i) {
    m.__e(i, r)
  }
}
function Ue(e, t, r) {
  var n, i
  if (
    m.unmount && m.unmount(e),
      (n = e.ref) && (n.current && n.current != e.__e || ie(n, null, t)),
      (n = e.__c) != null
  ) {
    if (n.componentWillUnmount) {
      try {
        n.componentWillUnmount()
      } catch (o) {
        m.__e(o, t)
      }
    }
    n.base = n.__P = n.__n = null
  }
  if (n = e.__k) {
    for (i = 0; i < n.length; i++) {
      n[i] && Ue(n[i], t, r || typeof e.type != 'function')
    }
  }
  r || oe(e.__e), e.__c = e.__ = e.__e = void 0
}
function Tt(e, t, r) {
  return this.constructor(e, r)
}
function Be(e) {
  function t(r) {
    var n, i
    return this.getChildContext ||
      (n = new Set(),
        (i = {})[t.__c] = this,
        this.getChildContext = function () {
          return i
        },
        this.componentWillUnmount = function () {
          n = null
        },
        this.shouldComponentUpdate = function (o) {
          this.props.value != o.value && n.forEach(function (s) {
            s.__e = !0, te(s)
          })
        },
        this.sub = function (o) {
          n.add(o)
          var s = o.componentWillUnmount
          o.componentWillUnmount = function () {
            n && n.delete(o), s && s.call(o)
          }
        }),
      r.children
  }
  return t.__c = '__cC' + Te++,
    t.__ = e,
    t.Provider =
      t.__l =
      (t.Consumer = function (r, n) {
        return r.children(n)
      }).contextType =
        t,
    t
}
re = V.slice,
  m = {
    __e: function (e, t, r, n) {
      for (var i, o, s; t = t.__;) {
        if ((i = t.__c) && !i.__) {
          try {
            if (
              (o = i.constructor) && o.getDerivedStateFromError != null &&
              (i.setState(o.getDerivedStateFromError(e)), s = i.__d),
                i.componentDidCatch != null &&
                (i.componentDidCatch(e, n || {}), s = i.__d),
                s
            ) return i.__E = i
          } catch (p) {
            e = p
          }
        }
      }
      throw e
    },
  },
  ke = 0,
  bt = function (e) {
    return e != null && e.constructor === void 0
  },
  j.prototype.setState = function (e, t) {
    var r
    r = this.__s != null && this.__s != this.state
      ? this.__s
      : this.__s = E({}, this.state),
      typeof e == 'function' && (e = e(E({}, r), this.props)),
      e && E(r, e),
      e != null && this.__v && (t && this._sb.push(t), te(this))
  },
  j.prototype.forceUpdate = function (e) {
    this.__v && (this.__e = !0, e && this.__h.push(e), te(this))
  },
  j.prototype.render = B,
  T = [],
  Ae = typeof Promise == 'function'
    ? Promise.prototype.then.bind(Promise.resolve())
    : setTimeout,
  Se = function (e, t) {
    return e.__v.__b - t.__v.__b
  },
  W.__r = 0,
  Y = Math.random().toString(8),
  D = '__d' + Y,
  U = '__a' + Y,
  Ee = /(PointerCapture)$|Capture$/i,
  ne = 0,
  Q = we(!1),
  ee = we(!0),
  Te = 0
var z,
  v,
  le,
  Ie,
  Fe = 0,
  qe = [],
  x = m,
  He = x.__b,
  De = x.__r,
  Oe = x.diffed,
  je = x.__c,
  Ve = x.unmount,
  We = x.__
function ze(e, t) {
  x.__h && x.__h(v, e, Fe || t), Fe = 0
  var r = v.__H || (v.__H = { __: [], __h: [] })
  return e >= r.__.length && r.__.push({}), r.__[e]
}
function se(e, t) {
  var r = ze(z++, 7)
  return Pt(r.__H, t) && (r.__ = e(), r.__H = t, r.__h = e), r.__
}
function Ge(e) {
  var t = v.context[e.__c], r = ze(z++, 9)
  return r.c = e,
    t ? (r.__ == null && (r.__ = !0, t.sub(v)), t.props.value) : e.__
}
function $t() {
  for (var e; e = qe.shift();) {
    var t = e.__H
    if (e.__P && t) {
      try {
        t.__h.some(q), t.__h.some(ae), t.__h = []
      } catch (r) {
        t.__h = [], x.__e(r, e.__v)
      }
    }
  }
}
x.__b = function (e) {
  v = null, He && He(e)
},
  x.__ = function (e, t) {
    e && t.__k && t.__k.__m && (e.__m = t.__k.__m), We && We(e, t)
  },
  x.__r = function (e) {
    De && De(e), z = 0
    var t = (v = e.__c).__H
    t && (le === v
      ? (t.__h = [],
        v.__h = [],
        t.__.some(function (r) {
          r.__N && (r.__ = r.__N), r.u = r.__N = void 0
        }))
      : (t.__h.some(q), t.__h.some(ae), t.__h = [], z = 0)), le = v
  },
  x.diffed = function (e) {
    Oe && Oe(e)
    var t = e.__c
    t && t.__H &&
    (t.__H.__h.length &&
      (qe.push(t) !== 1 && Ie === x.requestAnimationFrame ||
        ((Ie = x.requestAnimationFrame) || Rt)($t)),
      t.__H.__.some(function (r) {
        r.u && (r.__H = r.u, r.u = void 0)
      })), le = v = null
  },
  x.__c = function (e, t) {
    t.some(function (r) {
      try {
        r.__h.some(q),
          r.__h = r.__h.filter(function (n) {
            return !n.__ || ae(n)
          })
      } catch (n) {
        t.some(function (i) {
          i.__h && (i.__h = [])
        }),
          t = [],
          x.__e(n, r.__v)
      }
    }), je && je(e, t)
  },
  x.unmount = function (e) {
    Ve && Ve(e)
    var t, r = e.__c
    r && r.__H && (r.__H.__.some(function (n) {
      try {
        q(n)
      } catch (i) {
        t = i
      }
    }),
      r.__H = void 0,
      t && x.__e(t, r.__v))
  }
var Ke = typeof requestAnimationFrame == 'function'
function Rt(e) {
  var t,
    r = function () {
      clearTimeout(n), Ke && cancelAnimationFrame(t), setTimeout(e)
    },
    n = setTimeout(r, 35)
  Ke && (t = requestAnimationFrame(r))
}
function q(e) {
  var t = v, r = e.__c
  typeof r == 'function' && (e.__c = void 0, r()), v = t
}
function ae(e) {
  var t = v
  e.__c = e.__(), v = t
}
function Pt(e, t) {
  return !e || e.length !== t.length || t.some(function (r, n) {
    return r !== e[n]
  })
}
var Xe = Be({}),
  Lt = (e, t, r) =>
    !t || t == r
      ? { tag: e }
      : r
      ? { tag: e, demote: t }
      : { tag: 'a', href: t },
  Je = (e, t, r) =>
    !t && !r
      ? e
      : [e, ...[t].flat().filter(Boolean).map((n) => `${e}-${n}`), r].filter(
        Boolean,
      ).join(' '),
  Ct = (e, t) =>
    typeof t == 'function'
      ? { look: t, tag: typeof e == 'string' ? e : void 0 }
      : typeof e == 'function'
      ? { look: e, tag: t }
      : { tag: t ?? e },
  w =
    (e, t) =>
    ({ mod: r, class: n, elRef: i, children: o, href: s, as: p, ...c }) => {
      let a = Ct(e, p)
      if (a.look) {
        let u = Je(t, r, n)
        return _(a.look, {
          ...c,
          as: a.tag,
          class: u,
          elRef: i,
          href: s,
          children: o,
        })
      }
      let d = Lt(a.tag, s, Ge(Xe).href),
        g = _(d.tag, {
          ...c,
          ...d.href && { href: d.href },
          ...d.demote && { role: 'link', tabIndex: 0, 'data-href': d.demote },
          ref: i,
          class: Je(t, r, n),
          ...o !== void 0 && { children: o },
        }),
        l = se(() => ({ href: d.href }), [d.href])
      return d.href ? _(Xe.Provider, { value: l }, g) : g
    },
  $ = (e, t, r) =>
    Object.assign(
      w(e, t),
      Object.fromEntries(
        Object.entries(r).map(([n, i]) => [n, w(i, `${t}_${n}`)]),
      ),
    )
var Nt = w('span', 'Badge')
var C = Object.assign(w('section', 'Surface'), {
  Raised: w('div', 'Surface_Raised'),
  Press: w('button', 'Surface_Press'),
  Well: w('input', 'Surface_Well'),
})
var Mt = w(C.Press, 'Button')
var Ut = 'Field', zr = w(C.Well, Ut)
var Ze = (e, t) => e('input', t)
var Ye = Object.assign(
  $('form', 'Form', {
    Field: 'div',
    Label: 'label',
    Optional: 'span',
    Hint: 'p',
    Value: 'p',
    Line: 'div',
    Actions: 'div',
    Trap: 'div',
  }),
  { Hidden: ({ type: e, ...t }) => Ze(_, { type: 'hidden', ...t }) },
)
var { Label: en, Optional: tn, Hint: rn, Value: nn, Line: on, Actions: ln } = Ye
var un = w('svg', 'Icon')
var Bt = $('div', 'Identity', {
  Avatar: 'span',
  Image: 'img',
  Text: 'span',
  Name: 'b',
  Note: 'small',
  Action: 'span',
  Mark: 'span',
  Add: 'a',
})
var pe = $(C.Raised, 'Menu', {
    Trigger: 'button',
    Item: 'button',
    Rule: 'hr',
    List: 'div',
    Ask: 'p',
    Footer: 'div',
    Fold: 'details',
    Summary: 'summary',
  }),
  Qe = Object.assign(({ children: e, ...t }) => _(pe, t, _(pe.List, {}, e)), pe)
var { Trigger: _n, Item: xn, Rule: bn } = Qe
var et = $('nav', 'SideNav', {
  Link: 'a',
  Label: 'span',
  Rule: 'hr',
  Edge: 'aside',
})
var { Link: Sn, Label: En, Rule: Tn, Edge: $n } = et
var Ft = new TextEncoder(),
  Ht = (e, t) => Ft.encode(`${e} ${t}\0`),
  ue = (e) => {
    let t = new Uint8Array(e.reduce((n, i) => n + i.length, 0)), r = 0
    for (let n of e) t.set(n, r), r += n.length
    return t
  },
  Dt = (e, t) => ue([Ht(e, t.length), t]),
  Ot = (e) => Array.from(e, (t) => t.toString(16).padStart(2, '0')).join('')
var tt = (e) => async (t, r) =>
    Ot(new Uint8Array(await crypto.subtle.digest(e, Dt(t, r)))),
  Pn = tt('SHA-1'),
  Ln = tt('SHA-256')
var Mn = new TextEncoder(), Un = new TextDecoder()
var jt = 65516, Vt = jt - 1
var G = 'yaks.app'
var de = (e = {}) => e.APEX || G
var I = (e, t = '') => `https://${de(e)}${t}`
var Qn = new RegExp(
  `\\bhttps?:\\/\\/[^\\s<>"'\`]+|(?:@|\\.)${
    de().replaceAll('.', '\\.')
  }\\b(?![\\p{L}\\p{N}_@-]|\\.[\\p{L}\\p{N}_-])`,
  'giu',
)
var rt = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  io = new RegExp(`(?:^|/)\\.releases/[^/]+/(${rt})$`),
  lo = new RegExp(`^/assets/(${rt})/(.+)$`)
var ce = '/manage'
var Wt = 'account'
var Kt = [
    'apps',
    'new',
    'operator',
    'updates',
    'matches',
    'people',
    'connections',
    'visits',
    'selling',
    'billing',
    'domains',
    'settings',
    'trash',
  ],
  qt = ['profile', 'friends', 'invite', 'agents', 'shared', 'space'],
  nt = (e) => qt.includes(e),
  wo = { ...Object.fromEntries(Kt.map((e) => [e, e])), connect: 'agents' }
var ot = (e, t) =>
  nt(e)
    ? `${ce}/${Wt}/${e}`
    : t
    ? `${ce}/${encodeURIComponent(t)}/${e}`
    : `${ce}/${e}`
var zt = '/api/browse', ko = `${zt}/admin`
var Ao = I({}, '/pricing')
var Gt = I({}, '/mcp'), So = `${Gt}?auth=required`, Eo = I({}, '/login')
var To = `/login?return=${encodeURIComponent(ot('billing'))}`
var Xt = (e = {}) =>
    `sign in at ${I(e, '/login')} to reach your apps from here`,
  $o = Xt()
var Ro = `origin.saas.${G}`
var Jt = '_preview', Po = new RegExp(`^/[^/]+/(?:${Jt}|~[a-z0-9]{12})(?:/|$)`)
var zo = new Int32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298,
])
var Go = new TextEncoder()
var Xo = new Uint8Array(256)
var Jo = Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, '0'))
var Zo = new Int32Array(8), Yo = new Int32Array(64)
var lt = (e) => e
var Zt = (e) =>
  e === null
    ? 'null'
    : Array.isArray(e)
    ? 'array'
    : e instanceof RegExp
    ? 'regex'
    : e instanceof Promise
    ? 'promise'
    : e instanceof Map
    ? 'map'
    : e instanceof Set
    ? 'set'
    : typeof e
var Yt = (e) => !e,
  it = (e, t) => (...r) => e(t(...r)),
  at = (e, ...t) => t.length ? t.reduce(it, e) : (r) => it(e, r),
  Qt = at(Yt)
var er = (e, t) => (r) => {
  let n = e ? e(r) : r
  return typeof t == 'function' ? n ? t(r, n) : r : (t[n] ?? t._ ?? lt)(r, n)
}
var ci = er(Zt, { function: lt, _: (e) => (t) => t[e] })
var st = (e) => (t) => t + e, fi = st(1), mi = st(-1)
var tr = (e) => (t) => t.filter(e), gi = at(tr, Qt)
var ir = {
    type: 'object',
    properties: {
      space: { type: 'string' },
      rank: { type: 'integer' },
      slug: { type: 'string' },
      title: { type: 'string' },
      owner: { type: 'boolean' },
      own: { type: 'boolean' },
      whose: { type: 'string' },
      operator: { type: 'string' },
      logo: { type: 'string' },
    },
    required: ['space', 'rank', 'slug', 'title', 'owner', 'own'],
  },
  Ui = {
    $defs: {
      sideSpace: { component: !0, ...ir },
      sideApp: {
        component: !0,
        type: 'object',
        properties: {
          space: { type: 'string' },
          rank: { type: 'integer' },
          app: { type: 'string' },
          slug: { type: 'string' },
          title: { type: 'string' },
          source: { type: ['string', 'null'] },
          generatedIcon: { type: 'string' },
        },
        required: ['space', 'rank', 'app', 'slug', 'title'],
      },
    },
  }
var pt = '[data-side-view]'
var fe = 'data-talk-view', ut = 'yak-viewed'
var dt = (e, t) => e.find((r) => r.here == t)
var ct = 'SideNav_Link-on',
  lr = 'data-started',
  mt = (e) => JSON.parse(e.getAttribute(fe)),
  ar = (e, t) => {
    for (let i of e.querySelectorAll('.SideNav_Link[href]')) {
      i.getAttribute('href') == t.link
        ? (i.classList.add(ct), i.setAttribute('aria-current', 'page'))
        : i.getAttribute('aria-current') == 'page' &&
          (i.classList.remove(ct), i.removeAttribute('aria-current'))
    }
    let r = e.querySelector(pt), n = r && JSON.parse(r.dataset.sideView)
    n?.talk && (n.talk.all = t.all, r.dataset.sideView = JSON.stringify(n))
  },
  ft = (e) => {
    for (let t of e.querySelectorAll('[data-updates-view]')) {
      let { person: r, spaces: n } = JSON.parse(t.dataset.updatesView),
        i = xe(_e, r)
      for (let { eid: o } of n) {
        Promise.resolve(
          i.mutate([{
            entity: { eid: crypto.randomUUID() },
            inboxAction: { kind: 'seen', space: o, target: o, answer: '' },
          }]),
        ).catch((s) => globalThis.reportError?.(s))
      }
    }
  },
  sr = (e, t, r) => {
    let n = mt(r), i = e.getElementById('content'), o = t.find((a) => !a.hidden)
    if (i && o) {
      let a = i.scrollTop + i.clientHeight >= i.scrollHeight - 2
      o.dataset.scroll = a ? 'end' : String(i.scrollTop)
    }
    for (let a of t) {
      a.hidden != (a != r) &&
        (a.hidden = a != r,
          a.dispatchEvent(new (e.defaultView ?? globalThis).Event(ut)))
    }
    if (i) {
      let a = r.dataset.scroll ??
        (r.querySelector('[data-conversation]') ? 'end' : '0')
      i.scrollTop = a == 'end' ? i.scrollHeight : Number(a)
    }
    for (let a of r.querySelectorAll(`script:not([src]):not([${lr}])`)) {
      a.getAttribute('type') == 'module' && ge(a)
    }
    e.title = n.page
    let s = e.querySelector('[data-title]')
    s && (s.textContent = n.title)
    let p = e.querySelector('a.Skip')
    p && (p.setAttribute('href', n.skip[0]), p.textContent = n.skip[1])
    for (let a of e.querySelectorAll('#aside, .Frame_AsideTools')) {
      a.hidden = !n.aside
    }
    for (let a of e.querySelectorAll('form[data-side] input[name=back]')) {
      a.value = n.here
    }
    ar(e, n)
    let c = e.defaultView
    c?.requestAnimationFrame
      ? c.requestAnimationFrame(() => c.setTimeout(() => ft(r)))
      : ft(r)
  },
  pr = (e) => {
    e.addEventListener(he, (t) => {
      let r = t.detail,
        n = [...e.querySelectorAll(`[${fe}]`)],
        i = dt(
          n.map((o) => ({ here: mt(o).here, el: o })),
          r.to.pathname + r.to.search,
        )
      i && (r.draw = () => sr(e, n, i.el))
    })
  }
typeof document < 'u' && pr(document)
export { lr as STARTED, pr as switching, sr as show }
