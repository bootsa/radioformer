import { join } from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { SqliteLibrary } from './library.ts';

const config = loadConfig();
const library = new SqliteLibrary(openDb(join(config.DATA_DIR, 'radioformer.db')));
const app = await buildApp(config, library);

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port: config.PORT, host: config.HOST });
