import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import type { BackgroundSchedulerPort } from "../../coach/ports";
import { runNativeRecipeCatchUp } from "./BackgroundRecipeWorker";

export const MAXPOWER_RECIPE_CATCH_UP_TASK = "maxpower.recipe.catch-up.v1";

/**
 * Expo's scheduler is intentionally windowed, not an alarm API. It wakes the
 * local recipe catch-up path after an app exit; precise user reminders are
 * scheduled directly through ExpoNotificationPort when they are confirmed.
 */
// Expo launches this from the JS bundle without mounting React, so this must
// remain at module scope rather than inside a component or an adapter method.
if (!TaskManager.isTaskDefined(MAXPOWER_RECIPE_CATCH_UP_TASK)) {
  TaskManager.defineTask(MAXPOWER_RECIPE_CATCH_UP_TASK, async () => {
    try {
      await runNativeRecipeCatchUp();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export function createExpoBackgroundSchedulerPort(): BackgroundSchedulerPort {
  const jobs = new Map<string, { id: string; earliestAt: string; latestAt: string; expiresAt: string }>();
  let registered = false;

  const ensureRegistered = async (): Promise<void> => {
    if (registered || await TaskManager.isTaskRegisteredAsync(MAXPOWER_RECIPE_CATCH_UP_TASK)) {
      registered = true;
      return;
    }
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
      throw new Error("native_background_task_unavailable");
    }
    // The OS treats this as a minimum/best-effort delay. It must not be used
    // as a promise of an exact delivery time.
    await BackgroundTask.registerTaskAsync(MAXPOWER_RECIPE_CATCH_UP_TASK, { minimumInterval: 15 });
    registered = true;
  };

  return {
    async upsert(job) {
      jobs.set(job.id, { ...job });
      await ensureRegistered();
    },
    async cancel(id) {
      jobs.delete(id);
      // Keep the single catch-up task registered. Task registration is shared
      // and persistent; cancelling one recipe must never silently disable
      // another local user's pending recovery work.
    },
    async list() {
      return [...jobs.values()];
    },
  };
}
