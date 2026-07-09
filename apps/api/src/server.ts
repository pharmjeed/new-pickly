import { config } from "dotenv";
// محلياً يُحمَّل .env من جذر الـmonorepo؛ في السحابة البيئة تأتي من Secret Manager
config({ path: [".env", "../../.env"] });

const { buildApp } = await import("./app.js");

const app = await buildApp();

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
