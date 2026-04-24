import { notFound } from "next/navigation";

import { ProjectWorkbench } from "@/components/workbench/project-workbench";
import { AppError } from "@/lib/server/app-error";
import { getProjectRootsFromEnv } from "@/lib/server/env";
import { resolveProjectById } from "@/lib/server/project-registry";

interface ProjectWorkbenchPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectWorkbenchPage({
  params,
}: ProjectWorkbenchPageProps) {
  const { projectId } = await params;

  try {
    await resolveProjectById(getProjectRootsFromEnv(), projectId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      notFound();
    }

    throw error;
  }

  return <ProjectWorkbench projectId={projectId} />;
}
