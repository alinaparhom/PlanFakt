'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { syncScheduleWorks } = require('./tools/schedule_sync');

const ROOT = __dirname;

// Локальные секреты читаются из .env до инициализации интеграций.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.PLAN_FACT_DATA_DIR ? path.resolve(process.env.PLAN_FACT_DATA_DIR) : path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const LEGACY_STORE_FILE = path.join(DATA_DIR, 'store.json');
const DATA_FILES = {
  meta: 'meta.json',
  projects: 'projects.json',
  organizations: 'organizations.json',
  users: 'users.json',
  telegramLinks: 'telegram-links.json',
  works: 'works.json',
  reports: 'reports.json',
  schedules: 'schedules.json',
  milestones: 'milestones.json',
  dictionaries: 'dictionaries.json',
  audit: 'audit.json'
};
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_SECRET = process.env.SESSION_SECRET || 'plan-fakt-local-development-secret';
const TELEGRAM_BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || 'OtchetFact_bot').replace(/^@/, '').trim();
const BMSU_SITE_ORIGINS = new Set(String(process.env.BMSU_SITE_ORIGINS || 'https://bimmax.pro')
  .split(',').map(value => value.trim()).filter(Boolean));
const PYTHON = process.env.PYTHON_PATH || 'C:\\Users\\root\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
const loginTickets = new Map();
const IMPORT_COLUMN_NAMES = ['number', 'code', 'name', 'organization', 'unit', 'total', 'priorActual', 'remaining', 'monthlyPlan', 'rowType', 'firstDay'];
const DEFAULT_IMPORT_MAPPING = {
  sheet: 'СМГ', dataStartRow: 3, hierarchyColumns: ['C', 'D', 'E'],
  columns: { number: 'A', code: 'B', name: 'F', organization: 'G', unit: 'I', total: 'J', priorActual: 'K', remaining: 'L', monthlyPlan: 'M', rowType: 'N', firstDay: 'O' },
  planRowValue: 'План', factRowOffset: 1
};

function runPython(args, timeout) {
  return spawnSync(PYTHON, ['-X', 'utf8', ...args], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  });
}

function normalizeImportMapping(value) {
  const input = value && typeof value === 'object' ? value : {};
  const inputColumns = input.columns && typeof input.columns === 'object' ? input.columns : {};
  const excelColumn = raw => {
    const column = String(raw ?? '').trim().toUpperCase();
    if (column && !/^[A-Z]{1,3}$/.test(column)) throw Object.assign(new Error(`Некорректная колонка: ${column}`), { status: 400 });
    return column;
  };
  const numberInRange = (raw, fallback, min, max) => {
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  };
  return {
    sheet: String(input.sheet ?? DEFAULT_IMPORT_MAPPING.sheet).trim().slice(0, 120) || DEFAULT_IMPORT_MAPPING.sheet,
    dataStartRow: numberInRange(input.dataStartRow, DEFAULT_IMPORT_MAPPING.dataStartRow, 1, 1048576),
    hierarchyColumns: (Array.isArray(input.hierarchyColumns) ? input.hierarchyColumns : DEFAULT_IMPORT_MAPPING.hierarchyColumns).slice(0, 20).map(excelColumn).filter(Boolean),
    columns: Object.fromEntries(IMPORT_COLUMN_NAMES.map(name => [name, excelColumn(Object.prototype.hasOwnProperty.call(inputColumns, name) ? inputColumns[name] : DEFAULT_IMPORT_MAPPING.columns[name])])),
    planRowValue: String(input.planRowValue ?? DEFAULT_IMPORT_MAPPING.planRowValue).trim().slice(0, 80) || DEFAULT_IMPORT_MAPPING.planRowValue,
    factRowOffset: numberInRange(input.factRowOffset, DEFAULT_IMPORT_MAPPING.factRowOffset, 0, 1000)
  };
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function isoNow() {
  return new Date().toISOString();
}

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}

function checkPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

function seedStore() {
  return {
    meta: { version: 3, createdAt: isoNow(), initializedFor: 'Пархоменко Алина Андреевна', storage: 'split-json' },
    projects: [{
      id: 'main', name: 'Объект 1', shortName: 'Объект 1', status: 'active', timezone: 'Europe/Moscow',
      customerOrganization: { fullName: 'ООО "БМСУ-4"', portalName: 'bmsu-4', portalPage: 'bmsu-4.php' }, contractorIds: []
    }],
    organizations: [],
    users: [{
      id: 'u_admin',
      name: 'Пархоменко Алина Андреевна',
      login: 'Пархоменко',
      passwordHash: passwordHash('286'),
      telegramId: '16370894',
      status: 'active',
      organization: { fullName: 'ООО "БМСУ-4"', customerOrganizationName: 'bmsu-4' },
      assignments: [{
        projectId: 'main', role: 'admin', organizationIds: [],
        organization: { fullName: 'ООО "БМСУ-4"', customerOrganizationName: 'bmsu-4' },
        customerOrganization: { fullName: 'ООО "БМСУ-4"', portalName: 'bmsu-4', portalPage: 'bmsu-4.php' }
      }]
    }],
    telegramLinks: [{ userId: 'u_admin', telegramId: '16370894', linkedAt: isoNow() }],
    works: [], reports: [], schedules: [], milestones: [],
    dictionaries: { professions: ['Монтажник', 'Сварщик', 'Арматурщик', 'Бетонщик', 'Разнорабочий'], equipment: ['Автокран', 'Экскаватор', 'Самосвал', 'Бетононасос'] },
    audit: [{ id: 'audit_initial_admin', userId: 'u_admin', projectId: 'main', action: 'user.create', at: isoNow(), oldValue: null, newValue: { name: 'Пархоменко Алина Андреевна', role: 'admin', source: 'initial-setup' } }]
  };
}

