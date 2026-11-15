import { useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  addTask,
  deleteTask,
  filterTasks,
  loadFilter,
  loadTasks,
  saveFilter,
  sortNewestFirst,
  toggleTask,
  type Filter,
  type Task,
} from "./store";

/**
 * TOD-1 — add a task; TOD-2 — list tasks; TOD-3 — complete/uncomplete;
 * TOD-4 — delete a task; TOD-5 — filter view. Form + list on the store
 * seam (src/store.ts is the only module touching localStorage). Ordering,
 * the empty state and filtering live here; the store owns persistence.
 */
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

function viewLabel(filter: Filter): string {
  return filter === "all" ? "all tasks" : `${filter} tasks`;
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => sortNewestFirst(loadTasks()));
  const [filter, setFilter] = useState<Filter>(() => loadFilter());
  const [title, setTitle] = useState("");
  const [rejected, setRejected] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  // Polite live region: every successful mutation is announced, not just
  // errors. A sighted user sees the list change; a screen-reader user must
  // be told, or the action is silent (round-5 finding).
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic addition sequence: under a filter that HIDES new tasks
  // (Completed), the visible count never changes on add, so same-title
  // adds would produce identical live-region text and the second success
  // would never re-announce (round-2 finding). The sequence guarantees
  // distinct text per add regardless of view.
  const addSeq = useRef(0);
  // TOD-5 AC2: the visible list is the filtered subset; the count reflects
  // it. `tasks` stays the FULL committed list so filtering never touches
  // task data (AC4) and hidden tasks survive mutations.
  const visible = filterTasks(tasks, filter);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const task = addTask(title);
      if (!task) {
        // AC2: empty/whitespace rejected — no task created, input keeps focus.
        setRejected(true);
        inputRef.current?.focus();
        return;
      }
      // Read back from the store, not from React state: another tab may have
      // persisted tasks since this component last rendered. Spreading stale
      // `tasks` would silently drop them until reload. Order at the view
      // boundary so adds and reloads both render newest-first (TOD-2 AC1).
      const next = sortNewestFirst(loadTasks());
      setTasks(next);
      setTitle("");
      setRejected(false);
      setStorageFailed(false);
      // Include the running total: identical live-region text does NOT
      // re-trigger an announcement, so two tasks with the same title would
      // otherwise announce only once. Under a filter the spoken count must
      // match the VISIBLE count, not the full total (round-1 MINOR-1).
      // The addition sequence keeps text distinct even when the visible
      // count cannot change (Completed view hides new active tasks).
      const shown = filterTasks(next, filter).length;
      addSeq.current += 1;
      setAnnouncement(
        `Added ${task.title}. ${shown} ${shown === 1 ? "task" : "tasks"} shown. Addition ${addSeq.current}.`,
      );
      inputRef.current?.focus();
    } catch {
      setStorageFailed(true);
      inputRef.current?.focus();
    }
  }

  function handleToggle(id: string) {
    try {
      const result = toggleTask(id);
      if (!result) return;
      const toggled = result.task;
      // Render from the COMMITTED snapshot the store just wrote — a
      // post-write readback is a fresh fallible I/O that can fail after a
      // successful save and wipe the visible list (round-3 finding).
      const next = sortNewestFirst(result.tasks);
      setTasks(next);
      setStorageFailed(false);
      // A successful mutation also clears any pending blank-input rejection:
      // the shared alert prioritizes `rejected`, which would otherwise keep
      // showing "Give the task a name" after a successful toggle (round-1
      // finding; same class as the failure-path masking fixed in TOD-3).
      setRejected(false);
      // Include the completed count: direction-specific wording alone does
      // NOT distinguish completing two DIFFERENT tasks with the same title
      // (identical live-region text never re-announces — round-2 finding,
      // same class as the TOD-1 add announcement). Counts reflect the
      // VISIBLE (filtered) set so spoken and displayed numerics agree
      // (round-1 MINOR-1).
      const inView = filterTasks(next, filter);
      const done = inView.filter((t) => t.completed).length;
      setAnnouncement(
        toggled.completed
          ? `Completed ${toggled.title}. ${done} of ${inView.length} shown done.`
          : `Marked ${toggled.title} as active. ${done} of ${inView.length} shown done.`,
      );
      // TOD-5: under a filter the toggled row may leave the view (completing
      // under Active, un-completing under Completed). Its checkbox unmounts
      // and focus would drop to the body — move to a surviving IN-VIEW
      // control, or the input when the lookup misses (TOD-4's pattern).
      if (!inView.some((t) => t.id === id)) {
        const survivor = inView[0];
        const survivorBtn = survivor
          ? document.getElementById(`task-delete-${survivor.id}`)
          : null;
        if (survivorBtn) {
          survivorBtn.focus();
        } else {
          inputRef.current?.focus();
        }
      }
    } catch {
      // AC5: `tasks` is untouched, so the controlled checkbox reverts to the
      // persisted state on re-render — the UI never shows an unsaved flip.
      // The failure surfaces on the same assertive alert the add form uses.
      // Clear a pending blank-input rejection first: the shared alert
      // prioritizes `rejected`, which would otherwise mask the storage
      // error with "Give the task a name" (round-2 finding).
      setRejected(false);
      setStorageFailed(true);
    }
  }

  function handleDelete(id: string) {
    try {
      const result = deleteTask(id);
      if (!result) {
        // Another tab already deleted this task. Drop the obsolete row from
        // local state — no storage read/write, no deletion announcement
        // (nothing was deleted HERE). Round-2 finding: the early return
        // left a stale row and count, even for the last task.
        setTasks((prev) => prev.filter((t) => t.id !== id));
        inputRef.current?.focus();
        return;
      }
      // Render from the COMMITTED snapshot — no post-write readback, same
      // contract as toggle (a fallible read after a successful save can
      // wipe the visible list).
      const next = sortNewestFirst(result.tasks);
      setTasks(next);
      setStorageFailed(false);
      // Clear a pending blank-input rejection on success too — a stale
      // assertive "Give the task a name" after a successful delete is
      // misleading (round-1 finding, same class as the toggle path).
      setRejected(false);
      // Operation-specific wording plus the remaining count: two deletes
      // of same-title tasks must still re-announce (identical live-region
      // text never fires twice — same class as the add/toggle findings).
      // The count reflects the VISIBLE (filtered) set (round-1 MINOR-1).
      const shown = filterTasks(next, filter).length;
      setAnnouncement(
        `Deleted ${result.task.title}. ${shown} ${shown === 1 ? "task" : "tasks"} left in view.`,
      );
      // The deleted row's button may have owned keyboard focus; removing
      // it drops focus to the body. Move to a surviving IN-VIEW delete
      // control (a task hidden by the filter has no mounted button), or
      // the new-task input as the stable fallback (round-2 finding). The
      // survivor may be a task another tab just added — its button is not
      // mounted yet (React batches setTasks), so fall back whenever the
      // lookup misses, not only when the committed list is empty (round-3).
      const survivor = filterTasks(next, filter).find((t) => t.id !== id);
      const survivorBtn = survivor
        ? document.getElementById(`task-delete-${survivor.id}`)
        : null;
      if (survivorBtn) {
        survivorBtn.focus();
      } else {
        inputRef.current?.focus();
      }
    } catch {
      // AC5: `tasks` is untouched, so the row stays visible while the store
      // still holds it — no silent loss. Shared assertive alert; clear the
      // blank-input flag first so it cannot mask the storage error.
      setRejected(false);
      setStorageFailed(true);
    }
  }

  function handleFilter(next: Filter) {
    try {
      // AC4: persist ONLY the filter key — never the task data. The visible
      // subset is derived from the full `tasks` state at render time.
      saveFilter(next);
      setFilter(next);
      setRejected(false);
      setStorageFailed(false);
      // Announce the new view and its filtered count (polite region). The
      // label + count differ per selection, so switches always re-announce.
      const count = filterTasks(tasks, next).length;
      setAnnouncement(
        `Showing ${viewLabel(next)}. ${count} ${count === 1 ? "task" : "tasks"}.`,
      );
    } catch {
      // A failed persist leaves the selection unchanged — no unsaved view
      // is ever shown. Shared assertive alert; clear the blank-input flag
      // first so it cannot mask the storage error.
      setRejected(false);
      setStorageFailed(true);
    }
  }

  return (
    <main className="app">
      <header className="app-header">
        <p className="eyebrow">local-first · no account</p>
        <h1>To-Do</h1>
        <p className="tagline">Small steps, written down.</p>
      </header>

      <form className="add-form" onSubmit={handleSubmit} noValidate>
        <label className="visually-hidden" htmlFor="new-task">
          New task
        </label>
        <div className={rejected ? "add-row add-row--rejected" : "add-row"}>
          <input
            id="new-task"
            ref={inputRef}
            className="add-input"
            type="text"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (rejected) setRejected(false);
              if (storageFailed) setStorageFailed(false);
            }}
            placeholder="What needs doing?"
            autoComplete="off"
            autoFocus
            aria-invalid={rejected}
            aria-describedby="add-hint"
          />
          <button className="add-button" type="submit">
            Add
          </button>
        </div>
        <p
          id="add-hint"
          className={
            rejected || storageFailed
              ? "add-hint add-hint--error"
              : "add-hint"
          }
          role={rejected || storageFailed ? "alert" : undefined}
        >
          {rejected
            ? "Give the task a name — blank tasks don’t count."
            : storageFailed
              ? "Task couldn’t be saved. Check browser storage and try again."
              : "Press Enter or hit Add. Everything stays in this browser."}
        </p>
      </form>

      {/* Always mounted: a live region added at the same time as its text is
          frequently missed by screen readers. */}
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {/* TOD-5 AC1: All / Active / Completed. Toggle buttons carry
          aria-pressed so the selection is exposed to assistive tech; the
          group is labelled for screen readers. */}
      <div className="filter-bar" role="group" aria-label="Filter tasks">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="filter-button"
            aria-pressed={filter === value}
            onClick={() => handleFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="list-section" aria-label="Tasks">
        <p data-testid="task-count" className="task-count">
          {visible.length === 1 ? "1 task" : `${visible.length} tasks`}
        </p>
        {visible.length > 0 ? (
          <ul className="task-list">
            {visible.map((task) => (
              <li
                key={task.id}
                className={
                  task.completed ? "task-item task-item--completed" : "task-item"
                }
              >
                {/* TOD-3 AC1: the checkbox takes the marker slot the decorative
                    dot held. Controlled by the store-backed state, so a failed
                    persist reverts it (AC5) instead of showing an unsaved flip.
                    The title is a real <label>, so clicking the text toggles
                    too (round-1 MINOR-3). */}
                <input
                  id={`task-toggle-${task.id}`}
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => handleToggle(task.id)}
                />
                <label className="task-title" htmlFor={`task-toggle-${task.id}`}>
                  {task.title}
                </label>
                {/* TOD-4 AC1: per-task delete, named for screen readers via
                    aria-label; the ✕ glyph is CSS content so the row's text
                    stays the task title alone. type="button" — never submits
                    the add form. */}
                <button
                  id={`task-delete-${task.id}`}
                  type="button"
                  className="task-delete"
                  aria-label={`Delete ${task.title}`}
                  onClick={() => handleDelete(task.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          // TOD-2 AC2/AC5: empty (or corrupt) store renders a friendly line,
          // never a blank section. Reuses the theme's .tagline — no new CSS.
          // TOD-5 round-1 MINOR-2: tasks hidden behind the filter are NOT
          // "nothing here yet" — say what the view is missing.
          <p data-testid="empty-state" className="tagline">
            {tasks.length === 0
              ? "Nothing here yet — add your first task above."
              : `No ${filter} tasks right now.`}
          </p>
        )}
      </section>

      <footer className="app-footer">
        <p>Saved to this browser only — reload-safe, account-free.</p>
      </footer>
    </main>
  );
}
