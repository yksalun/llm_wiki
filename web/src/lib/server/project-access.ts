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
    "服务器项目访问模式配置无效。",
  );
}

export function requireProjectWriteAccess(policy: ProjectAccessPolicy): void {
  if (!policy.canWrite) {
    throw new AppError(
      "PROJECT_ACCESS_READ_ONLY",
      403,
      "当前项目以只读模式打开。",
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
