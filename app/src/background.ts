// Background sync: iOS wakes the app periodically (roughly every few hours, at the system's discretion)
// and we push the latest Health data so the morning check-in has last night's numbers.

import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { syncHealth } from "./health";

export const HEALTH_SYNC = "flow-health-sync";

TaskManager.defineTask(HEALTH_SYNC, async () => {
  try {
    await syncHealth(2);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  await BackgroundTask.registerTaskAsync(HEALTH_SYNC, { minimumInterval: 60 });
}
