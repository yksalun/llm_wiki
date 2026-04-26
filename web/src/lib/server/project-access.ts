import type { FileReadResult, ProjectAccessPolicy } from "@/lib/types";

import { AppError } from "./app-error";

const PROJECT_ACCESS_MODE_ENV_KEY = "LLM_WIKI_PROJECT_ACCESS_MODE";

export function getProjectAccessPolicyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectAccessPolicy {
  const mode = env[PROJECT_ACCESS_MODE_ENV_KEY]?.trim();

  if (!mode || mode === "read-write") {
    return {
      mode: "read-write",
      canRead: true,
      canWrite: true,
    };
  }

  if (mode === "read-only") {
    return {
      mode: "read-only",
      canRead: true,
      canWrite: false,
    };
  }

  throw new AppError(
    "PROJECT_ACCESS_MODE_INVALID",
    500,
    "Server project access mode must be read-write or read-only.",
  );
}

export function requireProjectWriteAccess(policy: ProjectAccessPolicy): void {
  if (!policy.canWrite) {
    throw new AppError(
      "PROJECT_ACCESS_READ_ONLY",
      403,
      "This project is currently opened in read-only mode.",
    );
  }
}

export function applyProjectAccessToFile(
  file: FileReadResult,
  policy: ProjectAccessPolicy,
): FileReadResult {
  if (policy.canWrite || !file.editable) {
    return file;
  }

  return {
    ...file,
    mode: "preview",
    editable: false,
    metadata: {
      ...file.metadata,
      accessMode: "read-only",
    },
  };
}
