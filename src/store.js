const fs = require('fs');
const path = require('path');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { tasks: [], settings: {} };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          this.data = parsed;
        }
      }
    } catch (e) {
      this.data = { tasks: [], settings: {} };
    }
    if (!Array.isArray(this.data.tasks)) this.data.tasks = [];
    if (!this.data.settings || typeof this.data.settings !== 'object') this.data.settings = {};
    if (!Array.isArray(this.data.memory)) this.data.memory = [];
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      try {
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (e2) {}
    }
  }
}

module.exports = Store;
