import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import { buildServer } from "./server.ts";

loadEnv();
const handle = await createDb(databaseUrlFromEnv());
const app = await buildServer(handle);
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
