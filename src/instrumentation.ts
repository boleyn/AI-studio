export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.MONGODB_URI) {
    const { startScheduleWorker } = await import("./server/schedules/worker");
    startScheduleWorker();
    const { startLibraryTrashWorker } = await import("./server/library/trash");
    startLibraryTrashWorker();
  }
}