function seedStoreDemo() {
  const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  const plan = (values) => Object.fromEntries(days.map((date, i) => [date, values[i] || 0]));
  return {
    meta: { version: 1, createdAt: isoNow() },
    projects: [
      { id: 'depo', name: 'Строительство электродепо', shortName: 'DEPO', status: 'active', timezone: 'Europe/Moscow' },
      { id: 'dynamo', name: 'Реконструкция стадиона «Динамо»', shortName: 'Динамо', status: 'active', timezone: 'Europe/Moscow' },
      { id: 'fok', name: 'Физкультурно-оздоровительный комплекс', shortName: 'ФОК', status: 'archive', timezone: 'Europe/Moscow' }
    ],
    organizations: [
      { id: 'alpha', fullName: 'ООО «Строительно-монтажная компания Альфа»', shortName: 'ООО «Альфа»', status: 'active', projectIds: ['depo', 'dynamo'] },
      { id: 'beta', fullName: 'ООО «Инженерные системы Бета»', shortName: 'ООО «Бета»', status: 'active', projectIds: ['depo'] },
      { id: 'monolit', fullName: 'АО «Монолит Строй»', shortName: 'АО «Монолит»', status: 'active', projectIds: ['depo'] }
    ],
    users: [
      { id: 'u_admin', name: 'Анна Смирнова', login: 'admin', passwordHash: passwordHash('Admin2026!'), telegramId: '100000001', status: 'active', assignments: [{ projectId: 'depo', role: 'admin', organizationIds: [] }, { projectId: 'dynamo', role: 'admin', organizationIds: [] }] },
      { id: 'u_manager', name: 'Михаил Орлов', login: 'manager', passwordHash: passwordHash('Manager2026!'), telegramId: '100000002', status: 'active', assignments: [{ projectId: 'depo', role: 'manager', organizationIds: [] }] },
      { id: 'u_worker', name: 'Иван Петров', login: 'responsible', passwordHash: passwordHash('Report2026!'), telegramId: '100000003', status: 'active', assignments: [{ projectId: 'depo', role: 'responsible', organizationIds: ['alpha'] }] }
    ],
    telegramLinks: [
      { userId: 'u_admin', telegramId: '100000001', linkedAt: isoNow() },
      { userId: 'u_manager', telegramId: '100000002', linkedAt: isoNow() },
      { userId: 'u_worker', telegramId: '100000003', linkedAt: isoNow() }
    ],
    works: [
      { id: 'w1', projectId: 'depo', organizationId: 'alpha', name: 'Устройство монолитных стен', code: 'DEPO-001', unit: 'м²', totalVolume: 500, sourceRemaining: 500, dailyPlan: plan([22, 26, 30, 32, 28, 0, 0, 35, 34, 30, 28, 26, 0, 0, 32, 30, 28, 25]) },
      { id: 'w2', projectId: 'depo', organizationId: 'alpha', name: 'Армирование плиты П1', code: 'DEPO-002', unit: 'т', totalVolume: 90, sourceRemaining: 90, dailyPlan: plan([4, 5, 5, 6, 5, 0, 0, 6, 6, 5, 5, 4, 0, 0, 6, 5, 5, 4]) },
      { id: 'w3', projectId: 'depo', organizationId: 'beta', name: 'Монтаж трубопровода Ø400', code: 'DEPO-003', unit: 'м', totalVolume: 420, sourceRemaining: 420, dailyPlan: plan([18, 20, 22, 25, 25, 0, 0, 28, 28, 26, 24, 22, 0, 0, 30, 28, 26, 24]) },
      { id: 'w4', projectId: 'depo', organizationId: 'beta', name: 'Монтаж трубопровода Ø159', code: 'DEPO-004', unit: 'м', totalVolume: 310, sourceRemaining: 310, dailyPlan: plan([15, 18, 18, 20, 22, 0, 0, 22, 24, 22, 20, 18, 0, 0, 22, 20, 18, 16]) },
      { id: 'w5', projectId: 'depo', organizationId: 'monolit', name: 'Устройство фундаментной плиты', code: 'DEPO-005', unit: 'м³', totalVolume: 650, sourceRemaining: 650, dailyPlan: plan([30, 35, 40, 42, 45, 0, 0, 45, 48, 46, 42, 40, 0, 0, 48, 46, 44, 40]) },
      { id: 'w6', projectId: 'dynamo', organizationId: 'alpha', name: 'Монтаж металлоконструкций', code: 'DYN-001', unit: 'т', totalVolume: 180, sourceRemaining: 180, dailyPlan: plan([8, 9, 10, 10, 8, 0, 0, 12, 11, 10]) }
    ],
    reports: [
      { id: 'r1', projectId: 'depo', organizationId: 'alpha', userId: 'u_worker', reportDate: '2026-09-01', createdAt: '2026-09-01T14:31:00.000Z', sentAt: '2026-09-01T14:37:00.000Z', status: 'sent', facts: [{ workId: 'w1', amount: 19 }, { workId: 'w2', amount: 4 }], workers: [{ name: 'Монтажник', count: 8 }, { name: 'Арматурщик', count: 5 }], equipment: [{ name: 'Автокран', count: 1 }], photos: [] },
      { id: 'r2', projectId: 'depo', organizationId: 'beta', userId: 'u_admin', reportDate: '2026-09-01', createdAt: '2026-09-01T15:20:00.000Z', sentAt: '2026-09-01T15:20:00.000Z', status: 'sent', facts: [{ workId: 'w3', amount: 16 }, { workId: 'w4', amount: 14 }], workers: [{ name: 'Монтажник', count: 7 }, { name: 'Сварщик', count: 3 }], equipment: [{ name: 'Экскаватор', count: 1 }], photos: [] },
      { id: 'r3', projectId: 'depo', organizationId: 'monolit', userId: 'u_admin', reportDate: '2026-09-01', createdAt: '2026-09-01T16:03:00.000Z', sentAt: '2026-09-01T16:03:00.000Z', status: 'sent', facts: [{ workId: 'w5', amount: 27 }], workers: [{ name: 'Бетонщик', count: 11 }], equipment: [{ name: 'Бетононасос', count: 1 }], photos: [] },
      { id: 'r4', projectId: 'depo', organizationId: 'alpha', userId: 'u_worker', reportDate: '2026-09-02', createdAt: '2026-09-02T14:28:00.000Z', sentAt: '2026-09-02T14:35:00.000Z', status: 'sent', facts: [{ workId: 'w1', amount: 24 }, { workId: 'w2', amount: 4.5 }], workers: [{ name: 'Монтажник', count: 9 }, { name: 'Арматурщик', count: 5 }], equipment: [{ name: 'Автокран', count: 1 }], photos: [] },
      { id: 'r5', projectId: 'depo', organizationId: 'beta', userId: 'u_manager', reportDate: '2026-09-02', createdAt: '2026-09-02T15:40:00.000Z', sentAt: '2026-09-02T15:40:00.000Z', status: 'sent', facts: [{ workId: 'w3', amount: 18 }, { workId: 'w4', amount: 17 }], workers: [{ name: 'Монтажник', count: 8 }, { name: 'Сварщик', count: 4 }], equipment: [{ name: 'Экскаватор', count: 1 }, { name: 'Автокран', count: 1 }], photos: [] }
    ],
    schedules: [{ id: 's_sep_2026', projectId: 'depo', month: '2026-09', version: 1, status: 'active', originalName: 'График_DEPO_Сентябрь_2026.xlsx', storedName: null, uploadedAt: '2026-09-01T08:00:00.000Z', uploadedBy: 'u_admin', workIds: ['w1', 'w2', 'w3', 'w4', 'w5'] }],
    milestones: [{ id: 'm1', projectId: 'depo', name: 'Контрольный срез №1', date: '2026-09-10', createdBy: 'u_manager', createdAt: '2026-09-02T10:00:00.000Z' }],
    dictionaries: { professions: ['Монтажник', 'Сварщик', 'Арматурщик', 'Бетонщик', 'Разнорабочий'], equipment: ['Автокран', 'Экскаватор', 'Самосвал', 'Бетононасос'] },
    audit: [
      { id: 'a1', userId: 'u_admin', projectId: 'depo', action: 'schedule.upload', at: '2026-09-01T08:00:00.000Z', oldValue: null, newValue: { month: '2026-09', version: 1 } },
      { id: 'a2', userId: 'u_worker', projectId: 'depo', action: 'report.submit', at: '2026-09-02T14:35:00.000Z', oldValue: null, newValue: { reportId: 'r4' } }
    ]
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function normalizeStore(source) {
  const normalized = { ...source };
  normalized.organizations = (Array.isArray(source.organizations) ? source.organizations : []).map(organization => ({
    ...organization,
    reportSettings: {
      planFact: organization.reportSettings?.planFact !== false,
      workforce: organization.reportSettings?.workforce === true,
      machinery: organization.reportSettings?.machinery === true,
      photos: organization.reportSettings?.photos !== false
    }
  }));
  normalized.projects = (Array.isArray(source.projects) ? source.projects : []).map(project => {
    const customer = project.customerOrganization && typeof project.customerOrganization === 'object'
      ? project.customerOrganization
      : {};
    const contractorIds = [
      ...(Array.isArray(project.contractorIds) ? project.contractorIds.map(String) : []),
      ...normalized.organizations.filter(organization => (organization.projectIds || []).includes(project.id)).map(organization => organization.id)
    ];
    return {
      ...project,
      customerOrganization: {
        fullName: String(customer.fullName || project.customerOrganizationFullName || ''),
        portalName: String(customer.portalName || project.customerOrganizationName || ''),
        portalPage: String(customer.portalPage || project.portalPage || '')
      },
      contractorIds: [...new Set(contractorIds)],
      scheduleImportMapping: normalizeImportMapping(project.scheduleImportMapping)
    };
  });
  const legacyTelegramLinks = Array.isArray(source.telegramLinks) ? source.telegramLinks : [];
  const telegramIdByUser = new Map(legacyTelegramLinks.map(link => [link.userId, String(link.telegramId || '')]));
  normalized.users = (Array.isArray(source.users) ? source.users : []).map(user => {
    const assignments = (Array.isArray(user.assignments) ? user.assignments : []).map(item => {
      const project = normalized.projects.find(candidate => candidate.id === item.projectId);
      const customer = item.customerOrganization && typeof item.customerOrganization === 'object'
        ? item.customerOrganization
        : project?.customerOrganization || {};
      const assignedOrganization = item.organization && typeof item.organization === 'object'
        ? item.organization
        : normalized.organizations.find(organization => (item.organizationIds || []).includes(organization.id)) || {};
      return {
        ...item,
        organizationIds: Array.isArray(item.organizationIds) ? item.organizationIds.map(String) : [],
        organization: {
          fullName: String(assignedOrganization.fullName || user.organization?.fullName || customer.fullName || ''),
          customerOrganizationName: String(assignedOrganization.customerOrganizationName || user.organization?.customerOrganizationName || customer.portalName || '')
        },
        customerOrganization: {
          fullName: String(customer.fullName || ''),
          portalName: String(customer.portalName || ''),
          portalPage: String(customer.portalPage || '')
        }
      };
    });
    const primaryOrganization = user.organization && typeof user.organization === 'object'
      ? user.organization
      : assignments[0]?.organization || {};
    return {
      ...user,
      telegramId: String(user.telegramId || telegramIdByUser.get(user.id) || ''),
      organization: {
        fullName: String(primaryOrganization.fullName || ''),
        customerOrganizationName: String(primaryOrganization.customerOrganizationName || '')
      },
      assignments
    };
  });
  const legacyLinkByUser = new Map(legacyTelegramLinks.map(link => [link.userId, link]));
  normalized.telegramLinks = normalized.users.filter(user => user.telegramId).map(user => ({
    userId: user.id,
    telegramId: String(user.telegramId),
    linkedAt: legacyLinkByUser.get(user.id)?.linkedAt || null
  }));
  return normalized;
}

function persistStore(value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const [key, fileName] of Object.entries(DATA_FILES)) {
    let data = value[key];
    if (key === 'users') data = value.users;
    if (key === 'telegramLinks') {
      const existing = new Map((value.telegramLinks || []).map(link => [link.userId, link]));
      data = value.users.filter(user => user.telegramId).map(user => ({
        userId: user.id,
        telegramId: String(user.telegramId),
        linkedAt: existing.get(user.id)?.linkedAt || null
      }));
      value.telegramLinks = data;
    }
    writeJsonAtomic(path.join(DATA_DIR, fileName), data);
  }
}

function loadStore() {
  const splitFilesExist = Object.values(DATA_FILES).some(fileName => fs.existsSync(path.join(DATA_DIR, fileName)));
  if (splitFilesExist) {
    const defaults = fs.existsSync(LEGACY_STORE_FILE) ? normalizeStore(readJson(LEGACY_STORE_FILE)) : seedStore();
    const loaded = {};
    for (const [key, fileName] of Object.entries(DATA_FILES)) {
      const file = path.join(DATA_DIR, fileName);
      loaded[key] = fs.existsSync(file) ? readJson(file) : defaults[key];
    }
    const normalized = normalizeStore(loaded);
    persistStore(normalized);
    return normalized;
  }

  const initial = fs.existsSync(LEGACY_STORE_FILE) ? readJson(LEGACY_STORE_FILE) : seedStore();
  const normalized = normalizeStore(initial);
  normalized.meta = { ...normalized.meta, version: 3, storage: 'split-json', migratedAt: fs.existsSync(LEGACY_STORE_FILE) ? isoNow() : undefined };
  persistStore(normalized);
  return normalized;
}

let store = loadStore();

function persist() {
  persistStore(store);
}

function cleanUser(user) {
  if (!user) return null;
  const { passwordHash: _, telegramInvite: __, ...safe } = user;
  return safe;
}

function telegramInviteTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createTelegramInvite(account, createdBy) {
  const token = crypto.randomBytes(24).toString('base64url');
  account.telegramInvite = {
    tokenHash: telegramInviteTokenHash(token),
    createdAt: isoNow(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy
  };
  return {
    url: `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=invite_${token}`,
    expiresAt: account.telegramInvite.expiresAt
  };
}

function defaultProjectId(user) {
  return user?.assignments.find(item => store.projects.some(project => project.id === item.projectId && project.status === 'active'))?.projectId
    || user?.assignments[0]?.projectId
    || null;
}

function accessibleProjects(user) {
  const projectIds = new Set((user?.assignments || []).map(item => item.projectId));
  const assigned = store.projects.filter(project => projectIds.has(project.id));
  const active = assigned.filter(project => project.status === 'active');
  return active.length ? active : assigned;
}

function projectChoice(project, user) {
  const role = assignment(user, project.id)?.role || '';
  return {
    id: project.id,
    name: project.name,
    shortName: project.shortName,
    role,
    customerOrganization: project.customerOrganization,
    contractors: (project.contractorIds || []).map(contractorId => store.organizations.find(item => item.id === contractorId))
      .filter(Boolean).map(item => ({ id: item.id, fullName: item.fullName, shortName: item.shortName }))
  };
}

function telegramAuthPayload(user, selectedProjectId = '') {
  const projects = accessibleProjects(user);
  const selected = selectedProjectId ? projects.find(project => project.id === selectedProjectId) : null;
  if (selectedProjectId && !selected) throw Object.assign(new Error('Нет доступа к выбранному объекту'), { status: 403 });
  const requiresProjectSelection = !selected && projects.length > 1;
  const project = selected || (projects.length === 1 ? projects[0] : null);
  return {
    user: cleanUser(user),
    projectId: project?.id || null,
    startRoute: project ? projectLandingRoute(user, project.id) : null,
    requiresProjectSelection,
    projectChoices: projects.map(item => projectChoice(item, user))
  };
}

function projectLandingRoute(user, projectId) {
  const role = assignment(user, projectId)?.role;
  if (role === 'responsible') return 'home';
  if (role === 'manager' || role === 'admin') return 'planfact';
  return 'profile';
}

function userByTelegramId(telegramId) {
  return store.users.find(user => String(user.telegramId || '') === String(telegramId) && user.status === 'active') || null;
}

function tokenFor(user) {
  const body = Buffer.from(JSON.stringify({ uid: user.id, exp: Date.now() + 1000 * 60 * 60 * 12 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function issueLoginTicket(user) {
  const now = Date.now();
  for (const [ticket, value] of loginTickets) if (value.expiresAt <= now) loginTickets.delete(ticket);
  const ticket = crypto.randomBytes(32).toString('base64url');
  loginTickets.set(ticket, { userId: user.id, expiresAt: now + 60_000 });
  return ticket;
}

function consumeLoginTicket(ticket) {
  const value = loginTickets.get(String(ticket || ''));
  loginTickets.delete(String(ticket || ''));
  if (!value || value.expiresAt <= Date.now()) return null;
  return store.users.find(user => user.id === value.userId && user.status === 'active') || null;
}

function userFromRequest(req) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v.length === 2));
  const auth = req.headers.authorization || '';
  const token = cookies.pf_session || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return store.users.find(u => u.id === payload.uid && u.status === 'active') || null;
  } catch { return null; }
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

function parseBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > limit) { reject(new Error('Файл или запрос слишком большой')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

function assignment(user, projectId) {
  return user && user.assignments.find(a => a.projectId === projectId);
}

function requireProject(user, projectId, roles = []) {
  const a = assignment(user, projectId);
  if (!a) throw Object.assign(new Error('Нет доступа к этому объекту'), { status: 403 });
  if (roles.length && !roles.includes(a.role)) throw Object.assign(new Error('Недостаточно прав'), { status: 403 });
  return a;
}

function audit(userId, projectId, action, oldValue, newValue) {
  store.audit.unshift({ id: id('audit'), userId, projectId, action, at: isoNow(), oldValue: oldValue ?? null, newValue: newValue ?? null });
}

function reportedActualFor(workId, throughDate = '9999-12-31') {
  return store.reports.filter(r => r.status === 'sent' && r.reportDate <= throughDate)
    .flatMap(r => r.facts).filter(f => f.workId === workId).reduce((sum, f) => sum + Number(f.amount || 0), 0);
}

function reportedActualForMonth(workId, month) {
  return store.reports.filter(r => r.status === 'sent' && r.reportDate.startsWith(month))
    .flatMap(r => r.facts).filter(f => f.workId === workId).reduce((sum, f) => sum + Number(f.amount || 0), 0);
}

function actualFor(workId, throughDate = '9999-12-31') {
  const work = store.works.find(item => item.id === workId);
  return Number(work?.priorActual || 0) + reportedActualFor(workId, throughDate);
}

function remainingFor(work) {
  const reported = reportedActualFor(work.id);
  return Math.max(0, Math.min(Number(work.totalVolume || 0) - actualFor(work.id), Number(work.sourceRemaining || 0) - reported));
}

function planFor(work, from, to) {
  return Object.entries(work.dailyPlan || {}).filter(([date]) => date >= from && date <= to).reduce((sum, [, value]) => sum + Number(value || 0), 0);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ANALYTICS_PERIODS = new Set(['today', '3days', '7days', 'month']);

function validDate(value) {
  if (!DATE_PATTERN.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateInTimezone(timezone = 'Europe/Moscow') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function allowedWorks(user, projectId) {
  const a = requireProject(user, projectId);
  return store.works.filter(w => w.projectId === projectId && (a.role !== 'responsible' || a.organizationIds.includes(w.organizationId)));
}

function rangeFor(period, endDate) {
  if (!ANALYTICS_PERIODS.has(period)) throw Object.assign(new Error('Неизвестный период аналитики'), { status: 400 });
  if (!validDate(endDate)) throw Object.assign(new Error('Некорректная дата среза'), { status: 400 });
  const end = new Date(`${endDate}T12:00:00Z`);
  let start = new Date(end);
  if (period === '3days') start.setUTCDate(end.getUTCDate() - 2);
  else if (period === '7days') start.setUTCDate(end.getUTCDate() - 6);
  else if (period === 'month') start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 12));
  const fmt = d => d.toISOString().slice(0, 10);
  return [fmt(start), fmt(end)];
}

function analytics(projectId, query) {
  const project = store.projects.find(item => item.id === projectId);
  if (!project) throw Object.assign(new Error('Объект не найден'), { status: 404 });
  const period = query.get('period') || '7days';
  const end = query.get('end') || dateInTimezone(project.timezone);
  let [from, to] = rangeFor(period, end);
  if (query.get('from')) {
    if (!validDate(query.get('from'))) throw Object.assign(new Error('Некорректная дата начала периода'), { status: 400 });
    from = query.get('from');
  }
  if (from > to) throw Object.assign(new Error('Дата начала периода не может быть позже даты среза'), { status: 400 });
  const rangeDays = Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1;
  if (rangeDays > 366) throw Object.assign(new Error('Период аналитики не может превышать 366 дней'), { status: 400 });
  const orgId = query.get('organizationId') || 'all';
  const workId = query.get('workId') || 'all';
  if (orgId !== 'all' && !store.organizations.some(o => o.id === orgId && o.projectIds.includes(projectId))) throw Object.assign(new Error('Подрядчик не относится к выбранному объекту'), { status: 400 });
  if (workId !== 'all' && !store.works.some(w => w.id === workId && w.projectId === projectId)) throw Object.assign(new Error('Работа не относится к выбранному объекту'), { status: 400 });
  let works = store.works.filter(w => w.projectId === projectId && (orgId === 'all' || w.organizationId === orgId) && (workId === 'all' || w.id === workId));
  const rows = works.map(w => {
    const periodActual = store.reports.filter(r => r.projectId === projectId && r.status === 'sent' && r.reportDate >= from && r.reportDate <= to).flatMap(r => r.facts).filter(f => f.workId === w.id).reduce((s, f) => s + Number(f.amount || 0), 0);
    const periodPlan = planFor(w, from, to);
    const cumulativePlan = planFor(w, '0000-01-01', to);
    const cumulativeActual = actualFor(w.id, to);
    const deviation = cumulativeActual - cumulativePlan;
    const status = cumulativePlan <= 1e-9 ? (cumulativeActual > 1e-9 ? 'ahead' : 'not_planned') : deviation < -1e-9 ? 'lag' : deviation > 1e-9 ? 'ahead' : 'on_track';
    return { ...w, plan: periodPlan, actual: periodActual, periodDeviation: periodActual - periodPlan, cumulativePlan, cumulativeActual, deviation, completionPercent: cumulativePlan > 0 ? Math.round(cumulativeActual / cumulativePlan * 1000) / 10 : null, status, remaining: Math.max(0, w.totalVolume - cumulativeActual), organization: store.organizations.find(o => o.id === w.organizationId) };
  });
  const days = [];
  for (let d = new Date(`${from}T12:00:00Z`), last = new Date(`${to}T12:00:00Z`); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    days.push({ date, plan: works.reduce((s, w) => s + Number(w.dailyPlan?.[date] || 0), 0), actual: store.reports.filter(r => r.projectId === projectId && r.status === 'sent' && r.reportDate === date).flatMap(r => r.facts).filter(f => works.some(w => w.id === f.workId)).reduce((s, f) => s + Number(f.amount || 0), 0) });
  }
  const unitTotals = Object.values(rows.reduce((result, row) => {
    const unit = row.unit || 'Без единицы';
    const total = result[unit] || { unit, plan: 0, actual: 0, cumulativePlan: 0, cumulativeActual: 0 };
    total.plan += row.plan; total.actual += row.actual; total.cumulativePlan += row.cumulativePlan; total.cumulativeActual += row.cumulativeActual;
    result[unit] = total;
    return result;
  }, {}));
  const summary = rows.reduce((result, row) => {
    result.total += 1;
    if (row.status === 'lag') result.lag += 1;
    else if (row.status === 'not_planned') result.notPlanned += 1;
    else result.onTrack += 1;
    return result;
  }, { total: 0, lag: 0, onTrack: 0, notPlanned: 0 });
  return { period, from, to, rows, days, unitTotals, summary, totals: rows.reduce((a, r) => ({ plan: a.plan + r.plan, actual: a.actual + r.actual, cumulativePlan: a.cumulativePlan + r.cumulativePlan, cumulativeActual: a.cumulativeActual + r.cumulativeActual }), { plan: 0, actual: 0, cumulativePlan: 0, cumulativeActual: 0 }) };
}

let mutationQueue = Promise.resolve();
function serializedMutation(fn) {
  const task = mutationQueue.then(fn, fn);
  mutationQueue = task.catch(() => {});
  return task;
}

function validateTelegram(initData) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw Object.assign(new Error('На сервере не задан TELEGRAM_BOT_TOKEN'), { status: 503 });
  const params = new URLSearchParams(initData);
  const supplied = params.get('hash');
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (!supplied || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw Object.assign(new Error('Подпись Telegram недействительна'), { status: 401 });
  const authDate = Number(params.get('auth_date'));
  const now = Date.now() / 1000;
  if (!authDate || authDate > now + 60 || now - authDate > 86400) throw Object.assign(new Error('Данные Telegram устарели'), { status: 401 });
  let telegramUser;
  try { telegramUser = JSON.parse(params.get('user') || '{}'); } catch { throw Object.assign(new Error('Данные пользователя Telegram повреждены'), { status: 401 }); }
  if (!Number.isSafeInteger(telegramUser.id) || telegramUser.id <= 0) throw Object.assign(new Error('Telegram ID не получен'), { status: 401 });
  return telegramUser;
}

function consumeTelegramInvite(initData, telegramUser) {
  const startParam = String(new URLSearchParams(initData).get('start_param') || '');
  const match = startParam.match(/^invite_([A-Za-z0-9_-]{20,50})$/);
  if (!match) return null;
  const tokenHash = telegramInviteTokenHash(match[1]);
  const account = store.users.find(item => item.status === 'active' && item.telegramInvite?.tokenHash === tokenHash);
  if (!account || Date.parse(account.telegramInvite.expiresAt) < Date.now()) throw Object.assign(new Error('Ссылка для привязки Telegram недействительна или устарела'), { status: 403, code: 'TELEGRAM_INVITE_INVALID' });
  const telegramId = String(telegramUser.id);
  const owner = store.users.find(item => item.id !== account.id && String(item.telegramId || '') === telegramId);
  if (owner) throw Object.assign(new Error('Этот Telegram ID уже привязан к другому пользователю'), { status: 409, code: 'TELEGRAM_ALREADY_LINKED' });
  if (account.telegramId && account.telegramId !== telegramId) throw Object.assign(new Error('Пользователь уже привязан к другому Telegram ID'), { status: 409, code: 'TELEGRAM_ALREADY_LINKED' });
  const oldValue = { telegramId: account.telegramId || null };
  account.telegramId = telegramId;
  delete account.telegramInvite;
  const existingLink = store.telegramLinks.find(link => link.userId === account.id);
  if (existingLink) Object.assign(existingLink, { telegramId, linkedAt: isoNow() });
  else store.telegramLinks.push({ userId: account.id, telegramId, linkedAt: isoNow() });
  audit(account.id, defaultProjectId(account), 'user.telegram_link', oldValue, { telegramId, verified: true, source: 'invite' });
  persist();
  return account;
}

async function api(req, res, url) {
  const method = req.method;
  const route = url.pathname;

  if (method === 'GET' && route === '/api/health') return send(res, 200, { ok: true, service: 'plan-fakt', time: isoNow() });
  if (method === 'POST' && route === '/api/auth/launch') {
    const body = await parseBody(req);
    const user = store.users.find(u => u.login.toLowerCase() === String(body.login || '').toLowerCase() && u.status === 'active');
    if (!user || !checkPassword(body.password || '', user.passwordHash)) return send(res, 401, { error: 'Неверный логин или пароль' });
    return send(res, 200, { ticket: issueLoginTicket(user) });
  }
  if (method === 'POST' && route === '/api/auth/exchange') {
    const body = await parseBody(req);
    const user = consumeLoginTicket(body.ticket);
    if (!user) return send(res, 401, { error: 'Ссылка для входа устарела. Откройте блок ещё раз.' });
    audit(user.id, user.assignments[0]?.projectId, 'auth.login', null, { channel: 'site-modal' }); persist();
    return send(res, 200, { user: cleanUser(user) }, { 'Set-Cookie': `pf_session=${encodeURIComponent(tokenFor(user))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200` });
  }
  if (method === 'POST' && route === '/api/auth/login') {
    const body = await parseBody(req);
    const user = store.users.find(u => u.login.toLowerCase() === String(body.login || '').toLowerCase() && u.status === 'active');
    if (!user || !checkPassword(body.password || '', user.passwordHash)) return send(res, 401, { error: 'Неверный логин или пароль' });
    audit(user.id, user.assignments[0]?.projectId, 'auth.login', null, { channel: 'web' }); persist();
    return send(res, 200, { user: cleanUser(user) }, { 'Set-Cookie': `pf_session=${encodeURIComponent(tokenFor(user))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200` });
  }
  if (method === 'POST' && route === '/api/auth/telegram') {
    const body = await parseBody(req);
    const telegramUser = validateTelegram(body.initData || '');
    const user = consumeTelegramInvite(body.initData || '', telegramUser) || userByTelegramId(telegramUser.id);
    if (!user) return send(res, 403, { error: 'Telegram ID не найден. Войдите по логину и паролю, чтобы привязать аккаунт.', code: 'TELEGRAM_ACCOUNT_NOT_LINKED', telegramId: String(telegramUser.id) });
    const authData = telegramAuthPayload(user);
    if (!authData.projectChoices.length) return send(res, 403, { error: 'Для аккаунта не назначен объект. Обратитесь к администратору.', code: 'TELEGRAM_PROJECT_NOT_ASSIGNED' });
    audit(user.id, authData.projectId, 'auth.login', null, { channel: 'telegram', requiresProjectSelection: authData.requiresProjectSelection }); persist();
    return send(res, 200, authData, { 'Set-Cookie': `pf_session=${encodeURIComponent(tokenFor(user))}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=43200` });
  }
  if (method === 'POST' && route === '/api/auth/telegram/link') {
    const body = await parseBody(req);
    const telegramUser = validateTelegram(body.initData || '');
    if (body.confirmLink !== true) return send(res, 400, { error: 'Подтвердите привязку Telegram ID', code: 'TELEGRAM_LINK_CONFIRMATION_REQUIRED' });
    const telegramId = String(telegramUser.id);
    const user = await serializedMutation(() => {
      const account = store.users.find(item => item.login.toLowerCase() === String(body.login || '').toLowerCase() && item.status === 'active');
      if (!account || !checkPassword(body.password || '', account.passwordHash)) throw Object.assign(new Error('Неверный логин или пароль'), { status: 401 });
      const ownerLink = store.telegramLinks.find(link => String(link.telegramId) === telegramId);
      if (ownerLink && ownerLink.userId !== account.id) throw Object.assign(new Error('Этот Telegram ID уже привязан к другому аккаунту'), { status: 409 });
      if (account.telegramId && account.telegramId !== telegramId) throw Object.assign(new Error('Аккаунт уже привязан к другому Telegram ID. Обратитесь к администратору.'), { status: 409 });
      const oldTelegramId = account.telegramId || null;
      account.telegramId = telegramId;
      const existingLink = store.telegramLinks.find(link => link.userId === account.id);
      if (existingLink) Object.assign(existingLink, { telegramId, linkedAt: existingLink.linkedAt || isoNow() });
      else store.telegramLinks.push({ userId: account.id, telegramId, linkedAt: isoNow() });
      audit(account.id, defaultProjectId(account), 'user.telegram_link', { telegramId: oldTelegramId }, { telegramId, verified: true });
      persist();
      return account;
    });
    const authData = telegramAuthPayload(user);
    if (!authData.projectChoices.length) return send(res, 403, { error: 'Telegram ID привязан, но для аккаунта не назначен объект. Обратитесь к администратору.', code: 'TELEGRAM_PROJECT_NOT_ASSIGNED', linked: true });
    return send(res, 200, { ...authData, linked: true }, { 'Set-Cookie': `pf_session=${encodeURIComponent(tokenFor(user))}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=43200` });
  }
  if (method === 'POST' && route === '/api/auth/telegram/select-project') {
    const body = await parseBody(req);
    const telegramUser = validateTelegram(body.initData || '');
    const user = userByTelegramId(telegramUser.id);
    if (!user) return send(res, 403, { error: 'Telegram ID не привязан к аккаунту', code: 'TELEGRAM_ACCOUNT_NOT_LINKED' });
    const authData = telegramAuthPayload(user, String(body.projectId || ''));
    audit(user.id, authData.projectId, 'auth.project_select', null, { channel: 'telegram' }); persist();
    return send(res, 200, authData, { 'Set-Cookie': `pf_session=${encodeURIComponent(tokenFor(user))}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=43200` });
  }
  if (method === 'POST' && route === '/api/auth/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'pf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });

  const user = userFromRequest(req);
  if (!user) return send(res, 401, { error: 'Требуется авторизация' });

  if (method === 'GET' && route === '/api/session') return send(res, 200, { user: cleanUser(user) });
  if (method === 'GET' && route === '/api/bootstrap') {
    return send(res, 200, { user: cleanUser(user), projects: accessibleProjects(user), organizations: store.organizations, dictionaries: store.dictionaries });
  }

  const projectId = url.searchParams.get('projectId') || '';

  if (method === 'GET' && route === '/api/works') {
    const a = requireProject(user, projectId);
    const project = store.projects.find(item => item.id === projectId);
    const reportMonth = dateInTimezone(project?.timezone).slice(0, 7);
    const works = allowedWorks(user, projectId).map(w => {
      const accumulatedActual = actualFor(w.id);
      const base = { id: w.id, name: w.name, code: w.code, hierarchy: w.hierarchy || [], unit: w.unit, organizationId: w.organizationId, totalVolume: w.totalVolume, priorActual: Number(w.priorActual || 0), accumulatedActual, monthActual: reportedActualForMonth(w.id, reportMonth), remaining: remainingFor(w) };
      return a.role === 'responsible' ? base : { ...base, dailyPlan: w.dailyPlan };
    });
    return send(res, 200, { works });
  }

  if (method === 'GET' && route === '/api/analytics') {
    requireProject(user, projectId, ['manager', 'admin']);
    return send(res, 200, analytics(projectId, url.searchParams));
  }

  if (method === 'GET' && route === '/api/reports') {
    const a = requireProject(user, projectId);
    let reports = store.reports.filter(r => r.projectId === projectId);
    if (a.role === 'responsible') reports = reports.filter(r => r.userId === user.id);
    return send(res, 200, { reports: reports.map(r => ({ ...r, user: cleanUser(store.users.find(u => u.id === r.userId)), organization: store.organizations.find(o => o.id === r.organizationId) })).sort((a, b) => b.reportDate.localeCompare(a.reportDate)) });
  }

  if (method === 'POST' && route === '/api/reports') {
    const body = await parseBody(req);
    const a = requireProject(user, body.projectId, ['responsible', 'admin', 'manager']);
    const result = await serializedMutation(() => {
      const facts = (body.facts || []).filter(f => Number(f.amount) > 0).map(f => ({ workId: String(f.workId), amount: Number(f.amount) }));
      const noWork = body.noWork === true;
      const noFacts = noWork || body.noFacts === true;
      if (!facts.length && !noFacts) throw Object.assign(new Error('Укажите выполненный объём или отметьте, что объёмов нет'), { status: 400 });
      const workIds = new Set();
      for (const fact of facts) {
        if (workIds.has(fact.workId)) throw Object.assign(new Error('Одна работа добавлена дважды'), { status: 400 });
        workIds.add(fact.workId);
        const work = store.works.find(w => w.id === fact.workId && w.projectId === body.projectId);
        if (!work || (a.role === 'responsible' && !a.organizationIds.includes(work.organizationId))) throw Object.assign(new Error('Работа недоступна пользователю'), { status: 403 });
        const remaining = remainingFor(work);
        if (fact.amount > remaining + 1e-9) throw Object.assign(new Error(`По работе «${work.name}» доступный остаток — ${remaining} ${work.unit}`), { status: 409 });
      }
      const orgIds = facts.length ? [...new Set(facts.map(f => store.works.find(w => w.id === f.workId).organizationId))] : [...(a.organizationIds || [])];
      if (orgIds.length !== 1) throw Object.assign(new Error('Один отчёт должен относиться к одной подрядной организации'), { status: 400 });
      const organization = store.organizations.find(item => item.id === orgIds[0]);
      const settings = organization?.reportSettings || { planFact: true, workforce: false, machinery: false, photos: true };
      const report = { id: id('report'), projectId: body.projectId, organizationId: orgIds[0], userId: user.id, reportDate: body.reportDate || new Date().toISOString().slice(0, 10), createdAt: isoNow(), sentAt: isoNow(), status: 'sent', noFacts: noFacts && !noWork, noWork, facts, workers: noWork ? [] : settings.workforce ? (body.workers || []).filter(x => x.name && Number(x.count) > 0).map(x => ({ name: String(x.name).slice(0, 80), count: Number(x.count) })) : [], equipment: noWork ? [] : settings.machinery ? (body.equipment || []).filter(x => x.name && Number(x.count) > 0).map(x => ({ name: String(x.name).slice(0, 80), count: Number(x.count) })) : [], photos: noWork ? [] : settings.photos !== false ? (body.photos || []).slice(0, 10).map(p => ({ id: id('photo'), name: String(p.name || 'Фото'), type: String(p.type || 'image/jpeg'), dataUrl: String(p.dataUrl || '').slice(0, 4_000_000) })) : [] };
      store.reports.push(report);
      audit(user.id, body.projectId, 'report.submit', null, { reportId: report.id, facts: report.facts });
      for (const row of report.workers) if (!store.dictionaries.professions.includes(row.name)) store.dictionaries.professions.push(row.name);
      for (const row of report.equipment) if (!store.dictionaries.equipment.includes(row.name)) store.dictionaries.equipment.push(row.name);
      persist();
      return report;
    });
    return send(res, 201, { report: result });
  }

  if (method === 'GET' && route === '/api/milestones') {
    requireProject(user, projectId, ['manager', 'admin']);
    return send(res, 200, { milestones: store.milestones.filter(m => m.projectId === projectId).map(m => ({ ...m, snapshot: analytics(projectId, new URLSearchParams({ period: 'month', end: m.date })).totals })) });
  }
  if (method === 'POST' && route === '/api/milestones') {
    const body = await parseBody(req); requireProject(user, body.projectId, ['manager', 'admin']);
    const milestone = { id: id('milestone'), projectId: body.projectId, name: String(body.name || 'Контрольный срез').slice(0, 100), date: body.date, createdBy: user.id, createdAt: isoNow() };
    store.milestones.push(milestone); audit(user.id, body.projectId, 'milestone.create', null, milestone); persist();
    return send(res, 201, { milestone });
  }

  if (method === 'GET' && route === '/api/admin') {
    requireProject(user, projectId, ['admin']);
    return send(res, 200, { projects: store.projects, users: store.users.map(cleanUser), organizations: store.organizations, audit: store.audit.filter(a => a.projectId === projectId).slice(0, 100).map(a => ({ ...a, user: cleanUser(store.users.find(u => u.id === a.userId)) })) });
  }

  if (method === 'POST' && route === '/api/admin/projects') {
    const body = await parseBody(req); requireProject(user, body.contextProjectId, ['admin']);
    const contextProject = store.projects.find(item => item.id === body.contextProjectId);
    const customerOrganization = {
      fullName: String(body.customerOrganizationFullName || '').trim().slice(0, 180),
      portalName: String(contextProject?.customerOrganization?.portalName || '').slice(0, 80),
      portalPage: String(contextProject?.customerOrganization?.portalPage || '').slice(0, 120)
    };
    if (!customerOrganization.fullName || !customerOrganization.portalName) throw Object.assign(new Error('Для организации-заказчика не настроены системные параметры портала'), { status: 400 });
    const project = { id: id('project'), name: String(body.name).slice(0, 150), shortName: String(body.shortName).slice(0, 40), status: 'active', timezone: contextProject?.timezone || 'Europe/Moscow', customerOrganization, contractorIds: [] };
    store.projects.push(project);
    const adminOrganization = { fullName: user.organization?.fullName || customerOrganization.fullName, customerOrganizationName: customerOrganization.portalName };
    user.assignments.push({ projectId: project.id, role: 'admin', organizationIds: [], organization: adminOrganization, customerOrganization: { ...customerOrganization } });
    audit(user.id, project.id, 'project.create', null, project); persist();
    return send(res, 201, { project });
  }

  const projectUpdateMatch = route.match(/^\/api\/admin\/projects\/([^/]+)$/);
  if ((method === 'PATCH' || method === 'POST') && projectUpdateMatch) {
    const body = await parseBody(req); requireProject(user, body.contextProjectId, ['admin']);
    const project = store.projects.find(item => item.id === projectUpdateMatch[1]);
    if (!project) return send(res, 404, { error: 'Объект не найден' });
    const customerOrganization = {
      ...(project.customerOrganization || {}),
      fullName: String(body.customerOrganizationFullName || '').trim().slice(0, 180)
    };
    const name = String(body.name || '').trim().slice(0, 150);
    const shortName = String(body.shortName || '').trim().slice(0, 40);
    if (!name || !shortName || !customerOrganization.fullName) throw Object.assign(new Error('Заполните названия объекта и организации-заказчика'), { status: 400 });
    if (!['active', 'archive'].includes(body.status)) throw Object.assign(new Error('Некорректный статус объекта'), { status: 400 });
    const oldValue = structuredClone(project);
    Object.assign(project, { name, shortName, status: body.status, customerOrganization });
    for (const account of store.users) {
      const assigned = account.assignments.find(item => item.projectId === project.id);
      if (assigned) assigned.customerOrganization = { ...customerOrganization };
    }
    audit(user.id, project.id, 'project.update', oldValue, project); persist();
    return send(res, 200, { project });
  }

  if (method === 'POST' && route === '/api/admin/organizations') {
    const body = await parseBody(req); requireProject(user, body.projectId, ['admin']);
    const organization = { id: id('org'), fullName: String(body.fullName).slice(0, 180), shortName: String(body.shortName).slice(0, 80), status: 'active', projectIds: [body.projectId], reportSettings: { planFact: true, workforce: body.workforce === true, machinery: body.machinery === true, photos: body.photos !== false } };
    store.organizations.push(organization);
    const project = store.projects.find(item => item.id === body.projectId);
    if (project && !project.contractorIds.includes(organization.id)) project.contractorIds.push(organization.id);
    audit(user.id, body.projectId, 'organization.create', null, organization); persist();
    return send(res, 201, { organization });
  }

  const organizationUpdateMatch = route.match(/^\/api\/admin\/organizations\/([^/]+)$/);
  if (method === 'PATCH' && organizationUpdateMatch) {
    const body = await parseBody(req); requireProject(user, body.projectId, ['admin']);
    const organization = store.organizations.find(item => item.id === organizationUpdateMatch[1] && item.projectIds.includes(body.projectId));
    if (!organization) return send(res, 404, { error: 'Организация не найдена' });
    const fullName = String(body.fullName || '').trim().slice(0, 180);
    const shortName = String(body.shortName || '').trim().slice(0, 80);
    if (!fullName || !shortName) throw Object.assign(new Error('Заполните полное и краткое наименование'), { status: 400 });
    if (!['active', 'archive'].includes(body.status)) throw Object.assign(new Error('Некорректный статус организации'), { status: 400 });
    const oldValue = structuredClone(organization);
    Object.assign(organization, { fullName, shortName, status: body.status, reportSettings: { planFact: true, workforce: body.workforce === true, machinery: body.machinery === true, photos: body.photos !== false } });
    for (const account of store.users) {
      for (const assigned of account.assignments.filter(item => item.projectId === body.projectId && item.organizationIds.includes(organization.id))) assigned.organization = { fullName, customerOrganizationName: assigned.customerOrganization?.portalName || '' };
    }
    audit(user.id, body.projectId, 'organization.update', oldValue, organization); persist();
    return send(res, 200, { organization });
  }

  const organizationSettingsMatch = route.match(/^\/api\/admin\/organizations\/([^/]+)\/settings$/);
  if (method === 'POST' && organizationSettingsMatch) {
    const body = await parseBody(req); requireProject(user, body.projectId, ['admin']);
    const organization = store.organizations.find(item => item.id === organizationSettingsMatch[1] && item.projectIds.includes(body.projectId));
    if (!organization) return send(res, 404, { error: 'Организация не найдена' });
    const oldValue = organization.reportSettings || null;
    organization.reportSettings = { planFact: body.planFact !== false, workforce: body.workforce === true, machinery: body.machinery === true, photos: body.photos !== false };
    audit(user.id, body.projectId, 'organization.settings', oldValue, organization.reportSettings); persist();
    return send(res, 200, { organization });
  }

  if (method === 'POST' && route === '/api/admin/users') {
    const body = await parseBody(req); requireProject(user, body.projectId, ['admin']);
    if (!['admin', 'manager', 'responsible'].includes(body.role)) throw Object.assign(new Error('Некорректная роль'), { status: 400 });
    if (store.users.some(u => u.login.toLowerCase() === String(body.login || '').toLowerCase())) throw Object.assign(new Error('Такой логин уже используется'), { status: 409 });
    if (body.telegramId && store.users.some(u => u.telegramId === String(body.telegramId))) throw Object.assign(new Error('Telegram ID уже привязан'), { status: 409 });
    const organizationIds = body.role === 'responsible' && body.organizationId ? [body.organizationId] : [];
    if (body.role === 'responsible' && !organizationIds.length) throw Object.assign(new Error('Для Ответственного укажите организацию'), { status: 400 });
    const project = store.projects.find(item => item.id === body.projectId);
    const contractor = organizationIds.length ? store.organizations.find(item => item.id === organizationIds[0]) : null;
    const userOrganization = {
      fullName: String(contractor?.fullName || project?.customerOrganization?.fullName || '').slice(0, 180),
      customerOrganizationName: String(project?.customerOrganization?.portalName || '').slice(0, 80)
    };
    const created = { id: id('user'), name: String(body.name || '').slice(0, 120), login: String(body.login || '').slice(0, 80), passwordHash: passwordHash(String(body.password || 'ChangeMe2026!')), telegramId: String(body.telegramId || ''), status: 'active', organization: userOrganization, assignments: [{ projectId: body.projectId, role: body.role, organizationIds, organization: { ...userOrganization }, customerOrganization: { ...(project?.customerOrganization || {}) } }] };
    if (!created.name || !created.login) throw Object.assign(new Error('Заполните ФИО и логин'), { status: 400 });
    store.users.push(created);
    if (created.telegramId) store.telegramLinks.push({ userId: created.id, telegramId: created.telegramId, linkedAt: isoNow() });
    const telegramInvite = body.createTelegramInvite === true && !created.telegramId ? createTelegramInvite(created, user.id) : null;
    audit(user.id, body.projectId, 'user.create', null, cleanUser(created)); persist();
    return send(res, 201, { user: cleanUser(created), telegramInvite });
  }

  const userUpdateMatch = route.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (method === 'PATCH' && userUpdateMatch) {
    const body = await parseBody(req); requireProject(user, body.projectId, ['admin']);
    const account = store.users.find(item => item.id === userUpdateMatch[1]);
    if (!account) return send(res, 404, { error: 'Пользователь не найден' });
    if (!['admin', 'manager', 'responsible'].includes(body.role)) throw Object.assign(new Error('Некорректная роль'), { status: 400 });
    if (account.id === user.id && (body.role !== 'admin' || body.status !== 'active')) throw Object.assign(new Error('Нельзя отключить собственный доступ администратора'), { status: 400 });
    const name = String(body.name || '').trim().slice(0, 120);
    const login = String(body.login || '').trim().slice(0, 80);
    const telegramId = String(body.telegramId || '').trim().slice(0, 40);
    if (!name || !login) throw Object.assign(new Error('Заполните ФИО и логин'), { status: 400 });
    if (!['active', 'archive'].includes(body.status)) throw Object.assign(new Error('Некорректный статус пользователя'), { status: 400 });
    if (store.users.some(item => item.id !== account.id && item.login.toLowerCase() === login.toLowerCase())) throw Object.assign(new Error('Такой логин уже используется'), { status: 409 });
    if (telegramId && store.users.some(item => item.id !== account.id && item.telegramId === telegramId)) throw Object.assign(new Error('Telegram ID уже привязан'), { status: 409 });
    const organizationIds = body.role === 'responsible' && body.organizationId ? [String(body.organizationId)] : [];
    if (body.role === 'responsible' && !organizationIds.length) throw Object.assign(new Error('Для Ответственного укажите организацию'), { status: 400 });
    const project = store.projects.find(item => item.id === body.projectId);
    const contractor = organizationIds.length ? store.organizations.find(item => item.id === organizationIds[0] && item.projectIds.includes(body.projectId)) : null;
    if (organizationIds.length && !contractor) throw Object.assign(new Error('Организация не найдена'), { status: 400 });
    const oldValue = cleanUser(structuredClone(account));
    const assignedOrganization = { fullName: String(contractor?.fullName || project?.customerOrganization?.fullName || ''), customerOrganizationName: String(project?.customerOrganization?.portalName || '') };
    let assigned = account.assignments.find(item => item.projectId === body.projectId);
    if (!assigned) { assigned = { projectId: body.projectId }; account.assignments.push(assigned); }
    Object.assign(assigned, { role: body.role, organizationIds, organization: assignedOrganization, customerOrganization: { ...(project?.customerOrganization || {}) } });
    Object.assign(account, { name, login, telegramId, status: body.status, organization: assignedOrganization });
    if (body.password) account.passwordHash = passwordHash(String(body.password));
    audit(user.id, body.projectId, 'user.update', oldValue, cleanUser(account)); persist();
    return send(res, 200, { user: cleanUser(account) });
  }

  if (method === 'GET' && route === '/api/schedules') {
    requireProject(user, projectId, ['manager', 'admin']);
    const project = store.projects.find(item => item.id === projectId);
    return send(res, 200, { schedules: store.schedules.filter(s => s.projectId === projectId).sort((a, b) => b.month.localeCompare(a.month) || b.version - a.version), importMapping: normalizeImportMapping(project?.scheduleImportMapping) });
  }

  if (method === 'POST' && route === '/api/schedules/mapping') {
    const body = await parseBody(req); requireProject(user, body.projectId, ['manager', 'admin']);
    const project = store.projects.find(item => item.id === body.projectId);
    project.scheduleImportMapping = normalizeImportMapping(body.mapping);
    persist();
    return send(res, 200, { importMapping: project.scheduleImportMapping });
  }

  if (method === 'POST' && route === '/api/schedules/import') {
    const body = await parseBody(req, 40 * 1024 * 1024); requireProject(user, body.projectId, ['manager', 'admin']);
    if (!/^\d{4}-\d{2}$/.test(body.month || '') || !body.base64) throw Object.assign(new Error('Укажите месяц и Excel-файл'), { status: 400 });
    const extension = path.extname(String(body.fileName || '')).toLowerCase();
    if (!['.xlsx', '.xlsb'].includes(extension)) throw Object.assign(new Error('Поддерживаются файлы .xlsx и .xlsb'), { status: 400 });
    const safeName = `${body.projectId}_${body.month}_${Date.now()}${extension}`;
    const target = path.join(UPLOAD_DIR, safeName);
    fs.writeFileSync(target, Buffer.from(body.base64, 'base64'));
    const outputJson = `${target}.json`;
    const mappingFile = `${target}.mapping.json`;
    const importMapping = body.mapping ? normalizeImportMapping(body.mapping) : null;
    if (importMapping) {
      const project = store.projects.find(item => item.id === body.projectId);
      project.scheduleImportMapping = importMapping;
      persist();
      fs.writeFileSync(mappingFile, JSON.stringify(importMapping));
    }
    const args = [path.join(ROOT, 'tools', 'excel_bridge.py'), importMapping ? 'import-mapped' : 'import', target, outputJson, body.month];
    if (importMapping) args.push(mappingFile);
    const run = runPython(args, 60000);
    if (run.status !== 0) { fs.rmSync(target, { force: true }); throw Object.assign(new Error(`Не удалось распознать Excel: ${(run.stderr || run.stdout || '').trim()}`), { status: 422 }); }
    const parsed = JSON.parse(fs.readFileSync(outputJson, 'utf8'));
    const versions = store.schedules.filter(s => s.projectId === body.projectId && s.month === body.month);
    const previousActive = versions.find(s => s.status === 'active') || versions.slice().sort((a, b) => b.version - a.version)[0];
    const schedule = { id: id('schedule'), projectId: body.projectId, month: body.month, version: Math.max(0, ...versions.map(s => s.version)) + 1, status: 'active', originalName: String(body.fileName || 'График.xlsx').slice(0, 200), storedName: safeName, uploadedAt: isoNow(), uploadedBy: user.id, parsed };
    const incoming = parsed.works.map(source => {
      let organization = store.organizations.find(o => o.projectIds.includes(body.projectId) && (o.shortName.toLowerCase() === source.organization.toLowerCase() || o.fullName.toLowerCase() === source.organization.toLowerCase()));
      if (!organization) {
        organization = { id: id('org'), fullName: source.organization, shortName: source.organization, status: 'active', projectIds: [body.projectId], reportSettings: { planFact: true, workforce: false, machinery: false, photos: true } };
        store.organizations.push(organization);
      }
      const values = { projectId: body.projectId, organizationId: organization.id, name: source.name, code: source.code, hierarchy: source.hierarchy || [], unit: source.unit, totalVolume: source.totalVolume, priorActual: source.priorActual || 0, monthlyPlan: source.monthlyPlan || 0, sourceRemaining: source.sourceRemaining, dailyPlan: source.plans, sourceKey: source.sourceKey, sourceSheet: source.sheet, sourceRow: source.row, sourceFactRow: source.factRow || source.row, factColumns: source.factColumns, scheduleId: schedule.id };
      return { source, values };
    });
    const synchronized = syncScheduleWorks({ works: store.works, reports: store.reports, previousWorkIds: previousActive?.workIds || [], incoming, projectId: body.projectId, createWorkId: () => id('work') });
    schedule.workIds = synchronized.workIds;
    schedule.workMappings = synchronized.workMappings;
    schedule.updateSummary = synchronized.summary;
    for (const s of versions) s.status = 'superseded';
    store.schedules.push(schedule); audit(user.id, body.projectId, versions.length ? 'schedule.replace' : 'schedule.upload', previousActive || null, { id: schedule.id, month: schedule.month, version: schedule.version, ...synchronized.summary }); persist();
    return send(res, 201, { schedule, preview: parsed, updateSummary: synchronized.summary });
  }

  const jsonMatch = route.match(/^\/api\/schedules\/([^/]+)\/json$/);
  if (method === 'GET' && jsonMatch) {
    const schedule = store.schedules.find(s => s.id === jsonMatch[1]);
    if (!schedule) return send(res, 404, { error: 'График не найден' });
    requireProject(user, schedule.projectId, ['manager', 'admin']);
    const data = schedule.parsed || { month: schedule.month, works: schedule.workIds?.map(wid => store.works.find(w => w.id === wid)).filter(Boolean) || [] };
    return send(res, 200, data, { 'Content-Disposition': `attachment; filename="schedule-${schedule.month}.json"` });
  }

  const fileMatch = route.match(/^\/api\/schedules\/([^/]+)\/(original|export)$/);
  if (method === 'GET' && fileMatch) {
    const schedule = store.schedules.find(s => s.id === fileMatch[1]);
    if (!schedule) return send(res, 404, { error: 'График не найден' });
    requireProject(user, schedule.projectId, ['manager', 'admin']);
    if (!schedule.storedName) return send(res, 404, { error: 'Для демонстрационного графика исходный файл не загружен' });
    let target = path.join(UPLOAD_DIR, schedule.storedName);
    if (fileMatch[2] === 'export') {
      const factsFile = `${target}.facts.json`;
      const exportFacts = [];
      for (const report of store.reports.filter(r => r.projectId === schedule.projectId && r.reportDate.startsWith(schedule.month))) {
        for (const fact of report.facts) {
          const work = store.works.find(w => w.id === fact.workId);
          const mapping = schedule.workMappings?.[fact.workId];
          const column = mapping?.factColumns?.[report.reportDate] ?? work?.factColumns?.[report.reportDate];
          const sheet = mapping?.sheet ?? work?.sourceSheet;
          const row = mapping?.row ?? work?.sourceRow;
          const factRow = mapping?.factRow ?? work?.sourceFactRow ?? row;
          const sourceKey = mapping?.sourceKey ?? work?.sourceKey;
          if (sheet && row && column && (mapping || !schedule.workMappings)) exportFacts.push({ sheet, row: factRow, column, amount: fact.amount, date: report.reportDate, sourceKey });
        }
      }
      fs.writeFileSync(factsFile, JSON.stringify({ facts: exportFacts, parsed: schedule.parsed }));
      const exported = `${target}-plan-fact.xlsx`;
      const run = runPython([path.join(ROOT, 'tools', 'excel_bridge.py'), 'export', target, exported, factsFile], 30000);
      if (run.status !== 0) throw Object.assign(new Error(`Не удалось сформировать Excel: ${(run.stderr || run.stdout || '').trim()}`), { status: 500 });
      target = exported;
    }
    const stat = fs.statSync(target);
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileMatch[2] === 'original' ? schedule.originalName : `План-факт_${schedule.month}.xlsx`)}` });
    return fs.createReadStream(target).pipe(res);
  }

  return send(res, 404, { error: 'Маршрут не найден' });
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const origin = String(req.headers.origin || '');
    if (url.pathname === '/api/auth/launch' && BMSU_SITE_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    let file = path.resolve(PUBLIC_DIR, `.${relative}`);
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Недопустимый путь' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
    const extension = path.extname(file);
    const cacheControl = ['.html', '.js', '.css'].includes(extension) ? 'no-store' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': mime[extension] || 'application/octet-stream', 'Cache-Control': cacheControl });
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    if (!res.headersSent) send(res, error.status || 500, { error: error.message || 'Внутренняя ошибка сервера' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`План / Факт запущен: http://${HOST}:${PORT}`);
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_DISABLED !== '1') {
    const { startTelegramBot } = require('./telegram-bot');
    startTelegramBot({ token: process.env.TELEGRAM_BOT_TOKEN, webAppUrl: process.env.WEB_APP_URL || '' });
  }
});
