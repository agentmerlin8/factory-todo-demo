/// <reference types="node" />
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import App from "./App";
import { loadTasks, saveTasks } from "./store";

// The real stylesheet, read from disk and injected only where computed style
// is asserted: vitest runs with css:false, which stubs CSS imports (?raw and
// ?inline both come back empty), so a disk read is the only way to test the
// actual theme without touching the vitest config. Anchored to this file,
// not the cwd, so it survives runners invoked from elsewhere.
const themeCss = readFileSync(join(__dirname, "index.css"), "utf8");

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TOD-1 — add a task", () => {
  it("typing + Add creates a visible task", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "Buy oat milk");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.getByRole("listitem")).toHaveTextContent("Buy oat milk");
    expect(input).toHaveValue("");
    expect(loadTasks().map((t) => t.title)).toEqual(["Buy oat milk"]);
  });

  it("Enter submits", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "Ship the demo{Enter}");

    expect(screen.getByRole("listitem")).toHaveTextContent("Ship the demo");
    expect(loadTasks().map((t) => t.title)).toEqual(["Ship the demo"]);
    expect(input).toHaveValue(""); // review nit: assert input clears after submit
  });

  it("whitespace-only input is rejected and the input keeps focus", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.queryByRole("listitem")).toBeNull();
    expect(loadTasks()).toEqual([]);
    expect(input).toHaveFocus();
  });

  it("empty input is rejected and the input keeps focus", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.queryByRole("listitem")).toBeNull();
    expect(loadTasks()).toEqual([]);
    expect(input).toHaveFocus();
  });

  it("retains the draft and reports storage failures accessibly", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "Keep this draft");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Task couldn’t be saved. Check browser storage and try again.",
    );
    expect(input).toHaveValue("Keep this draft");
    expect(input).toHaveFocus();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("new tasks appear immediately and accumulate in the list", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "First{Enter}");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.type(input, "Second{Enter}");

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // TOD-2 owns render order (newest-first); this test only asserts that
    // both adds accumulate. Strict ordering is covered by the TOD-2 tests
    // with fixed timestamps, so same-millisecond adds cannot flake here.
    const titles = items.map((n) => n.textContent);
    expect(titles.some((t) => t?.includes("First"))).toBe(true);
    expect(titles.some((t) => t?.includes("Second"))).toBe(true);
    expect(input).toHaveFocus();
  });

  it("reload restores the task (store round-trip)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.type(
      screen.getByRole("textbox", { name: /new task/i }),
      "Persist me{Enter}",
    );
    expect(loadTasks().map((t) => t.title)).toEqual(["Persist me"]);

    // Simulate a page reload: tear down the tree, mount fresh from the store.
    unmount();
    render(<App />);
    expect(screen.getByRole("listitem")).toHaveTextContent("Persist me");
  });
});

describe("malformed storage does not break mount (round-3 regression)", () => {
  it("renders the empty state when stored entries are null", () => {
    localStorage.setItem("todo-demo:tasks", "[null]");
    render(<App />);
    expect(screen.getByRole("heading", { name: /to-do/i })).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("renders when entries are partial objects", () => {
    localStorage.setItem("todo-demo:tasks", JSON.stringify([{ id: "x" }]));
    render(<App />);
    expect(screen.getByRole("heading", { name: /to-do/i })).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("still renders the valid entries alongside malformed ones", () => {
    localStorage.setItem(
      "todo-demo:tasks",
      JSON.stringify([null, { id: "ok", title: "Valid", completed: false, createdAt: 1 }]),
    );
    render(<App />);
    expect(screen.getByRole("listitem")).toHaveTextContent("Valid");
  });
});

describe("screen-reader announcements (round-5 regression)", () => {
  it("exposes a polite live region on mount", () => {
    render(<App />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
  });

  it("announces a successful add", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "Announce me{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("Added Announce me. 1 task shown.");
  });

  it("announces each subsequent add", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "First{Enter}");
    await user.type(input, "Second{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("Added Second. 2 tasks shown.");
  });

  it("does not announce a rejected empty submit", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("keeps errors on the assertive alert, successes on the polite status", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "Doomed{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t be saved/i);
    expect(screen.getByRole("status")).toHaveTextContent("");
    vi.restoreAllMocks();
  });
});

describe("repeated titles still announce (round-6 regression)", () => {
  it("changes the live-region text when the same title is added twice", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "Same{Enter}");
    const first = screen.getByRole("status").textContent;
    await user.type(input, "Same{Enter}");
    const second = screen.getByRole("status").textContent;
    expect(second).not.toBe(first);
    expect(second).toContain("2 tasks");
  });

  it("announces three identical adds distinctly", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    const seen = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      await user.type(input, "Dup{Enter}");
      seen.add(screen.getByRole("status").textContent ?? "");
    }
    expect(seen.size).toBe(3);
  });
});

