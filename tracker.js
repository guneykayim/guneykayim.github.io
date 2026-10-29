// Tiny vanilla tracker — no dependencies, no framework, no build step.
// Usage as an ES module (recommended for the test client and for Vite games):
//   import { createTracker } from './tracker.js';
//   const t = createTracker({ endpoint: '/api/event', siteToken: '...' });
//   t.track('pageview');
//   t.track('game_started', { board_size: '6x6', theme: 'flags', player_count: 2, mode: 'local' });
//   // A website with a declared spec counts clicks per link instead:
//   //   createTracker({ siteToken, propertySpec: { link: { values: ['github', 'substack'] } } })
//   //   t.track('link_click', { link: 'github' });
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
export const ALLOWED_PROPERTIES = {
  board_size: ['4x4', '6x6', '8x8', '10x10'],
  theme: ['pokemon', 'emoji', 'disney', 'flags', 'spanish'],
  mode: ['local'], // Pilot scope: local only. Online is excluded in the pilot.
  // player_count and extra_turn are validated by type/range below.
};

// With no spec, the pilot property set above applies. A tracker
// created with `propertySpec` (the same declarative shape the Worker
// validates against: { key: {values:[...]} | {type:'integer',min,max}
// | {type:'boolean'} | {type:'string'} }) sanitises against that
// instead — e.g. a website declaring { link: { values: [...] } } for
// its link_click events.
export function sanitizeProperties(input, spec) {
  if (!input || typeof input !== 'object') return {};
  if (spec && typeof spec === 'object') {
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
        if (typeof value === 'string' && value.length && value.length <= 64) {
          out[key] = value;
        }
      }
    }
    return out;
  }
  const out = {};
  if (ALLOWED_PROPERTIES.board_size.includes(input.board_size)) {
    out.board_size = input.board_size;
  }
  if (ALLOWED_PROPERTIES.theme.includes(input.theme)) {
    out.theme = input.theme;
  }
  if (ALLOWED_PROPERTIES.mode.includes(input.mode)) {
    out.mode = input.mode;
  }
  if (
    Number.isInteger(input.player_count) &&
    input.player_count >= 1 &&
    input.player_count <= 4
  ) {
    out.player_count = input.player_count;
  }
  if (typeof input.extra_turn === 'boolean') {
    out.extra_turn = input.extra_turn;
  }
  // game_id is handled separately (see createTracker): it is a
  // per-game random id, not a visitor identifier, and is only used
  // for lifecycle plausibility within that one game.
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
  let currentGameId = null;
  const propertySpec = options.propertySpec || null;
  let defaultProperties = sanitizeProperties(
    options.defaultProperties || {},
    propertySpec,
  );

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
    const clean = sanitizeProperties(properties, propertySpec);
    const page =
      typeof properties.page === 'string' && properties.page.length <= 256
        ? properties.page
        : typeof window !== 'undefined' && window.location
          ? window.location.pathname
          : '/test-client';

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
      properties: { ...defaultProperties, ...clean },
    };
    if (gameId) payload.game_id = gameId;
    // Referrer is taken from the browser, not from game code, and
    // is only used for bot/referrer-spam filtering on the server.
    if (typeof document !== 'undefined' && document.referrer) {
      payload.referrer = document.referrer.slice(0, 512);
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

  return { track, configure, resetGame, getCurrentGameId };
}

if (typeof window !== 'undefined') {
  window.AnalyticsTracker = { createTracker, ALLOWED_EVENTS };
}
