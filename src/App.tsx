import { useState } from "react";
import { loadTasks, type Task } from "./store";

/**
 * SKEL-1 scaffold shell. Stories TOD-1…TOD-5 build the real UI on the
 * store seam. This placeholder keeps the build green and the app
 * deployable between stories (expand-first).
 */
export default function App() {
  const [tasks] = useState<Task[]>(() => loadTasks());
  return (
    <main>
      <h1>To-Do</h1>
      <p data-testid="task-count">{tasks.length} tasks</p>
      <p>Factory demo scaffold — stories land here.</p>
    </main>
  );
}