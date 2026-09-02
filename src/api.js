'use strict';

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { safeUser } = require('./auth');
const { parseWorkbook, exportWorkbook } = require('./excel');

const ROLES = ['responsible', 'manager', 'admin'];
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

function membership(user, objectId) { return user.memberships.find((item) => item.objectId === objectId); }
function hasRole(user, objectId, roles) { return Boolean(membership(user, objectId) && roles.includes(membership(user, objectId).role)); }
function canAdmin(user) { return !user.memberships.length || user.memberships.some((item) => item.role === 'admin'); }
function cleanName(value) { return String(value || '').trim().slice(0, 180); }
function fail(res, status, error) { return res.status(status).json({ error }); }

function apiRouter(store) {
  const router = express.Router();
  router.get('/bootstrap', (req, res) => {
    const allowed = new Set(req.user.memberships.map((item) => item.objectId));
    res.json({ user: safeUser(req.user), objects: store.data.objects.filter((item) => allowed.has(item.id)), contractors: store.data.contractors.filter((item) => item.objectIds.some((id) => allowed.has(id))) });
  });

  router.get('/objects', (req, res) => res.json(store.data.objects.filter((item) => membership(req.user, item.id))));
  router.post('/objects', (req, res) => {
    if (!canAdmin(req.user)) return fail(res, 403, 'Недостаточно прав');
    const name = cleanName(req.body.name); if (!name) return fail(res, 400, 'Укажите название объекта');
    const object = { id: store.id(), name, address: cleanName(req.body.address), createdAt: new Date().toISOString() };
    store.data.objects.push(object); req.user.memberships.push({ objectId: object.id, role: 'admin', contractorId: null }); store.persist(); res.status(201).json(object);
  });
  router.put('/objects/:id', (req, res) => {
    if (!hasRole(req.user, req.params.id, ['admin'])) return fail(res, 403, 'Недостаточно прав');
    const object = store.data.objects.find((item) => item.id === req.params.id); if (!object) return fail(res, 404, 'Объект не найден');
    object.name = cleanName(req.body.name) || object.name; object.address = cleanName(req.body.address); store.persist(); res.json(object);
  });

  router.get('/users', (req, res) => {
    const objectId = req.query.objectId; if (!hasRole(req.user, objectId, ['admin'])) return fail(res, 403, 'Недостаточно прав');
    res.json(store.data.users.filter((user) => membership(user, objectId)).map(safeUser));
  });
  router.post('/users', (req, res) => {
    const objectId = req.body.objectId; if (!hasRole(req.user, objectId, ['admin'])) return fail(res, 403, 'Недостаточно прав');
    const role = ROLES.includes(req.body.role) ? req.body.role : 'responsible'; const login = cleanName(req.body.login);
    if (!cleanName(req.body.name) || !login || String(req.body.password || '').length < 3) return fail(res, 400, 'Заполните ФИО, логин и пароль (минимум 3 символа)');
    if (store.data.users.some((item) => item.login.toLowerCase() === login.toLowerCase())) return fail(res, 409, 'Такой логин уже занят');
    const user = { id: store.id(), name: cleanName(req.body.name), login, passwordHash: bcrypt.hashSync(String(req.body.password), 12), telegramId: cleanName(req.body.telegramId), memberships: [{ objectId, role, contractorId: req.body.contractorId || null }], createdAt: new Date().toISOString() };
    store.data.users.push(user); store.persist(); res.status(201).json(safeUser(user));
  });
  router.put('/users/:id/access', (req, res) => {
    if (!hasRole(req.user, req.body.objectId, ['admin'])) return fail(res, 403, 'Недостаточно прав');
    const user = store.findUser(req.params.id); if (!user) return fail(res, 404, 'Пользователь не найден');
    const member = membership(user, req.body.objectId); const access = { objectId: req.body.objectId, role: ROLES.includes(req.body.role) ? req.body.role : 'responsible', contractorId: req.body.contractorId || null };
    if (member) Object.assign(member, access); else user.memberships.push(access); store.persist(); res.json(safeUser(user));
  });

  router.get('/contractors', (req, res) => {
    if (!membership(req.user, req.query.objectId)) return fail(res, 403, 'Нет доступа к объекту');
    res.json(store.data.contractors.filter((item) => item.objectIds.includes(req.query.objectId)));
  });
  router.post('/contractors', (req, res) => {
    const objectId = req.body.objectId; if (!hasRole(req.user, objectId, ['admin'])) return fail(res, 403, 'Недостаточно прав');
    const fullName = cleanName(req.body.fullName); if (!fullName) return fail(res, 400, 'Укажите подрядчика');
    let contractor = store.data.contractors.find((item) => item.fullName.toLowerCase() === fullName.toLowerCase());
    if (contractor) { if (!contractor.objectIds.includes(objectId)) contractor.objectIds.push(objectId); }
    else { contractor = { id: store.id(), fullName, shortName: cleanName(req.body.shortName) || fullName, objectIds: [objectId] }; store.data.contractors.push(contractor); }
    store.persist(); res.status(201).json(contractor);
  });

  router.get('/schedules', (req, res) => {
    if (!membership(req.user, req.query.objectId)) return fail(res, 403, 'Нет доступа к объекту');
    res.json(store.data.schedules.filter((item) => item.objectId === req.query.objectId).map(({ originalPath, ...item }) => item));
  });
  router.post('/schedules', upload.single('file'), async (req, res) => {
    const objectId = req.body.objectId; if (!hasRole(req.user, objectId, ['manager', 'admin'])) return fail(res, 403, 'Недостаточно прав');
    if (!req.file) return fail(res, 400, 'Выберите Excel-файл');
    const year = Number(req.body.year); const month = Number(req.body.month); if (month < 1 || month > 12 || year < 2020) return fail(res, 400, 'Некорректный месяц');
    const id = store.id(); const originalPath = path.join(store.root, 'uploads', `${id}.xlsx`); fs.writeFileSync(originalPath, req.file.buffer);
    try {
      const parsed = await parseWorkbook(originalPath, year, month, (name) => {
        let contractor = store.data.contractors.find((item) => item.fullName.toLowerCase() === name.toLowerCase());
        if (!contractor) { contractor = { id: store.id(), fullName: name, shortName: name, objectIds: [objectId] }; store.data.contractors.push(contractor); }
        else if (!contractor.objectIds.includes(objectId)) contractor.objectIds.push(objectId);
        return contractor.id;
      });
      const versions = store.data.schedules.filter((item) => item.objectId === objectId && item.year === year && item.month === month);
      versions.forEach((item) => { item.active = false; });
      const schedule = { id, objectId, year, month, version: versions.length + 1, active: true, uploadedAt: new Date().toISOString(), uploadedBy: req.user.id, originalName: req.file.originalname, originalPath, ...parsed };
      store.data.schedules.push(schedule); store.persist(); res.status(201).json({ ...schedule, originalPath: undefined });
    } catch (error) { fs.rmSync(originalPath, { force: true }); return fail(res, 400, error.message); }
  });
  router.post('/schedules/:id/activate', (req, res) => {
    const schedule = store.data.schedules.find((item) => item.id === req.params.id); if (!schedule || !hasRole(req.user, schedule.objectId, ['manager', 'admin'])) return fail(res, 403, 'Недостаточно прав');
    store.data.schedules.filter((item) => item.objectId === schedule.objectId && item.year === schedule.year && item.month === schedule.month).forEach((item) => { item.active = item.id === schedule.id; }); store.persist(); res.json({ ok: true });
  });
  router.get('/schedules/:id/json', (req, res) => {
    const schedule = store.data.schedules.find((item) => item.id === req.params.id); if (!schedule || !membership(req.user, schedule.objectId)) return fail(res, 404, 'График не найден');
    res.setHeader('Content-Disposition', `attachment; filename="schedule-${schedule.year}-${schedule.month}.json"`); res.json(schedule);
  });
  router.get('/schedules/:id/original', (req, res) => {
    const schedule = store.data.schedules.find((item) => item.id === req.params.id); if (!schedule || !hasRole(req.user, schedule.objectId, ['manager', 'admin'])) return fail(res, 404, 'График не найден'); res.download(schedule.originalPath, schedule.originalName);
  });
  router.get('/schedules/:id/export', async (req, res) => {
    const schedule = store.data.schedules.find((item) => item.id === req.params.id); if (!schedule || !hasRole(req.user, schedule.objectId, ['manager', 'admin'])) return fail(res, 404, 'График не найден');
    const output = path.join(store.root, 'uploads', `result-${store.id()}.xlsx`); await exportWorkbook(schedule, schedule.originalPath, output, store.data.reports); res.download(output, `План-факт-${schedule.year}-${String(schedule.month).padStart(2, '0')}.xlsx`, () => fs.rmSync(output, { force: true }));
  });

  router.get('/works', (req, res) => {
    const objectId = req.query.objectId; const member = membership(req.user, objectId); if (!member) return fail(res, 403, 'Нет доступа к объекту');
    const now = req.query.month ? new Date(`${req.query.month}-01T00:00:00Z`) : new Date(); const schedule = store.data.schedules.find((item) => item.objectId === objectId && item.active && item.year === now.getUTCFullYear() && item.month === now.getUTCMonth() + 1);
    let works = schedule?.works || []; if (member.role === 'responsible') works = works.filter((item) => item.contractorId === member.contractorId).map(({ plans, factCells, total, ...item }) => item);
    res.json({ scheduleId: schedule?.id, works });
  });

  router.post('/reports', upload.array('photos', 8), (req, res) => {
    let payload; try { payload = JSON.parse(req.body.payload || '{}'); } catch { return fail(res, 400, 'Некорректный отчёт'); }
    const member = membership(req.user, payload.objectId); if (!member) return fail(res, 403, 'Нет доступа к объекту');
    const contractorId = member.role === 'responsible' ? member.contractorId : payload.contractorId; if (!contractorId) return fail(res, 400, 'Выберите подрядчика');
    const date = String(payload.date || '').slice(0, 10); const point = new Date(`${date}T12:00:00Z`); const schedule = store.data.schedules.find((item) => item.objectId === payload.objectId && item.active && item.year === point.getUTCFullYear() && item.month === point.getUTCMonth() + 1);
    if (!schedule) return fail(res, 400, 'На этот месяц нет активного графика');
    const works = (payload.works || []).map((item) => ({ workId: item.workId, quantity: Number(item.quantity) })).filter((item) => item.quantity > 0);
    if (!works.length) return fail(res, 400, 'Добавьте выполненную работу');
    for (const item of works) {
      const work = schedule.works.find((entry) => entry.id === item.workId && entry.contractorId === contractorId); if (!work) return fail(res, 400, 'Работа не относится к выбранному подрядчику');
      const done = store.data.reports.flatMap((report) => report.works).filter((entry) => entry.workId === work.id).reduce((sum, entry) => sum + Number(entry.quantity), 0);
      if (item.quantity > work.total - done + 1e-9) return fail(res, 409, `По работе «${work.name}» осталось ${Math.max(0, work.total - done)}`);
    }
    const photos = (req.files || []).map((file) => { const name = `${store.id()}${path.extname(file.originalname).slice(0, 8)}`; fs.writeFileSync(path.join(store.root, 'photos', name), file.buffer); return name; });
    const rows = (items) => (items || []).map((item) => ({ name: cleanName(item.name), quantity: Math.max(0, Number(item.quantity) || 0) })).filter((item) => item.name && item.quantity > 0);
    const report = { id: store.id(), date, objectId: payload.objectId, contractorId, userId: req.user.id, works, people: rows(payload.people), equipment: rows(payload.equipment), photos, comment: cleanName(payload.comment), submittedAt: new Date().toISOString() };
    store.data.reports.push(report); store.persist(); res.status(201).json(report);
  });
  router.get('/reports', (req, res) => {
    const member = membership(req.user, req.query.objectId); if (!member) return fail(res, 403, 'Нет доступа к объекту');
    let reports = store.data.reports.filter((item) => item.objectId === req.query.objectId && (!req.query.from || item.date >= req.query.from) && (!req.query.to || item.date <= req.query.to));
    if (member.role === 'responsible') reports = reports.filter((item) => item.userId === req.user.id); res.json(reports);
  });
  router.get('/photos/:name', (req, res) => {
    const report = store.data.reports.find((item) => item.photos.includes(req.params.name)); if (!report || !membership(req.user, report.objectId)) return fail(res, 404, 'Фото не найдено'); res.sendFile(path.join(store.root, 'photos', path.basename(req.params.name)));
  });

  router.get('/analytics', (req, res) => {
    const objectId = req.query.objectId; if (!hasRole(req.user, objectId, ['manager', 'admin'])) return fail(res, 403, 'Недостаточно прав');
    const from = req.query.from || '0000-01-01'; const to = req.query.to || '9999-12-31'; const schedules = store.data.schedules.filter((item) => item.objectId === objectId && item.active); const reports = store.data.reports.filter((item) => item.objectId === objectId && item.date >= from && item.date <= to);
    const rows = schedules.flatMap((schedule) => schedule.works).map((work) => {
      const plan = Object.entries(work.plans).filter(([date]) => date >= from && date <= to).reduce((sum, [, value]) => sum + Number(value), 0);
      const fact = reports.flatMap((report) => report.works).filter((item) => item.workId === work.id).reduce((sum, item) => sum + Number(item.quantity), 0);
      return { workId: work.id, name: work.name, contractorId: work.contractorId, plan, fact, percent: plan ? fact / plan * 100 : null, deviation: fact - plan };
    });
    const resources = reports.map((report) => ({ date: report.date, contractorId: report.contractorId, people: report.people.reduce((s, x) => s + x.quantity, 0), equipment: report.equipment.reduce((s, x) => s + x.quantity, 0) })); res.json({ rows, resources });
  });
  router.get('/milestones', (req, res) => { if (!membership(req.user, req.query.objectId)) return fail(res, 403, 'Нет доступа'); res.json(store.data.milestones.filter((item) => item.objectId === req.query.objectId)); });
  router.post('/milestones', (req, res) => { if (!hasRole(req.user, req.body.objectId, ['manager', 'admin'])) return fail(res, 403, 'Недостаточно прав'); const item = { id: store.id(), objectId: req.body.objectId, name: cleanName(req.body.name), date: String(req.body.date).slice(0, 10) }; store.data.milestones.push(item); store.persist(); res.status(201).json(item); });
  return router;
}

module.exports = { apiRouter, membership, hasRole };
