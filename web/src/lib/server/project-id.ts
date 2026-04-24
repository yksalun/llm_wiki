import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

interface ProjectRegistryRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface EnsureProjectRegistryOptions {
  now?: () => Date;
  preferredId?: string;
  preferredName?: string;
}

const PROJECT_REGISTRY_DIR = ".llm-wiki";
const PROJECT_REGISTRY_FILE = "project.json";

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  return !Number.isNaN(new Date(value).valueOf());
}

function isProjectRegistryRecord(value: unknown): value is ProjectRegistryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectRegistryRecord>;

  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.name === "string" &&
    record.name.length > 0 &&
    isIsoTimestamp(record.createdAt) &&
    isIsoTimestamp(record.updatedAt)
  );
}

export function getProjectRegistryPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_REGISTRY_DIR, PROJECT_REGISTRY_FILE);
}

export async function readProjectRegistry(projectRoot: string): Promise<ProjectRegistryRecord | null> {
  try {
    const content = await fs.readFile(getProjectRegistryPath(projectRoot), "utf8");
    const parsed = JSON.parse(content) as unknown;

    return isProjectRegistryRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function ensureProjectRegistry(
  projectRoot: string,
  options: EnsureProjectRegistryOptions = {},
): Promise<ProjectRegistryRecord> {
  const now = (options.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const projectName = options.preferredName ?? path.basename(projectRoot);
  const registryPath = getProjectRegistryPath(projectRoot);
  const existingRegistry = await readProjectRegistry(projectRoot);

  if (existingRegistry) {
    return existingRegistry;
  }

  const record: ProjectRegistryRecord = {
    id: options.preferredId ?? crypto.randomUUID(),
    name: projectName,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  return record;
}
