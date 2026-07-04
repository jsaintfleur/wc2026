export type ScheduleBucketStatus = "live" | "today" | "future" | "previous";

export type ScheduleBucketInput = {
  iso: string;
  ts: number;
  isLive: boolean;
  isDone: boolean;
};

export type ScheduleBucket<T> = {
  item: T;
  status: ScheduleBucketStatus;
};

export function scheduleBucketStatus(item: ScheduleBucketInput, todayISO: string, nowMs: number): ScheduleBucketStatus {
  if (item.isLive) return "live";
  if (item.isDone) return "previous";
  if (item.iso === todayISO) return "today";
  if (item.iso > todayISO) return "future";
  if (item.ts < nowMs) return "previous";
  return "future";
}

export function bucketScheduleItems<T>(
  items: T[],
  todayISO: string,
  nowMs: number,
  projector: (item: T) => ScheduleBucketInput,
): Record<ScheduleBucketStatus, T[]> {
  const buckets: Record<ScheduleBucketStatus, T[]> = {
    live: [],
    today: [],
    future: [],
    previous: [],
  };

  for (const item of items) {
    buckets[scheduleBucketStatus(projector(item), todayISO, nowMs)].push(item);
  }

  return buckets;
}
