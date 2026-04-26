import { getProjectRootsFromEnv } from "@/lib/server/env";
import { scanProjectRoots } from "@/lib/server/project-registry";
import { errorJson, okJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const roots = getProjectRootsFromEnv();
    const payload = await scanProjectRoots(roots);

    return okJson({
      ...payload,
      warnings: payload.warnings.map(sanitizeWarning),
    });
  } catch (error) {
    return errorJson(error);
  }
}

function sanitizeWarning(): string {
  return "无法扫描已配置的项目根目录。";
}
