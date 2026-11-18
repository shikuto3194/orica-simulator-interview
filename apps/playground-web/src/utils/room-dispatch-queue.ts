export interface RoomDispatchResult<TState> {
  ok: boolean;
  state?: TState;
}

export interface RoomDispatchTask<TState> {
  signature: string;
  dispatch: () => Promise<RoomDispatchResult<TState>>;
  onDiscard?: () => void;
}

/** active だけでなく queue 末尾との連続重複だけを落とす。 */
export function isDuplicateRoomDispatchSignature(
  signature: string,
  activeSignature: string | null,
  lastQueuedSignature: string | null
): boolean {
  return lastQueuedSignature !== null
    ? lastQueuedSignature === signature
    : activeSignature === signature;
}

interface DrainRoomDispatchQueueOptions<TState> {
  firstTask: RoomDispatchTask<TState>;
  queue: RoomDispatchTask<TState>[];
  onActiveTask: (task: RoomDispatchTask<TState>) => void;
  checkpointSuccessfulState?: (state: TState) => void;
  reconcile: (result: RoomDispatchResult<TState>) => Promise<void>;
}

function discardRoomDispatchTasks<TState>(
  queue: RoomDispatchTask<TState>[],
  firstTask?: RoomDispatchTask<TState>
): void {
  const discarded = firstTask
    ? [firstTask, ...queue.splice(0)]
    : queue.splice(0);
  for (const task of discarded) task.onDiscard?.();
}

/**
 * 連続した room input を順番に送る。中間成功も checkpoint で即時表示し、
 * その後に次の操作を送る。失敗した操作に依存する後続は送らない。
 */
export async function drainRoomDispatchQueue<TState>({
  firstTask,
  queue,
  onActiveTask,
  checkpointSuccessfulState,
  reconcile,
}: DrainRoomDispatchQueueOptions<TState>): Promise<void> {
  let task: RoomDispatchTask<TState> | undefined = firstTask;
  while (task) {
    onActiveTask(task);
    let result: RoomDispatchResult<TState>;
    try {
      result = await task.dispatch();
    } catch (error) {
      discardRoomDispatchTasks(queue);
      throw error;
    }
    if (result.ok && result.state) {
      checkpointSuccessfulState?.(result.state);
    }
    const followUp = queue.shift();
    if (result.ok && followUp) {
      if (!result.state) {
        // version-only success は dispatcher 側の full-state recovery 失敗を示す。
        // stale expectedVersion の後続を送らず、reconcile/polling に委ねる。
        try {
          await reconcile(result);
        } finally {
          discardRoomDispatchTasks(queue, followUp);
        }
        return;
      }
      task = followUp;
      continue;
    }
    if (!result.ok) {
      try {
        await reconcile(result);
      } finally {
        discardRoomDispatchTasks(queue, followUp);
      }
      return;
    }
    await reconcile(result);
    // reconcile が full fetch 等で await している間にも UI から次 input が入りうる。
    task = followUp ?? queue.shift();
  }
}

/** 成否に関係なく dispatch 終了時の authoritative flush を待つ。 */
export async function runTrackedRoomDispatch<T>(
  dispatch: () => Promise<T>,
  onSettled: () => Promise<void> | void
): Promise<T> {
  try {
    return await dispatch();
  } finally {
    await onSettled();
  }
}

/** queue 中に受信済みの state は再取得失敗で失わない。 */
export async function resolveDeferredRoomState<TState>(
  deferredState: TState | null,
  fetchLatestState: () => Promise<TState | null>
): Promise<TState | null> {
  return deferredState ?? (await fetchLatestState());
}

/** 失敗時は再取得を優先し、失敗しても受信済み SSE を checkpoint で潰さない。 */
export async function resolveFailedRoomDispatchState<TState>(
  deferredState: TState | null,
  fetchLatestState: () => Promise<TState | null>,
  checkpointState: TState | null
): Promise<TState | null> {
  return (await fetchLatestState()) ?? deferredState ?? checkpointState;
}
