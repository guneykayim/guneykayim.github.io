// Tiny vanilla tracker — no dependencies, no framework, no build step.
// Usage as an ES module (recommended for the test client and for Vite games):
//   import { createTracker } from './tracker.js';
//   const t = createTracker({ endpoint: '/api/event', siteToken: '...' });
//   t.track('pageview');
//   // Each site declares its OWN property spec — the tracker ships
//   // with none. A game might declare board/theme spec like this:
//   //   createTracker({ siteToken, propertySpec: { size: { values: ['s', 'm', 'l'] } } })
//   //   t.track('game_started', { size: 'm' });
//   // A website counting clicks per link declares instead:
//   //   createTracker({ siteToken, propertySpec: { link: { values: ['github', 'substack'] } } })
//   //   t.track('link_click', { link: 'github' });
//
// Link clicks without code: when the site's declared spec has a
// `link` property, the tracker listens for clicks (one delegated
// listener) and fires link_click for any element carrying
// data-tinkerer-link="<value>" — including clicks on children of
// that element. Values outside a declared enum are ignored, so a
// stray attribute can never mint an unattributed click. Turn it
// off with `autoLinkClicks: false`.
//
// Pages and Sources without code: when the site's declared spec
// includes `path` and/or `source` string properties, pageviews
// carry them automatically (the page's pathname, and the
// referrer's host or '(direct)'); see track() for the rules.
//
// As a classic script it also sets window.AnalyticsTracker = { createTracker, ALLOWED_EVENTS }.
// The tracker NEVER sets or reads a cookie, NEVER sends an IP address,
// NEVER sends a raw user agent, and NEVER sends player names, face ids,
// match lists or per-player scores. The browser sends IP/UA headers
// automatically; the Worker derives country/device buckets from them
// and discards the raw values. See ../spec.md sections 5-8.
//
// track() is fire-and-forget: it never throws and never blocks the
// caller. Callers that want to display a result (the test client) may
// await the returned promise; real sites must not await it on a
// click, flip, settle, or any other interaction path.

export const ALLOWED_EVENTS = [
  'pageview',
  'link_click',
  'game_started',
  'game_first_move',
  'game_completed',
];

// Bounded properties only. Anything else is dropped client-side as
// defence in depth; the Worker rejects it server-side as well.
//
// Properties are PER SITE, declared by the calling site — never by
// this framework. A tracker is created with `propertySpec` (the
// same declarative shape the Worker validates against:
// { key: {values:[...]} | {type:'integer',min,max} | {type:'boolean'}
// | {type:'string'} }) and sanitises against exactly that. With no
// spec declared, NO properties pass — the tracker has no built-in
// knowledge of any app's property names or values. (An earlier
// pilot default borrowed the first game's property set; the owner
// removed it on 2026-10-29.)
// game_id is handled separately (see createTracker): it is a
// per-game random id, not a visitor identifier, and is only used
// for lifecycle plausibility within that one game.
export function sanitizeProperties(input, spec) {
  if (!input || typeof input !== 'object') return {};
  if (!spec || typeof spec !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const rule = spec[key];
    if (!rule) continue;
    if (Array.isArray(rule.values)) {
      if (rule.values.includes(value)) out[key] = value;
    } else if (rule.type === 'integer') {
      if (
        Number.isInteger(value) &&
        (!Number.isFinite(rule.min) || value >= rule.min) &&
        (!Number.isFinite(rule.max) || value <= rule.max)
      ) {
        out[key] = value;
      }
    } else if (rule.type === 'boolean') {
      if (typeof value === 'boolean') out[key] = value;
    } else if (rule.type === 'string') {
      const max = Number.isFinite(rule.maxLength) ? rule.maxLength : 64;
      if (typeof value === 'string' && value.length && value.length <= max) {
        out[key] = value;
      }
    }
  }
  return out;
}

function newGameId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to Math.random fallback below
  }
  return (
    'g-' +
    Math.random().toString(36).slice(2, 10) +
    '-' +
    Date.now().toString(36)
  );
}

