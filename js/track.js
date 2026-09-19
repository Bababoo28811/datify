// track.js — first-party, anonymous usage logging.
//
// Writes one row per interaction into the `events` table in Supabase. There
// is no third-party analytics script anywhere on this site and no cookie:
// nothing here leaves our own database, which is the whole point — the
// numbers are ours to quote at a venue.
//
// What is deliberately NOT recorded: IP address, user agent, email, name,
// or anything else that identifies a person. `sid` is a random id this
// browser invents for itself and keeps in localStorage so repeat visits can
// be counted as one visitor; it means nothing outside this site. When
// someone is signed in the database fills `user_id` in from their token —
// the browser is never trusted to say who it is.
//
// Loaded after supabase-client.js and before app.js. No IIFE, matching the
// rest of the codebase, so inline onclick handlers can call track().

const TRACK_SID_KEY = 'datify-sid';

// A visitor id that survives reloads. Private browsing or a blocked
// localStorage just means this session counts as new — never an error.
function trackSessionId() {
  try {
    let sid = localStorage.getItem(TRACK_SID_KEY);
    if (!sid) {
      sid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem(TRACK_SID_KEY, sid);
    }
    return sid;
  } catch (err) {
    return null;
  }
}

// Fire and forget. Analytics must never break the page, so every failure
// path here is a silent no-op: a failed insert, an offline phone, a missing
// client, an ad blocker. Nothing awaits this and nothing reads its result.
function track(name, opts = {}) {
  try {
    if (typeof db === 'undefined' || !db) return;
    if (navigator.webdriver) return;        // headless browser, not a person

    const row = {
      name,
      deal_id:    opts.dealId  || null,
      session_id: trackSessionId(),
      path:       opts.path    || null,
      props:      opts.props   || null
    };

    // .then() rather than await: the caller carries on immediately, and a
    // rejected insert dies here instead of surfacing as an unhandled error.
    db.from('events').insert(row).then(() => {}, () => {});
  } catch (err) {
    /* never let logging take the page down */
  }
}
