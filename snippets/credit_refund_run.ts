// Excerpt from Kinetica (src/server/jobs.ts). Shown for illustration only.
// The full source code is available at https://store.mikodes.com/p/kinetica/
//
// Credits for AI storyboard runs. Starting a run charges credits and marks the video as
// "planning" in one transaction. A run ends exactly once, because each end is a conditional
// UPDATE, so a failure refunds the credits once and a late answer is ignored.

/**
 * Charge and mark the project "planning" in one transaction. A retry only starts from "failed" (two
 * clicks cannot start two runs). Not enough credits: nothing changes and the 402 goes to the caller.
 */
export function beginPlanRun(svc: Services, o: PlanRunStart): string {
  const id = uid("pln");
  const now = svc.now();
  svc.db.transaction(() => {
    const moved = svc.db.prepare(`UPDATE projects SET status = 'planning', error = '', updated_at = ? WHERE id = ?${o.retry ? " AND status = 'failed'" : ""}`).run(now, o.projectId);
    if (!moved.changes) throw new HttpError(409, o.retry ? "Only a failed storyboard can be retried." : "Video not found");
    debitCredits(svc.db, o.workspaceId, o.cost, o.label, o.userId, now, o.projectId);
    svc.db.prepare("INSERT INTO plan_runs (id, project_id, workspace_id, user_id, credits, label, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)")
      .run(id, o.projectId, o.workspaceId, o.userId, Math.max(0, o.cost), o.label.slice(0, 120), now);
  })();
  return id;
}

// …

/** End a run as failed: the project shows the error and the run's credits come back, once. False if it had already ended. */
export function failPlanRun(svc: Services, runId: string, message: string): boolean {
  return svc.db.transaction(() => {
    const now = svc.now();
    const msg = message.slice(0, 400);
    const ended = svc.db.prepare("UPDATE plan_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(msg, now, runId);
    if (!ended.changes) return false;
    const run = svc.db.prepare("SELECT project_id, workspace_id, user_id, credits, label FROM plan_runs WHERE id = ?").get(runId) as { project_id: string; workspace_id: string; user_id: string | null; credits: number; label: string };
    svc.db.prepare("UPDATE projects SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'planning'").run(msg, now, run.project_id);
    const userLeft = run.user_id && svc.db.prepare("SELECT 1 FROM users WHERE id = ?").get(run.user_id) ? run.user_id : null;
    if (run.credits > 0 && svc.db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(run.workspace_id)) {
      addCredits(svc.db, run.workspace_id, run.credits, `Refund: ${run.label} failed`, run.project_id, userLeft, now);
    }
    return true;
  })();
}

/** Run the AI part of a plan run in the background; its result ends the run (done or failed + refund). */
export function runPlanInBackground(svc: Services, runId: string, projectId: string, work: () => Promise<{ board: Storyboard; missing: string[] }>, versionLabel: string): Promise<void> {
