'use strict';
/**
 * Guardian portal — office side (/admin/portal).
 *
 * Gives guardians their sign-in PIN. A PIN is shown in clear exactly once,
 * on the page right after it is made (to print as slips), and can go out by
 * SMS at the same moment; only its hash is stored. Making a new PIN replaces
 * the old one. Removing access deletes the account; the students are untouched.
 */
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');
const g = require('../../lib/guardians');
const sms = require('../../lib/sms');
const settingsLib = require('../../lib/settings');

const router = express.Router();

const DEFAULT_SMS = 'আসসালামু আলাইকুম। {school} অভিভাবক পোর্টাল: {link} — মোবাইল: {phone}, PIN: {pin}। PIN কাউকে জানাবেন না।';

async function portalLink(req) {
  return `${req.protocol}://${req.get('host')}/parent`;
}

/** Guardian numbers in scope -> Map(phone -> [student names]). */
async function guardiansIn(scope) {
  let rows;
  if (scope.phone) {
    const phone = g.normalizePhone(scope.phone);
    if (!phone) return { map: new Map(), bad: 1 };
    const kids = await g.childrenOf(phone);
    return { map: new Map(kids.length ? [[phone, kids.map((k) => k.name)]] : []), bad: 0 };
  }
  if (scope.class_id) rows = await db.query("SELECT name, guardian_phone FROM students WHERE status = 'active' AND class_id = ?", [scope.class_id]);
  else rows = await db.query("SELECT name, guardian_phone FROM students WHERE status = 'active'");
  const map = new Map();
  let bad = 0;
  rows.forEach((r) => {
    const p = g.normalizePhone(r.guardian_phone);
    if (!p) { bad++; return; }
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(r.name);
  });
  return { map, bad };
}

router.get('/', async (req, res, next) => {
  try {
    const [classes, accounts, recent, all] = await Promise.all([
      db.query('SELECT id, name FROM classes ORDER BY department_id, level, id'),
      db.query('SELECT phone FROM guardian_accounts').catch((e) => { if (e.code === 'ER_NO_SUCH_TABLE') return null; throw e; }),
      db.query('SELECT phone, last_login FROM guardian_accounts WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 8').catch(() => []),
      guardiansIn({})
    ]);
    const has = new Set((accounts || []).map((a) => a.phone));
    const withPin = [...all.map.keys()].filter((p) => has.has(p)).length;
    res.render('admin/portal/index', {
      title: res.locals.t('admin.nav.portal'), classes, link: await portalLink(req), tableMissing: accounts === null,
      stats: { guardians: all.map.size, withPin, without: all.map.size - withPin, badPhones: all.bad, logins: recent.length },
      recent, prefillPhone: String(req.query.phone || ''), defaultSms: DEFAULT_SMS, result: null
    });
  } catch (err) { next(err); }
});

router.post('/generate', async (req, res, next) => {
  try {
    const scope = { class_id: h.toInt(req.body.class_id), phone: String(req.body.phone || '').trim() };
    const onlyNew = req.body.mode !== 'reset';
    const sendSms = Boolean(req.body.send_sms);
    const { map } = await guardiansIn(scope);
    if (!map.size) { req.flash('error', 'f.portal.none'); return res.redirect('/admin/portal'); }

    const existing = new Set((await db.query('SELECT phone FROM guardian_accounts')).map((a) => a.phone));
    const slips = [];
    for (const [phone, kids] of map) {
      if (onlyNew && existing.has(phone) && !scope.phone) continue; // a single number is always reset
      const pin = await g.setPin(phone, req.session.user.id);
      slips.push({ phone, local: '0' + phone.slice(3), kids, pin });
    }
    if (!slips.length) { req.flash('info', 'f.portal.all_have'); return res.redirect('/admin/portal'); }

    const link = await portalLink(req);
    let queued = 0;
    if (sendSms) {
      const s = await settingsLib.all();
      const tpl = String(req.body.sms_text || DEFAULT_SMS).slice(0, 600);
      const r = await sms.queue({
        kind: 'portal', title: res.locals.t('a.portal.sms_title'), userId: req.session.user.id,
        recipients: slips.map((sl) => ({ phone: sl.phone, name: sl.kids.join(', '),
          message: sms.fill(tpl, { school: s.site_short || s.site_name || '', link, phone: sl.local, pin: sl.pin, name: sl.kids.join(', ') }) }))
      });
      queued = r.queued;
    }
    const cfg = await sms.config();
    res.render('admin/portal/index', {
      title: res.locals.t('admin.nav.portal'), classes: [], link, tableMissing: false, stats: null, recent: [],
      prefillPhone: '', defaultSms: DEFAULT_SMS,
      result: { slips, queued, testMode: cfg.provider === 'test' }
    });
  } catch (err) { next(err); }
});

router.post('/remove', async (req, res, next) => {
  try {
    const phone = g.normalizePhone(req.body.phone);
    if (phone) await db.run('DELETE FROM guardian_accounts WHERE phone = ?', [phone]);
    req.flash('success', i18n.pack('f.portal.removed', { phone: req.body.phone }));
    res.redirect('/admin/portal');
  } catch (err) { next(err); }
});

module.exports = router;
