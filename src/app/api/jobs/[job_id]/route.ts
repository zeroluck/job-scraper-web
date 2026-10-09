import { NextResponse } from "next/server";
import { getJobById, updateJobById } from "@/lib/supabase/queries";

const ALLOWED_UPDATE_KEYS = new Set([
  "application_date",
  "is_interested",
  "notes",
  "status",
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ job_id: string }> },
) {
  try {
    const { job_id } = await params;
    if (!job_id) {
      return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    }
    const archetypes = new URL(request.url).searchParams
      .getAll("archetype")
      .filter((archetype) => archetype.trim());
    const job = await getJobById(
      job_id,
      archetypes.length ? archetypes : undefined,
    );
    if (!job) {
      return NextResponse.json({ error: `Job with ID ${job_id} not found` }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (error) {
    console.error("API Error fetching job:", error);
    return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 });
  }
}

// Handler for PATCH requests to update a job
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ job_id: string }> }
) {
  try {
    const { job_id } = await params;
    if (!job_id) {
      return NextResponse.json(
        { error: "Job ID is required" },
        { status: 400 }
      );
    }

    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ error: "Invalid update payload" }, { status: 400 });
    }
    const entries = Object.entries(payload);
    if (
      entries.length === 0 ||
      entries.some(([key]) => !ALLOWED_UPDATE_KEYS.has(key))
    ) {
      return NextResponse.json(
        { error: "Only status, application_date, is_interested, and notes may be updated" },
        { status: 400 }
      );
    }
    const updates = Object.fromEntries(entries);

    const updatedJob = await updateJobById(job_id, updates);

    if (!updatedJob) {
      return NextResponse.json(
        { error: `Job with ID ${job_id} not found or update failed` },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedJob, { status: 200 });
  } catch (error) {
    console.error("API Error updating job:", error);
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json(
      { error: "Failed to update job", details: errorMessage },
      { status: 500 }
    );
  }
}
