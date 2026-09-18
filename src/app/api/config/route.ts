import { NextResponse } from "next/server";

import { getScraperConfiguration, replaceScraperConfiguration } from "@/lib/config/repository";
import { ConfigurationValidationError, validateConfiguration } from "@/lib/config/validation";
import { ConfigurationConflictError } from "@/lib/config/conflict";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof ConfigurationValidationError) {
    return NextResponse.json({ error: "Invalid configuration", issues: error.issues }, { status: 400 });
  }
  if (error instanceof ConfigurationConflictError) {
    return NextResponse.json(
      { error: error.message, code: error.code, action: "reload" },
      { status: 409, headers: { "Cache-Control": "no-store, private" } },
    );
  }
  console.error("Configuration API error:", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Configuration request failed" },
    { status: 500 },
  );
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  return origin === `${url.protocol}//${host}`;
}

export async function GET() {
  try {
    const configuration = await getScraperConfiguration();
    return NextResponse.json({ data: configuration }, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json(
        { error: "Cross-origin configuration updates are not allowed" },
        { status: 403, headers: { "Cache-Control": "no-store, private" } },
      );
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }
    const raw: unknown = await request.json();
    const configuration = validateConfiguration(raw);
    const saved = await replaceScraperConfiguration(configuration);
    return NextResponse.json({ data: saved }, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
