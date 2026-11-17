'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const rooms = await db.query(
      `SELECT r.*, (SELECT COUNT(*) FROM hostel_allocations a WHERE a.room_id = r.id AND a.status = 'active') AS occupied
         FROM hostel_rooms r ORDER BY r.block, r.room_no`
    );
    const allocations = await db.query(
      `SELECT a.*, r.room_no, r.block, s.name AS student, s.admission_no, c.name AS class_name
         FROM hostel_allocations a
         JOIN hostel_rooms r ON r.id = a.room_id
         JOIN students s ON s.id = a.student_id
         LEFT JOIN classes c ON c.id = s.class_id
        WHERE a.status = 'active' ORDER BY r.block, r.room_no, s.name`
    );
    const unassigned = await db.query(
      `SELECT s.id, s.name, s.admission_no FROM students s
        WHERE s.status = 'active' AND s.is_resident = 1
          AND NOT EXISTS (SELECT 1 FROM hostel_allocations a WHERE a.student_id = s.id AND a.status = 'active')
        ORDER BY s.name`
    );
    const editRoom = h.toInt(req.query.edit)
      ? await db.one('SELECT * FROM hostel_rooms WHERE id = ?', [h.toInt(req.query.edit)]) : null;

    const capacity = rooms.reduce((s, r) => s + Number(r.capacity), 0);
    const occupied = rooms.reduce((s, r) => s + Number(r.occupied), 0);

    res.render('admin/hostel/index', {
      title: 'Hostel', rooms, allocations, unassigned, editRoom,
      stats: { capacity, occupied, free: capacity - occupied, unassigned: unassigned.length }
    });
  } catch (err) { next(err); }
});

router.post('/rooms', async (req, res, next) => {
  try {
    const roomNo = String(req.body.room_no || '').trim();
    if (!roomNo) { req.flash('error', 'Room number is required.'); return res.redirect('/admin/hostel'); }
    const id = h.toInt(req.body.id);
    const vals = [roomNo, h.orNull(req.body.block), Math.max(1, h.toNum(req.body.capacity, 4)),
                  h.toNum(req.body.monthly_fee, 0), h.orNull(req.body.notes)];
    if (id) {
      await db.run('UPDATE hostel_rooms SET room_no=?, block=?, capacity=?, monthly_fee=?, notes=? WHERE id=?', [...vals, id]);
      req.flash('success', 'Room updated.');
    } else {
      const dup = await db.one('SELECT id FROM hostel_rooms WHERE room_no = ?', [roomNo]);
      if (dup) { req.flash('error', `Room ${roomNo} already exists.`); return res.redirect('/admin/hostel'); }
      await db.run('INSERT INTO hostel_rooms (room_no, block, capacity, monthly_fee, notes) VALUES (?,?,?,?,?)', vals);
      req.flash('success', 'Room added.');
    }
    res.redirect('/admin/hostel');
  } catch (err) { next(err); }
});

router.delete('/rooms/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM hostel_rooms WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'Room deleted together with its allocations.');
    res.redirect('/admin/hostel');
  } catch (err) { next(err); }
});

router.post('/allocate', async (req, res, next) => {
  try {
    const roomId = h.toInt(req.body.room_id);
    const studentId = h.toInt(req.body.student_id);
    if (!roomId || !studentId) { req.flash('error', 'Choose a room and a student.'); return res.redirect('/admin/hostel'); }

    const room = await db.one(
      `SELECT r.*, (SELECT COUNT(*) FROM hostel_allocations a WHERE a.room_id = r.id AND a.status = 'active') AS occupied
         FROM hostel_rooms r WHERE r.id = ?`, [roomId]
    );
    if (!room) return next();
    if (Number(room.occupied) >= Number(room.capacity)) {
      req.flash('error', `Room ${room.room_no} is full.`);
      return res.redirect('/admin/hostel');
    }
    const already = await db.one("SELECT id FROM hostel_allocations WHERE student_id = ? AND status = 'active'", [studentId]);
    if (already) { req.flash('error', 'That student already has an active room allocation.'); return res.redirect('/admin/hostel'); }

    await db.transaction(async (conn) => {
      await conn.execute('INSERT INTO hostel_allocations (room_id, student_id, allocated_on) VALUES (?,?,?)',
        [roomId, studentId, h.orNull(req.body.allocated_on) || h.today()]);
      await conn.execute('UPDATE students SET is_resident = 1 WHERE id = ?', [studentId]);
    });
    req.flash('success', `Student allocated to room ${room.room_no}.`);
    res.redirect('/admin/hostel');
  } catch (err) { next(err); }
});

router.post('/allocations/:id/vacate', async (req, res, next) => {
  try {
    await db.run("UPDATE hostel_allocations SET status = 'vacated', vacated_on = ? WHERE id = ?",
      [h.today(), h.toInt(req.params.id)]);
    req.flash('success', 'Room vacated.');
    res.redirect('/admin/hostel');
  } catch (err) { next(err); }
});

module.exports = router;
