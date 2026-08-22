import { createDb, databaseUrlFromEnv } from "../db.ts";

const handle = await createDb(databaseUrlFromEnv());
try {
  await handle.migrate();
  console.log(JSON.stringify({ level: "info", msg: "migrations applied", driver: handle.driver }));
} finally {
  await handle.close();
}
