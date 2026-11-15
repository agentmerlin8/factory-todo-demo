import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { addTask, loadTasks, sortNewestFirst, type Task } from "./store";

/**
 * TOD-1 — add a task; TOD-2 — list tasks. Form + list on the store seam
 * (src/store.ts is the only module touching localStorage). Ordering and the
 * empty state live here; toggling, deleting and filtering land in TOD-3…5.
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
              <li key={task.id} className="task-item">
                <span className="task-dot" aria-hidden="true" />
                <span className="task-title">{task.title}</span>
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