export function createTracker(options = {}) {
  const endpoint = options.endpoint || '/api/event';
  const siteToken = options.siteToken || '';
  const fetchImpl =
    options.fetchImpl ||
    (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  // Local rigs never emit: on localhost / 127.0.0.1 / ::1 the
  // tracker is disabled by default, so dev servers and automated
  // test rigs make no network call at all. (A failed analytics
  // request would otherwise surface as a console error in the
  // host page — analytics must stay invisible to its host, and
  // local origins are rejected server-side anyway.) An explicit
  // `enabled` option wins over the default in either direction.
  const host =
    typeof window !== 'undefined' && window.location
      ? window.location.hostname
      : '';
  const isLocalHost =
    host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const enabled =
    typeof options.enabled === 'boolean' ? options.enabled : !isLocalHost;
  let currentGameId = null;
  const propertySpec = options.propertySpec || null;
  const doc =
    options.document ||
    (typeof document !== 'undefined' ? document : null);
  let defaultProperties = sanitizeProperties(
    options.defaultProperties || {},
    propertySpec,
  );

  // The source of a pageview, from the browser's referrer:
  // host only, '(direct)' for no referrer, null for same-site
  // navigation (not a source). Never the full referrer URL.
  function referrerSource() {
    if (!doc || !doc.referrer) return '(direct)';
    try {
      const host = new URL(doc.referrer).hostname;
      if (!host) return '(direct)';
      const own =
        typeof window !== 'undefined' && window.location
          ? window.location.hostname
          : '';
      return host === own ? null : host;
    } catch {
      return '(direct)';
    }
  }

  function configure(next = {}) {
    if (next.defaultProperties) {
      defaultProperties = sanitizeProperties(
        next.defaultProperties,
        propertySpec,
      );
    }
  }

  function resetGame() {
    currentGameId = null;
  }

  function getCurrentGameId() {
    return currentGameId;
  }

  // Never throws. On network failure (offline, endpoint down) it
  // resolves { status: 'dropped', reason: 'offline_or_failed' } so a
  // game can continue exactly as if tracking did not exist.
  async function track(event, properties = {}) {
    if (!enabled) return { status: 'dropped', reason: 'disabled', event };
    const clean = sanitizeProperties(properties, propertySpec);
    const page =
      typeof properties.page === 'string' && properties.page.length <= 256
        ? properties.page
        : typeof window !== 'undefined' && window.location
          ? window.location.pathname
          : '/test-client';

    // Automatic page dimensions: when the site's declared spec
    // includes `path` and/or `source` string properties, a
    // pageview carries them without the host page writing any
    // code; that declaration plus a count_by pair is what turns
    // on the dashboard's Pages / Sources tables. `path` is the
    // pathname only, never the query string. `source` is the
    // referrer's HOST only, never the full URL; '(direct)' when
    // there is no referrer; omitted for same-site navigation,
    // which is not a source. Explicit properties always win.
    const auto = {};
    if (event === 'pageview' && propertySpec) {
      if (propertySpec.path && typeof clean.path === 'undefined') {
        auto.path = page;
      }
      if (propertySpec.source && typeof clean.source === 'undefined') {
        const src = referrerSource();
        if (src) auto.source = src;
      }
    }
    const autoClean = sanitizeProperties(auto, propertySpec);

    // Lifecycle: a fresh game gets a fresh id; later moves in the
    // same game reuse it. An explicit properties.game_id (used only
    // by the test client's abuse buttons) wins over the stored one.
    let gameId = null;
    if (event === 'game_started') {
      currentGameId = newGameId();
      gameId = currentGameId;
    } else if (
      event === 'game_first_move' ||
      event === 'game_completed'
    ) {
      gameId =
        typeof properties.game_id === 'string' &&
        properties.game_id.length <= 64
          ? properties.game_id
          : currentGameId;
    }

    const payload = {
      site_token: siteToken,
      event,
      page,
      properties: { ...defaultProperties, ...autoClean, ...clean },
    };
    if (gameId) payload.game_id = gameId;
    // Referrer is taken from the browser, not from game code, and
    // is only used for bot/referrer-spam filtering on the server.
    if (doc && doc.referrer) {
      payload.referrer = doc.referrer.slice(0, 512);
    }

    if (!fetchImpl) {
      return { status: 'dropped', reason: 'no_fetch_available', event };
    }
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        // keepalive lets the request survive a page navigation;
        // it does not make the caller wait for gameplay.
        keepalive: true,
      });
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        return { ...parsed, http_status: res.status };
      } catch {
        return {
          status: res.ok ? 'accepted' : 'rejected',
          reason: 'unparseable_response',
          event,
          http_status: res.status,
        };
      }
    } catch {
      return { status: 'dropped', reason: 'offline_or_failed', event };
    }
  }

  // Data-attribute link clicks (see the header note): one
  // delegated listener, active only when the site declared a
  // `link` property — a pageview-only site stays silent even if
  // its markup happens to carry the attribute.
  if (
    doc &&
    typeof doc.addEventListener === 'function' &&
    options.autoLinkClicks !== false &&
    propertySpec &&
    propertySpec.link
  ) {
    doc.addEventListener('click', (event) => {
      const target = event && event.target;
      if (!target) return;
      let el = null;
      if (typeof target.closest === 'function') {
        el = target.closest('[data-tinkerer-link]');
      } else {
        el = target;
        while (
          el &&
          !(
            typeof el.getAttribute === 'function' &&
            el.getAttribute('data-tinkerer-link')
          )
        ) {
          el = el.parentElement || null;
        }
      }
      if (!el || typeof el.getAttribute !== 'function') return;
      const value = el.getAttribute('data-tinkerer-link');
      if (!value) return;
      const rule = propertySpec.link;
      if (Array.isArray(rule.values) && !rule.values.includes(value)) return;
      track('link_click', { link: value });
    });
  }

  return { track, configure, resetGame, getCurrentGameId };
}

if (typeof window !== 'undefined') {
  window.AnalyticsTracker = { createTracker, ALLOWED_EVENTS };
}
