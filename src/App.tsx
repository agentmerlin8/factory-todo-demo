import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { addTask, loadTasks, type Task } from "./store";

/**
 * TOD-1 — add a task. Form + list on the store seam (src/store.ts is the
 * only module touching localStorage). Stories TOD-2…TOD-5 extend this
 * shell; ordering, toggling, deleting and filtering land there.
 */
export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [title, setTitle] = useState("");
  const [rejected, setRejected] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
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
      setTasks((current) => [...current, task]);
      setTitle("");
      setRejected(false);
      setStorageFailed(false);
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

      <section className="list-section" aria-label="Tasks">
        <p data-testid="task-count" className="task-count">
          {tasks.length === 1 ? "1 task" : `${tasks.length} tasks`}
        </p>
        {tasks.length > 0 && (
          <ul className="task-list">
            {tasks.map((task) => (
              <li key={task.id} className="task-item">
                <span className="task-dot" aria-hidden="true" />
                <span className="task-title">{task.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="app-footer">
        <p>Saved to this browser only — reload-safe, account-free.</p>
      </footer>
    </main>
  );
}