describe("cross-tab consistency (round-7 regression)", () => {
  it("includes tasks persisted by another tab after an add", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "Mine{Enter}");
    saveTasks([
      { id: "other", title: "FromOtherTab", completed: false, createdAt: 1 },
      { id: "mine", title: "Mine", completed: false, createdAt: 2 },
    ]);
    await user.type(input, "Second{Enter}");
    const items = screen.getAllByRole("listitem").map((n) => n.textContent);
    expect(items.some((t) => t?.includes("FromOtherTab"))).toBe(true);
    expect(items.some((t) => t?.includes("Second"))).toBe(true);
  });

  it("announces the true persisted total, not a stale local count", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    saveTasks([
      { id: "a", title: "A", completed: false, createdAt: 1 },
      { id: "b", title: "B", completed: false, createdAt: 2 },
    ]);
    await user.type(input, "C{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("3 tasks");
  });
});

describe("TOD-2 — list tasks", () => {
  it("renders tasks newest-first (createdAt descending)", () => {
    // Seed out of order: the view must sort, not trust storage order.
    saveTasks([
      { id: "old", title: "Oldest task", completed: false, createdAt: 1 },
      { id: "new", title: "Newest task", completed: false, createdAt: 3 },
      { id: "mid", title: "Middle task", completed: false, createdAt: 2 },
    ]);
    render(<App />);
    const titles = screen.getAllByRole("listitem").map((n) => n.textContent);
    expect(titles).toEqual(["Newest task", "Middle task", "Oldest task"]);
  });

  it("shows a friendly empty-state message when there are no tasks", () => {
    render(<App />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent(
      /nothing here yet/i,
    );
    expect(screen.getByTestId("task-count")).toHaveTextContent("0 tasks");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("count matches the task total and updates live on add", async () => {
    saveTasks([
      { id: "a", title: "A", completed: false, createdAt: 1 },
      { id: "b", title: "B", completed: false, createdAt: 2 },
      { id: "c", title: "C", completed: true, createdAt: 3 },
    ]);
    render(<App />);
    // Count reflects ALL tasks, completed included (filtering is TOD-5).
    expect(screen.getByTestId("task-count")).toHaveTextContent("3 tasks");
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: /new task/i }),
      "One more{Enter}",
    );
    expect(screen.getByTestId("task-count")).toHaveTextContent("4 tasks");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("uses singular wording for exactly one task", () => {
    saveTasks([{ id: "a", title: "Solo", completed: false, createdAt: 1 }]);
    render(<App />);
    expect(screen.getByTestId("task-count").textContent).toBe("1 task");
  });

  it("reload restores the list, newest-first, from the store TOD-1 writes", async () => {
    // Deterministic clock: each add gets a strictly later createdAt, so the
    // newest-first assertion cannot flake on same-millisecond adds.
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 1_000));
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "First{Enter}");
    await user.type(input, "Second{Enter}");
    expect(loadTasks().map((t) => t.title)).toEqual(["First", "Second"]);
    // Assert the RENDERED order immediately after adding, before unmount:
    // storage order alone would not catch a missing post-add sort (Copilot
    // round-2 finding — mutation-verified: deleting the post-add sort left
    // the whole suite green until this assertion existed).
    expect(
      screen.getAllByRole("listitem").map((n) => n.textContent),
    ).toEqual(["Second", "First"]);

    // Simulate a page reload: tear down, mount fresh from the same store.
    unmount();
    render(<App />);
    const titles = screen.getAllByRole("listitem").map((n) => n.textContent);
    expect(titles).toEqual(["Second", "First"]);
    expect(screen.getByTestId("task-count")).toHaveTextContent("2 tasks");
  });

  it("corrupt stored JSON renders the empty state instead of crashing", () => {
    localStorage.setItem("todo-demo:tasks", "{definitely not json");
    render(<App />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent(
      /nothing here yet/i,
    );
    expect(screen.getByTestId("task-count")).toHaveTextContent("0 tasks");
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("malformed array entries render the empty state instead of crashing", () => {
    // Partial objects (no leading null): a missing per-entry guard would let
    // these reach the render as list items with undefined titles. A leading
    // null would throw into loadTasks' outer catch and mask the gap — this
    // payload fails when the isTask guard is removed (mutation-verified).
    localStorage.setItem(
      "todo-demo:tasks",
      '[{"id":"x"},{"id":"y","title":"no completed flag"}]',
    );
    render(<App />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent(
      /nothing here yet/i,
    );
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});

describe("TOD-3 — complete / uncomplete", () => {
  const seedTwo = () =>
    saveTasks([
      { id: "a", title: "Write the tests", completed: false, createdAt: 1 },
      { id: "b", title: "Ship the story", completed: false, createdAt: 2 },
    ]);

  it("AC1: every task has a checkbox toggle named for its task", () => {
    seedTwo();
    render(<App />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(
      screen.getByRole("checkbox", { name: "Ship the story" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Write the tests" }),
    ).not.toBeChecked();
  });

  it("checkbox toggles the task and persists completed=true", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    const box = screen.getByRole("checkbox", { name: "Ship the story" });
    await user.click(box);
    expect(box).toBeChecked();
    const stored = loadTasks();
    expect(stored.find((t) => t.id === "b")?.completed).toBe(true);
    expect(stored.find((t) => t.id === "a")?.completed).toBe(false);
    // Toggling never reorders the list (TOD-2 AC1 holds through mutations).
    expect(
      screen.getAllByRole("listitem").map((n) => n.textContent),
    ).toEqual(["Ship the story", "Write the tests"]);
    expect(screen.getByTestId("task-count")).toHaveTextContent("2 tasks");
  });

  it("AC4: toggling twice returns to the original state, in view and store", async () => {
    seedTwo();
    const original = loadTasks();
    const user = userEvent.setup();
    render(<App />);
    const box = screen.getByRole("checkbox", { name: "Ship the story" });
    await user.click(box);
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(loadTasks()).toEqual(original);
    expect(
      screen.getByRole("checkbox", { name: "Write the tests" }),
    ).not.toBeChecked();
  });

  it("AC2: completed titles render strikethrough (and muted), active ones do not", () => {
    // Computed style from the REAL theme file — vitest css:false means the
    // stylesheet must be injected here; asserting a class name alone would
    // pass even if the CSS rule were missing.
    const style = document.createElement("style");
    style.textContent = themeCss;
    document.head.appendChild(style);
    try {
      saveTasks([
        { id: "done", title: "Finished chore", completed: true, createdAt: 2 },
        { id: "todo", title: "Open chore", completed: false, createdAt: 1 },
      ]);
      render(<App />);
      const doneTitle = screen.getByText("Finished chore");
      const todoTitle = screen.getByText("Open chore");
      const doneStyle = getComputedStyle(doneTitle);
      const todoStyle = getComputedStyle(todoTitle);
      expect(doneStyle.textDecorationLine).toBe("line-through");
      expect(todoStyle.textDecorationLine).toBe("none");
      // Contrast-safe muted ink: --ink-soft (#6f6353) on --surface-raised
      // (#fffefb) is 5.8:1 in light, 6.5:1 in dark — WCAG AA.
      expect(doneStyle.color).toBe("rgb(111, 99, 83)");
      expect(todoStyle.color).toBe("rgb(43, 33, 24)");
    } finally {
      style.remove();
    }
  });

  it("strikethrough appears on toggle and clears on untoggle", async () => {
    const style = document.createElement("style");
    style.textContent = themeCss;
    document.head.appendChild(style);
    try {
      seedTwo();
      const user = userEvent.setup();
      render(<App />);
      const box = screen.getByRole("checkbox", { name: "Ship the story" });
      expect(getComputedStyle(screen.getByText("Ship the story")).textDecorationLine).toBe("none");
      await user.click(box);
      expect(getComputedStyle(screen.getByText("Ship the story")).textDecorationLine).toBe("line-through");
      await user.click(box);
      expect(getComputedStyle(screen.getByText("Ship the story")).textDecorationLine).toBe("none");
    } finally {
      style.remove();
    }
  });

  it("AC3: toggle state survives reload (fresh mount reads the store)", async () => {
    seedTwo();
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole("checkbox", { name: "Ship the story" }));
    expect(loadTasks().find((t) => t.id === "b")?.completed).toBe(true);

    // Simulate a page reload: tear down, mount fresh from the same store.
    unmount();
    render(<App />);
    expect(
      screen.getByRole("checkbox", { name: "Ship the story" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Write the tests" }),
    ).not.toBeChecked();
  });

  it("toggle state changes are announced in the live region", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    const box = screen.getByRole("checkbox", { name: "Ship the story" });
    await user.click(box);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Completed Ship the story.",
    );
    await user.click(box);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Marked Ship the story as active.",
    );
  });

  it("AC5: storage throws on toggle -> revert + accessible error, no silent unsaved state", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    const box = screen.getByRole("checkbox", { name: "Ship the story" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await user.click(box);
    // Controlled checkbox snaps back to the persisted state…
    expect(box).not.toBeChecked();
    // …and the failure is announced assertively, not swallowed.
    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn’t be saved/i,
    );
    expect(loadTasks().find((t) => t.id === "b")?.completed).toBe(false);
    // No success announcement for a write that never happened.
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("AC5: a failed un-toggle of a completed task also reverts", async () => {
    saveTasks([
      { id: "done", title: "Already done", completed: true, createdAt: 1 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    const box = screen.getByRole("checkbox", { name: "Already done" });
    expect(box).toBeChecked();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await user.click(box);
    expect(box).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t be saved/i);
    expect(loadTasks()[0].completed).toBe(true);
  });

  it("toggle failure clears on a later successful add", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
    await user.click(screen.getByRole("checkbox", { name: "Ship the story" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    spy.mockRestore();
    await user.type(
      screen.getByRole("textbox", { name: /new task/i }),
      "Recovery{Enter}",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Added Recovery.");
  });

  it("a successful toggle clears a prior storage-failure alert", async () => {
    // Symmetric coverage (round-1 MINOR-1): deleting setStorageFailed(false)
    // from handleToggle's success path must turn this test red.
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
    await user.click(screen.getByRole("checkbox", { name: "Ship the story" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    spy.mockRestore();
    await user.click(screen.getByRole("checkbox", { name: "Ship the story" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Ship the story" })).toBeChecked();
  });

  it("completing two same-title tasks announces both (count distinguishes)", async () => {
    // Round-2 finding: direction-specific wording alone produced identical
    // live-region text for two different tasks with the same title — the
    // second success never re-announced. The completed count distinguishes.
    saveTasks([
      { id: "a", title: "Same name", completed: false, createdAt: 1 },
      { id: "b", title: "Same name", completed: false, createdAt: 2 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    const boxes = screen.getAllByRole("checkbox", { name: "Same name" });
    await user.click(boxes[0]);
    const first = screen.getByRole("status").textContent;
    await user.click(boxes[1]);
    const second = screen.getByRole("status").textContent;
    expect(first).toMatch(/Completed Same name/);
    expect(second).not.toBe(first);
    expect(second).toMatch(/2 of 2 shown done/);
  });

  it("a toggle storage failure is not masked by a pending blank-input rejection", async () => {
    // Round-2 finding: the shared alert prioritizes `rejected`; without
    // clearing it in the toggle failure path the user saw "Give the task a
    // name" instead of the storage error.
    saveTasks([{ id: "a", title: "Task", completed: false, createdAt: 1 }]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/give the task a name/i);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await user.click(screen.getByRole("checkbox", { name: "Task" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t be saved/i);
  });

  it("a storage READ failure during toggle surfaces the alert, not silence", async () => {
    // Round-2 finding: loadTasks swallowed the read error into "unknown id"
    // and the UI stayed silent. Mutation reads now propagate access errors.
    saveTasks([{ id: "a", title: "Task", completed: false, createdAt: 1 }]);
    const user = userEvent.setup();
    render(<App />);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    await user.click(screen.getByRole("checkbox", { name: "Task" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t be saved/i);
    expect(screen.getByRole("checkbox", { name: "Task" })).not.toBeChecked();
  });

  it("a POST-WRITE read failure keeps the committed list visible (round-3)", async () => {
    // The write succeeds; only the readback fails. Rendering from the
    // committed snapshot (not a fresh read) keeps tasks, counts and the
    // announcement truthful instead of wiping the list to "0 of 0 done".
    saveTasks([
      { id: "a", title: "Alpha", completed: false, createdAt: 1 },
      { id: "b", title: "Beta", completed: false, createdAt: 2 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    const realGet = Storage.prototype.getItem;
    let gets = 0;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage, key: string,
    ) {
      if (key === "todo-demo:tasks") {
        gets += 1;
        if (gets >= 3) {
          throw new DOMException("Storage disabled", "SecurityError");
        }
      }
      return realGet.call(this, key);
    });
    await user.click(screen.getByRole("checkbox", { name: "Beta" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
    expect(screen.getByTestId("task-count")).toHaveTextContent("2 tasks");
    expect(screen.getByRole("status")).toHaveTextContent(/1 of 2 shown done/);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("TOD-4 — delete a task", () => {
  const seedTwo = () =>
    saveTasks([
      { id: "a", title: "Write the tests", completed: false, createdAt: 1 },
      { id: "b", title: "Ship the story", completed: false, createdAt: 2 },
    ]);

  it("AC1: every task has a delete control named for its task", () => {
    seedTwo();
    render(<App />);
    const buttons = screen.getAllByRole("button", { name: /^delete/i });
    expect(buttons).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete.*Write the tests/i }),
    ).toBeInTheDocument();
  });

  it("AC2: delete removes the task from the list and the store, count updates", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("Write the tests");
    expect(loadTasks().map((t) => t.id)).toEqual(["a"]);
    expect(screen.getByTestId("task-count")).toHaveTextContent("1 task");
    // Newest-first order holds through deletion (TOD-2 AC1).
    await user.type(
      screen.getByRole("textbox", { name: /new task/i }),
      "Newer{Enter}",
    );
    expect(
      screen.getAllByRole("listitem").map((n) => n.textContent),
    ).toEqual(["Newer", "Write the tests"]);
  });

  it("AC3: deletion survives reload (fresh mount reads the store)", async () => {
    seedTwo();
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    );
    expect(loadTasks().map((t) => t.id)).toEqual(["a"]);

    // Simulate a page reload: tear down, mount fresh from the same store.
    unmount();
    render(<App />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("Write the tests");
    expect(
      screen.queryByRole("button", { name: /delete.*Ship the story/i }),
    ).toBeNull();
  });

  it("AC4: deleting the last task returns to the TOD-2 empty state", async () => {
    saveTasks([{ id: "solo", title: "Last one", completed: false, createdAt: 1 }]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: /delete.*Last one/i }),
    );
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByTestId("empty-state")).toHaveTextContent(
      /nothing here yet/i,
    );
    expect(screen.getByTestId("task-count")).toHaveTextContent("0 tasks");
    expect(loadTasks()).toEqual([]);
  });

  it("deletions are announced in the polite live region, distinctly", async () => {
    saveTasks([
      { id: "a", title: "Same name", completed: false, createdAt: 1 },
      { id: "b", title: "Same name", completed: false, createdAt: 2 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    const buttons = screen.getAllByRole("button", { name: /delete.*Same name/i });
    await user.click(buttons[0]);
    const first = screen.getByRole("status").textContent;
    expect(first).toMatch(/Deleted Same name/i);
    expect(first).toMatch(/1 task/);
    await user.click(screen.getByRole("button", { name: /delete.*Same name/i }));
    const second = screen.getByRole("status").textContent;
    // Same title twice must still re-announce: the count distinguishes.
    expect(second).not.toBe(first);
    expect(second).toMatch(/0 tasks/);
    // Wording differs from add/toggle announcements (operation-specific).
    expect(second).not.toMatch(/^Added|^Completed|^Marked/);
  });

  it("AC5: storage throws on delete -> task stays visible, accessible error", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await user.click(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    );
    // No silent data loss: the task remains in the list AND the store.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(loadTasks().map((t) => t.id)).toEqual(["a", "b"]);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t be saved/i);
    // No success announcement for a delete that never happened.
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByTestId("task-count")).toHaveTextContent("2 tasks");
  });

  it("AC5: a storage READ failure during delete surfaces the alert", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    await user.click(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t be saved/i);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("a delete storage failure is not masked by a pending blank-input rejection", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/give the task a name/i);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await user.click(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t be saved/i);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("a successful delete clears a prior storage-failure alert", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
    await user.click(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    spy.mockRestore();
    await user.click(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("a POST-WRITE read failure keeps the committed list visible", async () => {
    // The delete commits; only a later read fails. Rendering from the
    // committed snapshot keeps the remaining task, count and announcement
    // truthful instead of wiping the list (same contract as TOD-3 round-3).
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    const realGet = Storage.prototype.getItem;
    let gets = 0;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage, key: string,
    ) {
      if (key === "todo-demo:tasks") {
        gets += 1;
        if (gets >= 3) {
          throw new DOMException("Storage disabled", "SecurityError");
        }
      }
      return realGet.call(this, key);
    });
    await user.click(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("Write the tests");
    expect(screen.getByTestId("task-count")).toHaveTextContent("1 task");
    expect(screen.getByRole("status")).toHaveTextContent(/Deleted Ship the story/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("delete includes tasks another tab committed (committed-snapshot render)", async () => {
    seedTwo();
    const user = userEvent.setup();
    render(<App />);
    // Another tab commits before our delete; the store must merge, and the
    // rendered list must come from the committed snapshot.
    saveTasks([
      ...loadTasks(),
      { id: "other", title: "FromOtherTab", completed: false, createdAt: 3 },
    ]);
    await user.click(
      screen.getByRole("button", { name: /delete.*Ship the story/i }),
    );
    const titles = screen.getAllByRole("listitem").map((n) => n.textContent);
    expect(titles).toEqual(["FromOtherTab", "Write the tests"]);
    expect(screen.getByTestId("task-count")).toHaveTextContent("2 tasks");
  });

  it("delete control carries the theme's opaque focus ring", async () => {
    const style = document.createElement("style");
    style.textContent = themeCss;
    document.head.appendChild(style);
    try {
      seedTwo();
      render(<App />);
      const user = userEvent.setup();
      // autoFocus starts on the input; keyboard Tab activates :focus-visible.
      // TOD-5 added the All/Active/Completed buttons between Add and the list.
      await user.tab(); // Add
      await user.tab(); // All filter
      await user.tab(); // Active filter
      await user.tab(); // Completed filter
      await user.tab(); // newest checkbox
      await user.tab(); // newest delete button
      const button = screen.getByRole("button", {
        name: /delete.*Ship the story/i,
      });
      expect(button).toHaveFocus();
      const s = getComputedStyle(button);
      expect(s.outlineStyle).toBe("solid");
      expect(s.outlineColor).toBe("rgb(178, 62, 2)");
    } finally {
      style.remove();
    }
  });

  it("a successful delete clears a pending blank-input rejection", async () => {
    // Round-1 finding: the shared alert prioritizes `rejected`; without
    // clearing it on success the user saw a stale "Give the task a name"
    // assertive alert after a successful delete.
    saveTasks([{ id: "a", title: "Task", completed: false, createdAt: 1 }]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/give the task a name/i);
    await user.click(screen.getByRole("button", { name: "Delete Task" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Deleted Task/);
  });

  it("a successful toggle clears a pending blank-input rejection", async () => {
    // Same class in the toggle success path (pre-existing TOD-3 defect,
    // found by the TOD-4 review — fixed here with its own regression).
    saveTasks([{ id: "a", title: "Task", completed: false, createdAt: 1 }]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/give the task a name/i);
    await user.click(screen.getByRole("checkbox", { name: "Task" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Completed Task/);
  });

  it("a delete of an already-removed task drops the stale row silently", async () => {
    // Round-2 finding: another tab deleted the task after mount; the
    // null-return early exit left the obsolete row and count visible.
    saveTasks([
      { id: "a", title: "Alpha", completed: false, createdAt: 1 },
      { id: "b", title: "Beta", completed: false, createdAt: 2 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    saveTasks([{ id: "a", title: "Alpha", completed: false, createdAt: 1 }]);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    await user.click(screen.getByRole("button", { name: "Delete Beta" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTestId("task-count")).toHaveTextContent("1 task");
    expect(writes).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("a stale delete of the LAST task falls through to the empty state", async () => {
    saveTasks([{ id: "a", title: "Alpha", completed: false, createdAt: 1 }]);
    const user = userEvent.setup();
    render(<App />);
    saveTasks([]);
    await user.click(screen.getByRole("button", { name: "Delete Alpha" }));
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("task-count")).toHaveTextContent("0 tasks");
  });

  it("keyboard delete moves focus to a surviving control, not the body", async () => {
    // Round-2 finding: removing the focused button dropped focus to the
    // body — keyboard/screen-reader users lost their interaction context.
    saveTasks([
      { id: "a", title: "Alpha", completed: false, createdAt: 1 },
      { id: "b", title: "Beta", completed: false, createdAt: 2 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    const btn = screen.getByRole("button", { name: "Delete Beta" });
    btn.focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("deleting the last task moves focus to the new-task input", async () => {
    saveTasks([{ id: "a", title: "Alpha", completed: false, createdAt: 1 }]);
    const user = userEvent.setup();
    render(<App />);
    const btn = screen.getByRole("button", { name: "Delete Alpha" });
    btn.focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: /new task/i }),
    );
  });

  it("focus falls back to the input when the survivor button is not mounted yet", async () => {
    // Round-3 finding: another tab adds a NEWER task after mount; the
    // committed snapshot picks it as the survivor, but its button is not
    // in the DOM yet (React batches setTasks). The lookup misses — focus
    // must still land on the input, not the body.
    saveTasks([
      { id: "a", title: "Alpha", completed: false, createdAt: 1 },
      { id: "b", title: "Beta", completed: false, createdAt: 2 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    saveTasks([
      { id: "a", title: "Alpha", completed: false, createdAt: 1 },
      { id: "b", title: "Beta", completed: false, createdAt: 2 },
      { id: "c", title: "Gamma", completed: false, createdAt: 3 },
    ]);
    const btn = screen.getByRole("button", { name: "Delete Beta" });
    btn.focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("TOD-5 — filter view", () => {
  // Newest-first render order: Gamma (active), Beta (done), Alpha (active).
  const seedMixed = () =>
    saveTasks([
      { id: "a", title: "Alpha", completed: false, createdAt: 1 },
      { id: "b", title: "Beta", completed: true, createdAt: 2 },
      { id: "c", title: "Gamma", completed: false, createdAt: 3 },
    ]);

  it("AC1: three filter controls — All / Active / Completed, All selected by default", () => {
    render(<App />);
    const all = screen.getByRole("button", { name: "All" });
    const active = screen.getByRole("button", { name: "Active" });
    const completed = screen.getByRole("button", { name: "Completed" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(active).toHaveAttribute("aria-pressed", "false");
    expect(completed).toHaveAttribute("aria-pressed", "false");
  });

  it("AC2: each filter shows the right tasks, newest-first", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      "Gamma", "Beta", "Alpha",
    ]);
    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      "Gamma", "Alpha",
    ]);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      "Beta",
    ]);
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      "Gamma", "Beta", "Alpha",
    ]);
  });

  it("AC2: the count reflects the FILTERED set, with singular wording", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByTestId("task-count")).toHaveTextContent("3 tasks");
    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("task-count")).toHaveTextContent("2 tasks");
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByTestId("task-count").textContent).toBe("1 task");
  });

  it("AC3: filter selection survives reload", async () => {
    seedMixed();
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(localStorage.getItem("todo-demo:filter")).toBe("completed");

    // Simulate a page reload: tear down, mount fresh from the same store.
    unmount();
    render(<App />);
    expect(screen.getByRole("button", { name: "Completed" })).toHaveAttribute(
      "aria-pressed", "true",
    );
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      "Beta",
    ]);
    expect(screen.getByTestId("task-count")).toHaveTextContent("1 task");
  });

  it("AC4: switching filters never writes task data", async () => {
    seedMixed();
    const before = localStorage.getItem("todo-demo:tasks");
    const original = loadTasks();
    const user = userEvent.setup();
    render(<App />);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    await user.click(screen.getByRole("button", { name: "Active" }));
    await user.click(screen.getByRole("button", { name: "Completed" }));
    await user.click(screen.getByRole("button", { name: "All" }));
    // The filter key may be written; the TASK key must never be touched.
    for (const call of writes.mock.calls) {
      expect(call[0]).not.toBe("todo-demo:tasks");
    }
    expect(localStorage.getItem("todo-demo:tasks")).toBe(before);
    expect(loadTasks()).toEqual(original);
  });

  it("AC5: an invalid stored filter falls back to All", () => {
    seedMixed();
    localStorage.setItem("todo-demo:filter", "bogus");
    render(<App />);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed", "true",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("AC5: an unreadable filter (getItem throws) falls back to All, tasks still render", () => {
    seedMixed();
    const realGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage, key: string,
    ) {
      if (key === "todo-demo:filter") {
        throw new DOMException("Storage disabled", "SecurityError");
      }
      return realGet.call(this, key);
    });
    render(<App />);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed", "true",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("AC5: totally unreadable storage still mounts (empty state, All selected)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    render(<App />);
    expect(screen.getByRole("heading", { name: /to-do/i })).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed", "true",
    );
  });

  it("filter switches announce the new view and its count, distinctly", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Active" }));
    const active = screen.getByRole("status").textContent;
    expect(active).toMatch(/active/i);
    expect(active).toMatch(/2 tasks/);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    const completed = screen.getByRole("status").textContent;
    expect(completed).toMatch(/completed/i);
    expect(completed).toMatch(/1 task/);
    expect(completed).not.toBe(active);
    // View announcements stay on the polite region, never the alert.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a filter switch clears a pending blank-input rejection", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/give the task a name/i);
    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a filter switch clears a prior storage-failure alert", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
    await user.click(screen.getByRole("checkbox", { name: "Gamma" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    spy.mockRestore();
    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/active/i);
  });

  it("a failed filter save alerts assertively and keeps the current selection", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t be saved/i);
    // Selection reverted: All still pressed, full list still visible.
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed", "true",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("a failed filter save is not masked by a pending blank-input rejection", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/give the task a name/i);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t be saved/i);
  });

  it("toggling under the Active filter drops the row from view, not the store", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Active" }));
    const box = screen.getByRole("checkbox", { name: "Gamma" });
    box.focus();
    await user.keyboard(" ");
    // Committed snapshot: Gamma is completed, so it leaves the Active view…
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      "Alpha",
    ]);
    expect(screen.getByTestId("task-count")).toHaveTextContent("1 task");
    // …but the store keeps it (toggle, not delete).
    expect(loadTasks().find((t) => t.id === "c")?.completed).toBe(true);
    expect(loadTasks()).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent(/Completed Gamma/);
    // The focused checkbox unmounted — focus must not drop to the body.
    expect(document.activeElement).not.toBe(document.body);
  });

  it("un-toggling under the Completed filter drops the row from view", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    await user.click(screen.getByRole("checkbox", { name: "Beta" }));
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("task-count")).toHaveTextContent("0 tasks");
    expect(loadTasks().find((t) => t.id === "b")?.completed).toBe(false);
    expect(loadTasks()).toHaveLength(3);
  });

  it("deleting under a filter renders the committed snapshot and keeps focus in view", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Active" }));
    const btn = screen.getByRole("button", { name: "Delete Gamma" });
    btn.focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      "Alpha",
    ]);
    expect(screen.getByTestId("task-count")).toHaveTextContent("1 task");
    // Beta is completed and hidden by the filter — it must survive the delete.
    expect(loadTasks().map((t) => t.id).sort()).toEqual(["a", "b"]);
    // Focus lands on the surviving IN-VIEW delete control, not the body.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete Alpha" }),
    );
  });

  it("deleting the last visible task under a filter keeps hidden data intact", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    const btn = screen.getByRole("button", { name: "Delete Beta" });
    btn.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("task-count")).toHaveTextContent("0 tasks");
    // The active tasks are hidden, not deleted.
    expect(loadTasks().map((t) => t.id).sort()).toEqual(["a", "c"]);
    // No surviving in-view control: focus falls back to the new-task input.
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: /new task/i }),
    );
  });

  it("an empty filtered view shows a friendly message, not a blank section", () => {
    saveTasks([{ id: "a", title: "Alpha", completed: false, createdAt: 1 }]);
    localStorage.setItem("todo-demo:filter", "completed");
    render(<App />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("task-count")).toHaveTextContent("0 tasks");
    expect(loadTasks()).toHaveLength(1);
  });

  it("adding under the Completed filter persists the task without showing it", async () => {
    seedMixed();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    await user.type(
      screen.getByRole("textbox", { name: /new task/i }),
      "Fresh{Enter}",
    );
    // New tasks are active: persisted and announced, but not in this view.
    expect(loadTasks().map((t) => t.title)).toContain("Fresh");
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      "Beta",
    ]);
    expect(screen.getByTestId("task-count")).toHaveTextContent("1 task");
    expect(screen.getByRole("status")).toHaveTextContent(/Added Fresh/);
  });

  it("filter controls carry the theme's opaque focus ring", async () => {
    const style = document.createElement("style");
    style.textContent = themeCss;
    document.head.appendChild(style);
    try {
      render(<App />);
      const user = userEvent.setup();
      await user.tab(); // Add
      await user.tab(); // All
      await user.tab(); // Active
      const button = screen.getByRole("button", { name: "Active" });
      expect(button).toHaveFocus();
      const s = getComputedStyle(button);
      expect(s.outlineStyle).toBe("solid");
      expect(s.outlineColor).toBe("rgb(178, 62, 2)");
    } finally {
      style.remove();
    }
  });

  it("add under a filter announces the VISIBLE count, not the full total", async () => {
    // Round-1 MINOR-1: spoken and displayed numerics must agree.
    saveTasks([{ id: "a", title: "Done thing", completed: true, createdAt: 1 }]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    await user.type(screen.getByRole("textbox", { name: /new task/i }), "Fresh{Enter}");
    expect(screen.getByTestId("task-count")).toHaveTextContent("1 task");
    const spoken = screen.getByRole("status").textContent || "";
    expect(spoken).toMatch(/Added Fresh/);
    expect(spoken).toMatch(/1 task shown/);
    expect(spoken).not.toMatch(/2 tasks/);
  });

  it("delete under a filter announces the VISIBLE remaining count", async () => {
    saveTasks([
      { id: "a", title: "Active one", completed: false, createdAt: 1 },
      { id: "b", title: "Done one", completed: true, createdAt: 2 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Active" }));
    await user.click(screen.getByRole("button", { name: "Delete Active one" }));
    expect(screen.getByTestId("task-count")).toHaveTextContent("0 tasks");
    const spoken = screen.getByRole("status").textContent || "";
    expect(spoken).toMatch(/Deleted Active one/);
    expect(spoken).toMatch(/0 tasks left in view/);
  });

  it("toggle under a filter announces counts from the VISIBLE set", async () => {
    saveTasks([
      { id: "a", title: "Active one", completed: false, createdAt: 1 },
      { id: "b", title: "Done one", completed: true, createdAt: 2 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Active" }));
    await user.click(screen.getByRole("checkbox", { name: "Active one" }));
    // The toggled row leaves the Active view: 0 of 0 shown done.
    expect(screen.getByRole("status")).toHaveTextContent(/0 of 0 shown done/);
  });

  it("a filtered-empty view says no matches, not 'nothing here yet'", async () => {
    // Round-1 MINOR-2: tasks hidden behind the filter are not an empty app.
    saveTasks([{ id: "a", title: "Active only", completed: false, createdAt: 1 }]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    const empty = screen.getByTestId("empty-state");
    expect(empty.textContent).not.toMatch(/nothing here yet/i);
    expect(empty.textContent).toMatch(/no completed tasks/i);
  });
});
