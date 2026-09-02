'use strict';

const ExcelJS = require('exceljs');
const path = require('node:path');
const crypto = require('node:crypto');

function text(cell) {
  const value = cell && cell.value;
  if (value && typeof value === 'object') return String(value.text || value.result || value.richText?.map((x) => x.text).join('') || '');
  return String(value ?? '').trim();
}

function dayFromHeader(value, year, month) {
  const match = value.match(/(?:^|\D)([0-3]?\d)(?:[./-]([01]?\d))?(?:[./-](\d{2,4}))?/);
  if (!match) return null;
  const day = Number(match[1]); const headerMonth = match[2] ? Number(match[2]) : month;
  if (day < 1 || day > 31 || headerMonth !== month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function parseWorkbook(file, year, month, contractorResolver) {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
  let best;
  workbook.eachSheet((sheet) => {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber += 1) {
      const row = sheet.getRow(rowNumber); const headers = {};
      row.eachCell({ includeEmpty: false }, (cell, col) => { headers[col] = text(cell).toLocaleLowerCase('ru'); });
      const workCol = Number(Object.keys(headers).find((col) => /наименование.*работ|^работа$/.test(headers[col])));
      const contractorCol = Number(Object.keys(headers).find((col) => /подрядчик|организац/.test(headers[col])));
      const totalCol = Number(Object.keys(headers).find((col) => /общ.*объ[её]м|^объ[её]м$/.test(headers[col])));
      if (workCol && totalCol && (!best || Object.keys(headers).length > Object.keys(best.headers).length)) best = { sheet, rowNumber, headers, workCol, contractorCol, totalCol };
    }
  });
  if (!best) throw new Error('Не найдена строка заголовков. Нужны колонки «Наименование работы» и «Общий объём».');
  const works = []; const { sheet, rowNumber, headers, workCol, contractorCol, totalCol } = best;
  for (let number = rowNumber + 1; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number); const name = text(row.getCell(workCol)); const total = Number(row.getCell(totalCol).value);
    if (!name || !Number.isFinite(total) || total <= 0) continue;
    const contractorName = contractorCol ? text(row.getCell(contractorCol)) : 'Без подрядчика';
    const contractorId = contractorResolver(contractorName); const plans = {}; const factCells = {};
    Object.entries(headers).forEach(([colString, header]) => {
      const col = Number(colString); const date = dayFromHeader(header, year, month); if (!date) return;
      if (/план/.test(header)) plans[date] = Number(row.getCell(col).value) || 0;
      if (/факт/.test(header)) factCells[date] = { sheet: sheet.name, row: number, col };
    });
    works.push({ id: crypto.randomUUID(), name, unit: text(row.getCell(totalCol).numFmt).includes('%') ? '%' : '', contractorId, total, plans, factCells, source: { sheet: sheet.name, row: number } });
  }
  if (!works.length) throw new Error('В графике не найдено ни одной работы с положительным общим объёмом.');
  return { works, sheet: sheet.name, headerRow: rowNumber };
}

async function exportWorkbook(schedule, originalFile, destination, reports) {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(originalFile);
  for (const work of schedule.works) {
    for (const [date, location] of Object.entries(work.factCells || {})) {
      const sum = reports.filter((report) => report.objectId === schedule.objectId && report.date === date)
        .flatMap((report) => report.works).filter((item) => item.workId === work.id).reduce((acc, item) => acc + Number(item.quantity), 0);
      workbook.getWorksheet(location.sheet).getRow(location.row).getCell(location.col).value = sum;
    }
  }
  await workbook.xlsx.writeFile(destination);
  return path.basename(destination);
}

module.exports = { parseWorkbook, exportWorkbook, dayFromHeader };
