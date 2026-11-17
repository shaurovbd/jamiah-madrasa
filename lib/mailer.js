'use strict';

/**
 * Outgoing mail for admission notifications.
 *
 * Two messages are sent from here:
 *   1. notifyNewApplication() - tells the admission office a form came in.
 *   2. notifyApproved()       - tells the applicant they were admitted.
 *
 * By default mail goes through the local mail server on this cPanel account
 * (localhost:25), which needs no password. To authenticate as the mailbox
 * instead, set SMTP_HOST, SMTP_USER and SMTP_PASS in .env and that is used
 * automatically.
 *
 * Nothing in this file is allowed to throw: a mail problem must never stop an
 * application from being saved or a student from being admitted.
 */

const nodemailer = require('nodemailer');

const NOTIFY_TO = process.env.ADMISSION_NOTIFY_TO || 'admission@jamiahscholarsint.com';
const FROM = process.env.MAIL_FROM || 'Jamiah Scholars International <admission@jamiahscholarsint.com>';
const SITE_URL = String(process.env.SITE_URL || 'https://jamiahscholarsinternational.com').replace(/\/+$/, '');

let transport = null;

function getTransport() {
  if (transport) return transport;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Shared cPanel servers often present a certificate for the server
      // hostname rather than mail.<domain>. Set SMTP_TLS_STRICT=1 to enforce.
      tls: { rejectUnauthorized: process.env.SMTP_TLS_STRICT === '1' }
    });
  } else {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: Number(process.env.SMTP_PORT || 25),
      secure: false,
      ignoreTLS: true
    });
  }

  return transport;
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

function row(label, value) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  return '<tr>' +
    '<td style="padding:6px 14px 6px 0;color:#666;vertical-align:top;white-space:nowrap">' + esc(label) + '</td>' +
    '<td style="padding:6px 0;color:#111;vertical-align:top"><strong>' + esc(value) + '</strong></td>' +
    '</tr>';
}

function wrap(heading, introHtml, tableRows, footerHtml) {
  return '<div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.7;color:#111;max-width:620px">' +
    '<h2 style="margin:0 0 14px;font-size:19px;color:#0b5d3b">' + esc(heading) + '</h2>' +
    (introHtml || '') +
    (tableRows ? '<table cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid #e3e3e3;border-bottom:1px solid #e3e3e3;width:100%">' + tableRows + '</table>' : '') +
    (footerHtml || '') +
    '<p style="margin:22px 0 0;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:12px">' +
    'জামিয়া স্কলার্স ইন্টারন্যাশনাল &middot; Jamiah Scholars International<br>' +
    '<a href="' + esc(SITE_URL) + '" style="color:#0b5d3b">' + esc(SITE_URL.replace(/^https?:\/\//, '')) + '</a>' +
    '</p></div>';
}

function toText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|h2|div)>/gi, '\n')
    .replace(/<td[^>]*>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&middot;/g, '-')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function send(opts) {
  const to = String(opts.to || '').trim();
  if (!to) return false;
  try {
    const message = {
      from: FROM,
      to: to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text || toText(opts.html)
    };
    if (opts.replyTo) message.replyTo = opts.replyTo;
    const info = await getTransport().sendMail(message);
    console.log('[mail] sent "' + opts.subject + '" to ' + to + (info && info.messageId ? ' (' + info.messageId + ')' : ''));
    return true;
  } catch (err) {
    console.error('[mail] FAILED "' + opts.subject + '" to ' + to + ': ' + (err && err.message ? err.message : err));
    return false;
  }
}

/**
 * Sent to the admission office as soon as a public application is submitted.
 * `a` carries whatever the form gave us; every field is optional except the
 * application number and the applicant's name.
 */
async function notifyNewApplication(a) {
  a = a || {};

  const rows =
    row('আবেদন নম্বর / Application no', a.applicationNo) +
    row('শিক্ষার্থীর নাম / Name', a.name) +
    row('ইংরেজি নাম / Name (EN)', a.nameEn) +
    row('পিতার নাম / Father', a.fatherName) +
    row('মোবাইল / Phone', a.phone) +
    row('ইমেইল / Email', a.email) +
    row('কাঙ্ক্ষিত ক্লাস / Target class', a.targetClass) +
    row('বিভাগ / Department', a.department) +
    row('ক্যাম্পাস / Campus', a.campus) +
    row('জমা হয়েছে / Submitted', new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }) + ' (Dhaka)');

  const html = wrap(
    'নতুন ভর্তি আবেদন / New admission application',
    '<p style="margin:0">ওয়েবসাইট থেকে একটি নতুন ভর্তি আবেদন জমা পড়েছে।<br>' +
    '<span style="color:#555">A new admission application has been submitted from the website.</span></p>',
    rows,
    '<p style="margin:0"><a href="' + esc(SITE_URL) + '/admin/admissions" ' +
    'style="display:inline-block;background:#0b5d3b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:5px">' +
    'আবেদনটি দেখুন / Review application</a></p>'
  );

  return send({
    to: NOTIFY_TO,
    subject: 'নতুন ভর্তি আবেদন / New application - ' + (a.applicationNo || '') + ' - ' + (a.name || ''),
    html: html,
    replyTo: isEmail(a.email) ? String(a.email).trim() : undefined
  });
}

/**
 * Sent to the applicant once an admin approves them in the dashboard.
 * Returns false (quietly) when the applicant left no email address.
 */
async function notifyApproved(a) {
  a = a || {};
  if (!isEmail(a.email)) return false;

  const rows =
    row('আবেদন নম্বর / Application no', a.applicationNo) +
    row('ভর্তি নম্বর / Admission no', a.admissionNo) +
    row('শিক্ষার্থীর নাম / Name', a.name) +
    row('ক্লাস / Class', a.className) +
    row('বিভাগ / Department', a.department);

  const html = wrap(
    'অভিনন্দন! আপনার ভর্তি অনুমোদিত হয়েছে',
    '<p style="margin:0">প্রিয় ' + esc(a.name || 'শিক্ষার্থী') + ',<br>' +
    'জামিয়া স্কলার্স ইন্টারন্যাশনাল-এ আপনার ভর্তির আবেদন <strong>অনুমোদিত</strong> হয়েছে। নিচে আপনার ভর্তি সংক্রান্ত তথ্য দেওয়া হলো।</p>' +
    '<p style="margin:12px 0 0;color:#555">Dear ' + esc(a.name || 'applicant') + ', your application to Jamiah Scholars International has been <strong>approved</strong>. Your admission details are below.</p>',
    rows,
    '<p style="margin:0">পরবর্তী পদক্ষেপের জন্য অনুগ্রহ করে ভর্তি অফিসে যোগাযোগ করুন এবং এই ভর্তি নম্বরটি সংরক্ষণ করুন।<br>' +
    '<span style="color:#555">Please contact the admission office for the next steps, and keep your admission number safe.</span></p>'
  );

  return send({
    to: String(a.email).trim(),
    subject: 'ভর্তি অনুমোদিত / Admission approved - ' + (a.admissionNo || a.applicationNo || ''),
    html: html,
    replyTo: NOTIFY_TO
  });
}

module.exports = {
  send: send,
  notifyNewApplication: notifyNewApplication,
  notifyApproved: notifyApproved,
  NOTIFY_TO: NOTIFY_TO
};
