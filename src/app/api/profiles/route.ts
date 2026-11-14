import { NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { listProfiles, toProfileSummary } from "@/lib/profiles";
import { runSweepOnce } from "@/lib/sweeper";

export const runtime = "nodejs";

/** List ICP profiles (summaries; research prompts stay server-side). */
export async function GET() {
  try {
    const profiles = withDb((db) => {
      runSweepOnce();
      return listProfiles(db).map(toProfileSummary);
    });
    return NextResponse.json({ profiles });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load profiles.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
