/**
 * store.ts — the ONLY module that touches localStorage (design §3).
 *
 * SKEL-1 scaffold: types + persistence helpers + subscription seam.
 * Story TOD-1 adds the first real operations; each story extends this
 * module. No story reads/writes localStorage directly.
 */

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

export type Filter = "all" | "active" | "completed";

const STORAGE_KEY = "todo-demo:tasks";
const FILTER_KEY = "todo-demo:filter";

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

/**
 * Runtime guard for one stored entry. Storage is an UNTRUSTED boundary: the
 * JSON may be written by an older version, another tab, or a user with
 * devtools. `Array.isArray` alone lets `[null]` or `[{}]` reach the render
 * and throw during mount, so every field is validated here, once.
 */
export function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    t.id.length > 0 &&
    typeof t.title === "string" &&
    typeof t.completed === "boolean" &&
    typeof t.createdAt === "number" &&
    Number.isFinite(t.createdAt)
  );
}

export function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop malformed entries instead of crashing the mount. Dedupe by id so a
    // corrupt store cannot produce duplicate React keys.
    const seen = new Set<string>();
    const tasks: Task[] = [];
    for (const entry of parsed) {
      if (!isTask(entry) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      tasks.push(entry);
    }
    return tasks;
  } catch {
    return [];
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  emit();
}

/**
 * TOD-2 — newest-first ordering. Pure: returns a new array, never mutates
 * the input (loadTasks hands out fresh arrays, but callers may hold their
 * own). Array.prototype.sort is stable (ES2019+), so tasks sharing a
 * createdAt keep their stored order — no secondary tiebreaker needed.
 */
export function sortNewestFirst(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Append records with the read and the write in ONE synchronous step.
 *
 * A caller that reads, does work, then writes always has a window where
 * another tab can commit; merging BEFORE the write does not close it (the
 * window is between the merge-read and setItem). Here the current state is
 * read immediately before setItem with nothing in between, so a concurrent
 * commit is either already visible (and preserved) or lands after ours.
 *
 * localStorage has no compare-and-swap, so this narrows the window to the
 * minimum the platform allows rather than eliminating it. Cross-tab
 * atomicity would need the Web Locks API; that is a deliberate follow-up,
 * not something this function claims to provide.
 */
export function appendTasks(incoming: Task[]): Task[] {
  const current = loadTasks();
  const byId = new Map(current.map((t) => [t.id, t]));
  for (const t of incoming) {
    if (!byId.has(t.id)) byId.set(t.id, t);
  }
  const merged = [...byId.values()];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  emit();
  return merged;
}

export function loadFilter(): Filter {
  const raw = localStorage.getItem(FILTER_KEY);
  return raw === "active" || raw === "completed" ? raw : "all";
}

export function saveFilter(filter: Filter): void {
  localStorage.setItem(FILTER_KEY, filter);
  emit();
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * TOD-1 — add a task. Trims the title; empty/whitespace-only titles are
 * rejected (returns null, store untouched, no notification). Persistence
 * and notification go through the same seam every later story extends.
 * Returns the created task so callers can update their view immediately.
 */
/**
 * Append a task without clobbering a concurrent writer.
 *
 * localStorage has no compare-and-swap, so a plain read-modify-write loses
 * updates when two tabs interleave (both read the same list, both write, the
 * second erases the first). We cannot make the pair atomic, but we can make
 * the WRITE a merge: re-read immediately before persisting and union by id.
 * That narrows the window to a single synchronous read+write and, crucially,
 * never drops a record another tab already committed.
 */
export function addTask(title: string): Task | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const task: Task = {
    id: newId(),
    title: trimmed,
    completed: false,
    createdAt: Date.now(),
  };
  // Single synchronous read+merge+write; see appendTasks for the guarantee
  // and its limit.
  appendTasks([task]);
  return task;
}

/**
 * TOD-3 — flip one task's `completed` flag. Same merge discipline as
 * appendTasks: re-read immediately before the write and union by id, so a
 * task another tab committed is never dropped. Our toggle is applied to
 * the FRESH copy (last-writer-wins for the flag itself — localStorage has
 * no compare-and-swap; the window is narrowed, not eliminated). Returns
 * the updated task, or null when the id is unknown (no write, no
 * notification). A storage failure propagates BEFORE emit and before any
 * caller can render the new state — nothing unsaved is ever announced
 * (TOD-3 AC5).
 */
export function toggleTask(id: string): Task | null {
  const current = loadTasks();
  if (!current.some((t) => t.id === id)) return null;
  // Re-read + merge immediately before setItem (see appendTasks). A plain
  // array overwrite here would drop a concurrent tab's committed task —
  // mutation-proven in the round-1 review probe.
  const fresh = loadTasks();
  const byId = new Map(fresh.map((t) => [t.id, t]));
  const base = byId.get(id);
  if (!base) return null; // removed by another tab between reads
  const toggled: Task = { ...base, completed: !base.completed };
  byId.set(id, toggled);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...byId.values()]));
  emit();
  return toggled;
}
