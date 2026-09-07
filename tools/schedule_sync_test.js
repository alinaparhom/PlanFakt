'use strict';

const assert = require('assert');
const { syncScheduleWorks } = require('./schedule_sync');

const works = [
  { id: 'keep', projectId: 'p1', code: 'A', name: 'Старое имя', monthlyPlan: 1, dailyPlan: { '2026-09-01': 1 } },
  { id: 'delete', projectId: 'p1', code: 'B', name: 'Удалить' },
  { id: 'reported', projectId: 'p1', code: 'C', name: 'Оставить из-за факта' },
  { id: 'foreign', projectId: 'p2', code: 'B', name: 'Другой объект' }
];
const reports = [{ status: 'sent', facts: [{ workId: 'reported', amount: 7 }] }];
let nextId = 0;
const incoming = [
  { source: { sourceKey: 'S:10', sheet: 'S', row: 10, factRow: 11, factColumns: { '2026-09-01': 15 } }, values: { projectId: 'p1', code: 'a', name: 'Новое имя', monthlyPlan: 20, dailyPlan: { '2026-09-01': 5 } } },
  { source: { sourceKey: 'S:12', sheet: 'S', row: 12 }, values: { projectId: 'p1', code: 'D', name: 'Новая работа', monthlyPlan: 3, dailyPlan: {} } }
];

const result = syncScheduleWorks({ works, reports, previousWorkIds: ['keep', 'delete', 'reported'], incoming, projectId: 'p1', createWorkId: () => `new-${++nextId}` });

assert.deepStrictEqual(result.summary, { added: 1, updated: 1, removed: 1, retainedWithFacts: 1 });
assert.strictEqual(works.find(work => work.id === 'keep').name, 'Новое имя');
assert.strictEqual(works.find(work => work.id === 'keep').monthlyPlan, 20);
assert.deepStrictEqual(works.find(work => work.id === 'keep').dailyPlan, { '2026-09-01': 5 });
assert(!works.some(work => work.id === 'delete'));
assert(works.some(work => work.id === 'reported'));
assert(works.some(work => work.id === 'foreign'));
assert(result.workIds.includes('reported'));
assert.strictEqual(incoming[0].source.workId, 'keep');
assert.strictEqual(result.workMappings.keep.row, 10);

console.log('schedule sync test: ok');
