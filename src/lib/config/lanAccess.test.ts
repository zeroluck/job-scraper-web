import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../../app/api/config/route.ts", import.meta.url),
  "utf8",
);
const repository = readFileSync(
  new URL("./repository.ts", import.meta.url),
  "utf8",
);
const client = readFileSync(
  new URL("../../components/config/ConfigClient.tsx", import.meta.url),
  "utf8",
);

test("configuration API is available without the removed admin authentication gate", () => {
  assert.doesNotMatch(route, /requireAdmin|AuthenticationError|@\/lib\/auth\/admin/);
  assert.match(route, /getScraperConfiguration\(\)/);
  assert.match(route, /replaceScraperConfiguration\(configuration\)/);
});

test("unauthenticated configuration writes retain same-origin and JSON safeguards", () => {
  assert.match(route, /headers\.get\("host"\)/);
  assert.match(route, /Cross-origin configuration updates are not allowed/);
  assert.match(route, /application\/json/);
  assert.match(repository, /createSupabaseServiceClient\(\)/);
  assert.match(repository, /p_actor_id: null/);
  assert.match(repository, /p_actor_email: null/);
});

test("configuration UI no longer presents authentication setup guidance", () => {
  assert.doesNotMatch(client, /AUTHENTICATION_REQUIRED|ADMIN_REQUIRED|ADMIN_EMAILS/);
  assert.match(client, /LAN access/);
});
