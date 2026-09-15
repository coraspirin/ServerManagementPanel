import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { jobStatuses } from "@/lib/jobs/runner";
import { JobsScreen } from "./JobsScreen";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const session = await requirePermission("settings.view");

  return (
    <JobsScreen
      initialJobs={jobStatuses()}
      canRun={hasPermission(session.user, "settings.edit")}
    />
  );
}
