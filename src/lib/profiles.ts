import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Profile, ProfileAttribute, ProfileSummary } from "@/lib/types";

const WEIGHT_SUM_TOLERANCE = 0.001;
const ID_PATTERN = /^[a-z0-9-]+$/;

export function profilesDir() {
  return path.join(process.cwd(), "data", "profiles");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown, min: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

export function validateProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== "object") {
    throw new Error("Profile must be an object.");
  }
  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyString(obj.id) || !ID_PATTERN.test(obj.id)) {
    throw new Error("Profile id must match ^[a-z0-9-]+$.");
  }
  if (!isNonEmptyString(obj.name)) throw new Error("Profile name is required.");
  if (!isNonEmptyString(obj.description)) {
    throw new Error("Profile description is required.");
  }
  if (!Number.isInteger(obj.version) || (obj.version as number) < 1) {
    throw new Error("Profile version must be an integer >= 1.");
  }
  if (!Array.isArray(obj.attributes)) {
    throw new Error("Profile attributes must be an array.");
  }
  if (obj.attributes.length < 4 || obj.attributes.length > 10) {
    throw new Error("Profile must have 4–10 attributes.");
  }

  const seen = new Set<string>();
  const attributes: ProfileAttribute[] = obj.attributes.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Attribute at index ${index} is invalid.`);
    }
    const a = item as Record<string, unknown>;
    if (!isNonEmptyString(a.id) || !ID_PATTERN.test(a.id)) {
      throw new Error(`Attribute id invalid at index ${index}.`);
    }
    if (seen.has(a.id)) {
      throw new Error(`Duplicate attribute id: ${a.id}`);
    }
    seen.add(a.id);
    if (!isNonEmptyString(a.label)) {
      throw new Error(`Attribute ${a.id} missing label.`);
    }
    if (!isNonEmptyString(a.description)) {
      throw new Error(`Attribute ${a.id} missing description.`);
    }
    const weight = Number(a.weight);
    if (!Number.isFinite(weight) || weight < 0.05 || weight > 1) {
      throw new Error(`Attribute ${a.id} weight must be 0.05–1.`);
    }
    if (!isNonEmptyString(a.researchPrompt)) {
      throw new Error(`Attribute ${a.id} missing researchPrompt.`);
    }
    if (!isStringArray(a.positiveSignals, 2)) {
      throw new Error(`Attribute ${a.id} needs ≥2 positiveSignals.`);
    }
    if (!isStringArray(a.negativeSignals, 1)) {
      throw new Error(`Attribute ${a.id} needs ≥1 negativeSignals.`);
    }
    return {
      id: a.id,
      label: a.label.trim(),
      description: a.description.trim(),
      weight,
      researchPrompt: a.researchPrompt.trim(),
      positiveSignals: a.positiveSignals.map((s) => s.trim()),
      negativeSignals: a.negativeSignals.map((s) => s.trim()),
    };
  });

  const weightSum = attributes.reduce((sum, a) => sum + a.weight, 0);
  if (Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new Error(
      `Profile ${obj.id} weights sum to ${weightSum}, expected 1.0 ± ${WEIGHT_SUM_TOLERANCE}.`,
    );
  }

  return {
    id: obj.id,
    name: (obj.name as string).trim(),
    description: (obj.description as string).trim(),
    version: obj.version as number,
    attributes,
  };
}

export function loadProfilesFromDisk(dir = profilesDir()): Profile[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Profiles directory missing: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No profile JSON files in ${dir}`);
  }
  return files.map((file) => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf8"),
    ) as unknown;
    return validateProfile(raw);
  });
}

export function seedProfiles(db: Database.Database, profiles?: Profile[]) {
  const list = profiles ?? loadProfilesFromDisk();
  const upsert = db.prepare(`
    INSERT INTO profiles (id, name, description, version, attributes_json)
    VALUES (@id, @name, @description, @version, @attributes_json)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      version = excluded.version,
      attributes_json = excluded.attributes_json
  `);

  const tx = db.transaction((items: Profile[]) => {
    for (const profile of items) {
      upsert.run({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        version: profile.version,
        attributes_json: JSON.stringify(profile.attributes),
      });
    }
  });
  tx(list);
  return list;
}

function rowToProfile(row: {
  id: string;
  name: string;
  description: string;
  version: number;
  attributes_json: string;
}): Profile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    attributes: JSON.parse(row.attributes_json) as ProfileAttribute[],
  };
}

export function listProfiles(db: Database.Database): Profile[] {
  const rows = db
    .prepare(
      `SELECT id, name, description, version, attributes_json
       FROM profiles ORDER BY name ASC`,
    )
    .all() as Array<{
    id: string;
    name: string;
    description: string;
    version: number;
    attributes_json: string;
  }>;
  return rows.map(rowToProfile);
}

export function getProfile(
  db: Database.Database,
  id: string,
): Profile | null {
  const row = db
    .prepare(
      `SELECT id, name, description, version, attributes_json
       FROM profiles WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        name: string;
        description: string;
        version: number;
        attributes_json: string;
      }
    | undefined;
  return row ? rowToProfile(row) : null;
}

export function toProfileSummary(profile: Profile): ProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    version: profile.version,
    attributeCount: profile.attributes.length,
    attributeLabels: profile.attributes.map((a) => a.label),
  };
}
