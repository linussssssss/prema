import { createDb, databaseUrlFromEnv } from "../db.ts";
import { loadEnv } from "../env.ts";

loadEnv();
const handle = await createDb(databaseUrlFromEnv());
try {
  await handle.migrate();
  console.log(JSON.stringify({ level: "info", msg: "migrations applied", driver: handle.driver }));
} finally {
  await handle.close();
}
