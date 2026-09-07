'use strict';

function normalizedCode(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function hasReportedFact(reports, workId) {
  return reports.some(report => report.status === 'sent' && (report.facts || []).some(fact => fact.workId === workId));
}

/**
 * Synchronize the works from the previously active schedule with a new import.
 * Existing work objects are updated in place so report references remain valid.
 */
function syncScheduleWorks({ works, reports, previousWorkIds, incoming, projectId, createWorkId }) {
  const previousIds = new Set(previousWorkIds || []);
  const previousByCode = new Map();
  const projectByCode = new Map();

  for (const work of works) {
    if (work.projectId !== projectId) continue;
    const code = normalizedCode(work.code);
    if (!code) continue;
    if (!projectByCode.has(code)) projectByCode.set(code, work);
    if (previousIds.has(work.id) && !previousByCode.has(code)) previousByCode.set(code, work);
  }

  const incomingCodes = new Set();
  for (const item of incoming) {
    const code = normalizedCode(item.values.code);
    if (!code) throw Object.assign(new Error('У каждой импортируемой работы должен быть код'), { status: 422 });
    if (incomingCodes.has(code)) throw Object.assign(new Error(`В таблице найден повторяющийся код работы: ${item.values.code}`), { status: 422 });
    incomingCodes.add(code);
  }

  const workIds = [];
  const workMappings = {};
  const importedIds = new Set();
  let added = 0;
  let updated = 0;

  for (const item of incoming) {
    const code = normalizedCode(item.values.code);
    let work = previousByCode.get(code) || projectByCode.get(code);
    if (work) {
      Object.assign(work, item.values);
      delete work.removedFromSchedule;
      updated += 1;
    } else {
      work = { id: createWorkId(), ...item.values };
      works.push(work);
      added += 1;
    }
    item.source.workId = work.id;
    importedIds.add(work.id);
    workIds.push(work.id);
    workMappings[work.id] = {
      sourceKey: item.source.sourceKey,
      sheet: item.source.sheet,
      row: item.source.row,
      factRow: item.source.factRow || item.source.row,
      factColumns: item.source.factColumns || {}
    };
  }

  let removed = 0;
  let retainedWithFacts = 0;
  for (const workId of previousIds) {
    if (importedIds.has(workId)) continue;
    const index = works.findIndex(work => work.id === workId && work.projectId === projectId);
    if (index < 0) continue;
    if (hasReportedFact(reports, workId)) {
      works[index].removedFromSchedule = true;
      workIds.push(workId);
      retainedWithFacts += 1;
    } else {
      works.splice(index, 1);
      removed += 1;
    }
  }

  return { workIds, workMappings, summary: { added, updated, removed, retainedWithFacts } };
}

module.exports = { syncScheduleWorks };
