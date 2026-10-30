import { createApp } from './app';
import { openDatabase } from './db/migrate';

const port = Number(process.env.PORT) || 3001;
// Saved projects must survive restarts — the server owns the on-disk database;
// createApp() without a db override only opens in-memory databases for tests.
const dbPath = process.env.SYNCRO_DB_PATH ?? 'syncro.db';

createApp({ db: openDatabase(dbPath) }).listen(port, () => {
  console.log(`[syncro-server] listening on http://localhost:${port} (database: ${dbPath})`);
});
