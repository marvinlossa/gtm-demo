import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listProfiles, toProfileSummary } from "@/lib/profiles";

export const runtime = "nodejs";

/** List ICP profiles (summaries; research prompts stay server-side). */
export async function GET() {
  try {
    const db = getDb();
    const profiles = listProfiles(db).map(toProfileSummary);
    return NextResponse.json({ profiles });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load profiles.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
