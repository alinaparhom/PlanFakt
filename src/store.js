'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

function createStore(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(root, 'photos'), { recursive: true });
  const file = path.join(root, 'db.json');
  let data;
  if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    const adminId = crypto.randomUUID();
    data = {
      users: [{ id: adminId, name: 'Пархоменко Алина', login: 'Пархоменко', passwordHash: bcrypt.hashSync('286', 12), telegramId: '', memberships: [], createdAt: new Date().toISOString() }],
      objects: [], contractors: [], schedules: [], reports: [], milestones: [], sessions: []
    };
    persist();
  }

  function persist() {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, file);
  }
  return {
    root, get data() { return data; }, persist,
    id: () => crypto.randomUUID(),
    findUser(id) { return data.users.find((item) => item.id === id); }
  };
}

module.exports = { createStore };
