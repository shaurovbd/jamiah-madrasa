'use strict';
/**
 * Google Map embedding.
 *
 * The client is never asked to write HTML: whatever they paste into the
 * Settings box is turned into one safe URL here, and the template builds the
 * iframe itself. Nothing from the box is ever rendered as markup.
 */

function isGoogleHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'google.com' || h.endsWith('.google.com');
}

/**
 * Accepts the embed code copied from Google Maps (Share -> Embed a map),
 * an embed URL, or simply an address. Returns a https URL, or null if the
 * value cannot be turned into a map.
 */
function embedUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // The full <iframe ...> embed code: take its src and ignore everything else.
  let candidate = raw;
  const iframe = raw.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  if (iframe) {
    candidate = iframe[1].trim();
  } else if (raw.includes('<')) {
    return null; // markup we do not recognise; never pass it through
  }

  if (/^https?:\/\//i.test(candidate)) {
    let u;
    try { u = new URL(candidate); } catch (err) { return null; }
    if (!isGoogleHost(u.hostname)) return null;
    u.protocol = 'https:';
    if (u.pathname.startsWith('/maps/embed')) return u.toString();
    if (u.pathname.startsWith('/maps')) {
      u.searchParams.set('output', 'embed');
      return u.toString();
    }
    return null;
  }

  // Plain text: let Google look the address up.
  return `https://www.google.com/maps?q=${encodeURIComponent(candidate)}&output=embed`;
}

module.exports = { embedUrl };
