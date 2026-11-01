import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

test("publication examples use only reserved endpoint names", () => {
  for (const path of ["src/utils/supabase/data.test.ts", "DATA_STORAGE_CUTOVER.md"]) {
    const source = readFileSync(path, "utf8");
    const urls = source.match(/https?:\/\/[^\s'"<>`]+/g) ?? [];
    for (const value of urls) {
      let hostname: string;
      try { hostname = new URL(value).hostname; } catch { continue; }
      assert.ok(
        hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" ||
        hostname.endsWith(".test") || hostname.endsWith(".invalid"),
        `${path}: replace deployment endpoint with a reserved example`,
      );
    }
  }
});

test("database pages remain request-rendered after removing cookie-bound clients", () => {
  for (const path of files("src/app").filter((path) => path.endsWith("/page.tsx"))) {
    const source = readFileSync(path, "utf8");
    if (/lib\/supabase\/(queries|cached)/.test(source)) {
      assert.match(source, /export const dynamic = ["']force-dynamic["']/, path);
    }
  }
});

test("only isolated Storage and unused browser factory reference legacy Supabase credentials", () => {
  for (const path of files("src").filter((path) => /\.tsx?$/.test(path) && !path.includes(".test."))) {
    const source = readFileSync(path, "utf8");
    if (/process\.env\.(NEXT_PUBLIC_SUPABASE|SUPABASE_SERVICE_ROLE_KEY)/.test(source)) {
      assert.ok(["src/utils/supabase/storage.ts", "src/utils/supabase/client.ts"].includes(path), path);
    }
    assert.doesNotMatch(source, /NEXT_PUBLIC_JOB_DATA|NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized\s*:\s*false/, path);
    if (/utils\/supabase\/client/.test(source)) assert.fail(`Browser DB escape hatch: ${path}`);
  }
});
