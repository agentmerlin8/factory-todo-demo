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

export function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  emit();
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