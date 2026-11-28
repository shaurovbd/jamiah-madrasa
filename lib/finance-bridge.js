'use strict';
/**
 * Post vouchers into the finance ledger (jamiah_finance) from other parts of
 * the panel — salaries and staff advances.
 *
 * Everything goes through the finance module's own VoucherService, so the
 * ledger's rules still hold: debit equals credit, the period must be open,
 * cash cannot go below zero, and a voucher above the user's level waits for
 * approval (status 'pending') instead of posting.
 */
const { pool: financePool } = require('../config/finance-db');
const { pool: mainPool } = require('../config/db');
const VoucherService = require('../jamiah-finance/voucher-service');
const { financeRoleFor } = require('./roles');

const CODES = { teacher: '5101', staff: '5102', advance: '1203' };

let svc = null;
function service() {
  if (!svc) {
    const S = VoucherService.VoucherService || VoucherService;
    svc = new S(financePool);
  }
  return svc;
}

async function accountIds() {
  const [rows] = await financePool.query('SELECT id, code FROM accounts WHERE code IN (?)', [Object.values(CODES)]);
  const byCode = {};
  rows.forEach((r) => { byCode[r.code] = r.id; });
  const [[fund]] = await financePool.query("SELECT id FROM funds WHERE code = 'GEN' LIMIT 1");
  return {
    teacher: byCode[CODES.teacher], staff: byCode[CODES.staff], advance: byCode[CODES.advance],
    fund: fund ? fund.id : null
  };
}

/** Accounts money can be paid from: cash, bank, mobile banking. */
async function cashAccounts() {
  const [rows] = await financePool.query(
    `SELECT id, code, name_bn, name_en FROM accounts
      WHERE is_cash_like = 1 AND is_postable = 1 AND is_active = 1 AND is_group = 0 ORDER BY sort_order, code`);
  return rows;
}

/** The ledger's actor for this signed-in user. */
async function actor(req) {
  const u = req.session.user;
  const [rows] = await mainPool.query('SELECT finance_role FROM users WHERE id = ? LIMIT 1', [u.id]).catch(() => [[]]);
  return { userId: u.id, role: financeRoleFor(u.role, rows[0] && rows[0].finance_role), ip: req.ip };
}

/**
 * Create a payment voucher (PV).
 * lines: [{ account_id, debit?, credit?, party_type?, party_id?, line_narration? }] — fund is added here.
 * -> { id, voucher_no, status }   throws VoucherError with .errors (Bangla messages) on refusal.
 */
async function paymentVoucher(req, { date, narration, lines, sourceModule, sourceRef, partyId }) {
  const ids = await accountIds();
  const payload = {
    voucher_type: 'PV',
    voucher_date: date,
    narration_bn: narration,
    payment_method: 'cash',
    source_module: sourceModule || 'payroll',
    source_ref_id: sourceRef || null,
    party_type: partyId ? 'staff' : null,
    party_id: partyId || null,
    lines: lines.map((l) => Object.assign({ fund_id: ids.fund, debit: 0, credit: 0 }, l))
  };
  return service().create(payload, await actor(req));
}

module.exports = { accountIds, cashAccounts, paymentVoucher, CODES };
