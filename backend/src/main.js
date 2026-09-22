import { config } from './config.js';
import { createApp } from './server.js';
import { runLifecycleJobs } from './services/bookings.js';

const app = createApp();
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Pandal backend on ${config.publicBaseUrl}  (env=${config.env}, db=${config.dbPath})`);
});

// Lifecycle jobs: release lapsed holds, reminders, auto-complete past events.
const tick = () => {
  try {
    const r = runLifecycleJobs();
    if (r.released || r.upcoming || r.completed) console.log('[jobs]', r);
  } catch (e) {
    console.error('[jobs] failed', e);
  }
};
tick();
setInterval(tick, 60_000);
