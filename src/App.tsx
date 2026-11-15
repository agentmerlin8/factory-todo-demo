import { useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  addTask,
  deleteTask,
  loadTasks,
  sortNewestFirst,
  toggleTask,
  type Task,
} from "./store";

/**
 * TOD-1 — add a task; TOD-2 — list tasks; TOD-3 — complete/uncomplete;
 * TOD-4 — delete a task. Form + list on the store seam (src/store.ts is
 * the only module touching localStorage). Ordering and the empty state
 * live here; filtering lands in TOD-5.
 */
export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => sortNewestFirst(loadTasks()));
  const [title, setTitle] = useState("");
  const [rejected, setRejected] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  // Polite live region: every successful mutation is announced, not just
  // errors. A sighted user sees the list change; a screen-reader user must
  // be told, or the action is silent (round-5 finding).
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
      // otherwise announce only once. The count is both distinct per add and
      // useful information ("3 tasks" tells the user where they stand).
      setAnnouncement(
        `Added ${task.title}. ${next.length} ${next.length === 1 ? "task" : "tasks"}.`,
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
      // same class as the TOD-1 add announcement).
      const done = next.filter((t) => t.completed).length;
      setAnnouncement(
        toggled.completed
          ? `Completed ${toggled.title}. ${done} of ${next.length} done.`
          : `Marked ${toggled.title} as active. ${done} of ${next.length} done.`,
      );
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
      setAnnouncement(
        `Deleted ${result.task.title}. ${next.length} ${next.length === 1 ? "task" : "tasks"} left.`,
      );
      // The deleted row's button may have owned keyboard focus; removing
      // it drops focus to the body. Move to a surviving delete control, or
      // the new-task input as the stable fallback (round-2 finding). The
      // survivor may be a task another tab just added — its button is not
      // mounted yet (React batches setTasks), so fall back whenever the
      // lookup misses, not only when the committed list is empty (round-3).
      const survivor = next.find((t) => t.id !== id);
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

      <section className="list-section" aria-label="Tasks">
        <p data-testid="task-count" className="task-count">
          {tasks.length === 1 ? "1 task" : `${tasks.length} tasks`}
        </p>
        {tasks.length > 0 ? (
          <ul className="task-list">
            {tasks.map((task) => (
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
          <p data-testid="empty-state" className="tagline">
            Nothing here yet — add your first task above.
          </p>
        )}
      </section>

      <footer className="app-footer">
        <p>Saved to this browser only — reload-safe, account-free.</p>
      </footer>
    </main>
  );
}
