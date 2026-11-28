/* eslint-disable */
(function (root, factory) {
  'use strict';
  // একই ফাইল দুই জায়গায় চলে: Node-এ require(), ব্রাউজারে window.BanglaNumber
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BanglaNumber = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/**
 * বাংলা সংখ্যা — অঙ্ক থেকে কথা (কোটি-লাখ-হাজার-শত পদ্ধতি)
 * রশিদে "টাকা কথায়" লেখার জন্য।
 *
 * বাংলায় ০–৯৯ এর নাম নিয়মিতভাবে গড়া যায় না (৪৫ = পঁয়তাল্লিশ, ৫২ = বায়ান্ন),
 * তাই পুরো তালিকাই হাতে লেখা — এটাই একমাত্র নির্ভরযোগ্য উপায়।
 */

const UNDER_100 = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ',
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'উনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'উনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'উনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'উনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'উনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'উনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'উননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/** ইংরেজি অঙ্ককে বাংলা অঙ্কে — '1,250.50' → '১,২৫০.৫০' */
function toBanglaDigits(input) {
  return String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** পূর্ণসংখ্যা থেকে কথা। ঋণাত্মক হলে সামনে 'ঋণাত্মক'। */
function numberToWords(n) {
  n = Math.trunc(Number(n) || 0);
  if (n < 0) return 'ঋণাত্মক ' + numberToWords(-n);
  if (n < 100) return UNDER_100[n];

  // শত: 'পাঁচশত' — ফাঁক ছাড়া, বাংলায় এটাই স্বাভাবিক
  if (n < 1000) return join(UNDER_100[Math.floor(n / 100)] + 'শত', n % 100);
  if (n < 100000) return join(numberToWords(Math.floor(n / 1000)) + ' হাজার', n % 1000);
  if (n < 10000000) return join(numberToWords(Math.floor(n / 100000)) + ' লাখ', n % 100000);
  // ১০০ কোটির ওপরেও বাংলায় 'কোটি' ই চলে — তাই কোটির অংশটিও একই নিয়মে
  return join(numberToWords(Math.floor(n / 10000000)) + ' কোটি', n % 10000000);
}

function join(head, rest) {
  return rest ? head + ' ' + numberToWords(rest) : head;
}

/**
 * টাকার পরিমাণ কথায়।
 *   45000      → 'পঁয়তাল্লিশ হাজার টাকা মাত্র'
 *   1500.50    → 'এক হাজার পাঁচশত টাকা ও পঞ্চাশ পয়সা মাত্র'
 * ফ্লোটিং পয়েন্ট ভুল এড়াতে ভেতরে পয়সায় গোনা হয়।
 */
function takaInWords(amount, opts) {
  const o = opts || {};
  const suffix = o.suffix === undefined ? ' মাত্র' : o.suffix;
  const totalPaisa = Math.round(Number(amount || 0) * 100);
  const neg = totalPaisa < 0;
  const abs = Math.abs(totalPaisa);
  const taka = Math.floor(abs / 100);
  const paisa = abs % 100;

  let out = numberToWords(taka) + ' টাকা';
  if (paisa) out += ' ও ' + numberToWords(paisa) + ' পয়সা';
  out += suffix;
  return (neg ? 'ঋণাত্মক ' : '') + out;
}

/** 'Tk 1,250.50' ধাঁচে — অঙ্কে */
function formatTaka(amount, opts) {
  const o = opts || {};
  const s = Number(amount || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = o.bangla ? toBanglaDigits(s) : s;
  return (o.symbol === undefined ? 'Tk ' : o.symbol) + num;
}

  return { numberToWords, takaInWords, toBanglaDigits, formatTaka, UNDER_100 };
});
