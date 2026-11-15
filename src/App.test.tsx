import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { loadTasks, saveTasks } from "./store";

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
    expect(screen.getByRole("status")).toHaveTextContent("Added Announce me. 1 task.");
  });

  it("announces each subsequent add", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "First{Enter}");
    await user.type(input, "Second{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("Added Second. 2 tasks.");
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
