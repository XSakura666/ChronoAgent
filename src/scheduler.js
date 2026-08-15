class Scheduler {
  constructor({ store, runDue, onUpdate, intervalMs = 15000, isCatchUp = () => true }) {
    this.store = store;
    this.runDue = runDue;
    this.onUpdate = onUpdate;
    this.intervalMs = intervalMs;
    this.isCatchUp = isCatchUp;
    this.running = false;
    this.startedAt = Date.now();
  }

  start() {
    this.stop();
    this.timer = setInterval(() => { this.tick(); }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick() {
    if (this.running) return;
    const now = Date.now();
    const due = this.store.data.tasks.filter(t => t.status === 'pending' && t.scheduledAt && t.scheduledAt <= now);
    if (!due.length) return;
    this.running = true;
    try {
      const skipped = due.filter(t => t.scheduledAt <= this.startedAt && !this.isCatchUp());
      const runnable = due.filter(t => !(t.scheduledAt <= this.startedAt && !this.isCatchUp()));
      for (const t of skipped) {
        t.status = 'skipped';
        t.result = '任务在应用关闭期间已过期，且未开启“错过补跑”。';
        this.store.save();
        if (this.onUpdate) this.onUpdate();
      }
      if (runnable.length && this.runDue) await this.runDue(runnable);
    } finally {
      this.running = false;
    }
  }
}

module.exports = Scheduler;
