import { useState, type DragEvent, type ReactNode } from "react";
import {
  Check,
  Label,
  Line,
  Page,
  PageTitle,
  Spread,
  Write,
} from "../components/ui";
import { HabitMark } from "../components/HabitMark";
import {
  WEEKDAYS_MIN,
  addDays,
  fmtShort,
  todayKey,
  weekDays,
  weekStart,
} from "../lib/date";
import { href } from "../lib/router";
import { WorkMeta } from "../components/WorkMeta";
import {
  editWeek,
  ideaOfWeekTask,
  renameWeekTask,
  setWeekTaskDone,
  uid,
  useStore,
  useWeekWithSeed,
  type Quadrant,
  type WeekTask,
} from "../lib/store";

const Q_INFO: Record<Quadrant, { title: string; hint: string }> = {
  A: { title: "Important & urgent", hint: "Do first" },
  B: { title: "Important, not urgent", hint: "Schedule this week" },
  C: { title: "Urgent, not important", hint: "Delegate or do quickly" },
  D: { title: "Neither", hint: "Drop, or only after the rest" },
};

const DRAG_TYPE = "application/x-duckbook-task";

export function WeekView({ date }: { date: string }) {
  const monday = weekStart(date);
  const week = useWeekWithSeed(monday);
  const unsorted = week.tasks.filter((t) => !t.q);

  return (
    <Spread>
      <Page side="left" className="week-notes">
        <PageTitle step="2" caps="WEEKLY" italic="notes" />
        <p className="page-sub">
          Jot down anything for the week: meetings, deadlines, ideas, thoughts.
          Come back to it as the week goes on.
        </p>

        <Line
          label="Biggest goal of the week:"
          value={week.goal}
          onChange={(v) => editWeek(monday, (w) => void (w.goal = v))}
        />

        <DropZone q={null} monday={monday} className="brain-dump">
          <Label hint="Is it important? Is it urgent? Sort it →">
            Tasks of the week
          </Label>
          <ul className="dump-list">
            {unsorted.map((t) => (
              <WeekTaskItem key={t.id} monday={monday} task={t} sortable />
            ))}
          </ul>
          <AddTask
            monday={monday}
            q={null}
            placeholder="Brain-dump a task, press Enter"
          />
        </DropZone>

        <Label>Notes</Label>
        <Write
          className="dotgrid notes week-free"
          value={week.notes}
          onChange={(v) => editWeek(monday, (w) => void (w.notes = v))}
          rows={10}
          ariaLabel="Weekly notes"
        />
      </Page>

      <Page side="right" className="week-plan">
        <PageTitle step="3" caps="WEEKLY" italic="planning">
          <div className="from-to">
            From: <span className="ink">{fmtShort(monday)}</span> &nbsp; To:{" "}
            <span className="ink">{fmtShort(addDays(monday, 6))}</span>
          </div>
        </PageTitle>

        <div className="matrix">
          <div />
          <div className="axis axis-top">Important</div>
          <div className="axis axis-top">Not important</div>
          <div className="axis axis-side">
            <span>Urgent</span>
          </div>
          <Quad q="A" monday={monday} tasks={week.tasks} />
          <Quad q="C" monday={monday} tasks={week.tasks} />
          <div className="axis axis-side">
            <span>Not urgent</span>
          </div>
          <Quad q="B" monday={monday} tasks={week.tasks} />
          <Quad q="D" monday={monday} tasks={week.tasks} />
        </div>

        <HabitTracker monday={monday} />

        <Line
          label="Self-care:"
          value={week.selfCare}
          onChange={(v) => editWeek(monday, (w) => void (w.selfCare = v))}
          placeholder="a long bath, a walk, an early night…"
        />
      </Page>
    </Spread>
  );
}

function DropZone({
  q,
  monday,
  className,
  children,
}: {
  q: Quadrant | null;
  monday: string;
  className: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (!id) return;
    editWeek(monday, (w) => {
      const t = w.tasks.find((x) => x.id === id);
      if (!t) return;
      t.q = q;
      // Move to the end so dropped tasks land at the bottom of their new home.
      w.tasks = [...w.tasks.filter((x) => x.id !== id), t];
    });
  };
  return (
    <div
      className={`${className} ${over ? "is-over" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}

function Quad({
  q,
  monday,
  tasks,
}: {
  q: Quadrant;
  monday: string;
  tasks: WeekTask[];
}) {
  const mine = tasks.filter((t) => t.q === q);
  return (
    <DropZone q={q} monday={monday} className={`quad quad-${q}`}>
      <ul>
        {mine.map((t) => (
          <WeekTaskItem key={t.id} monday={monday} task={t} />
        ))}
      </ul>
      <AddTask monday={monday} q={q} placeholder="+" />
      <span
        className="quad-letter"
        title={`${Q_INFO[q].title}: ${Q_INFO[q].hint}`}
      >
        <b>{q}</b>
        <span className="quad-hint">{Q_INFO[q].hint}</span>
      </span>
    </DropZone>
  );
}

function WeekTaskItem({
  monday,
  task: t,
  sortable,
}: {
  monday: string;
  task: WeekTask;
  sortable?: boolean;
}) {
  const set = (fn: (x: WeekTask) => void) =>
    editWeek(monday, (w) => {
      const x = w.tasks.find((y) => y.id === t.id);
      if (x) fn(x);
    });
  const remove = () =>
    editWeek(
      monday,
      (w) => void (w.tasks = w.tasks.filter((y) => y.id !== t.id)),
    );
  const idea = useStore((s) => ideaOfWeekTask(s, t));

  return (
    <li className={`wtask ${t.done ? "is-done" : ""}`}>
      <span
        className="grip"
        draggable
        title="Drag to another box"
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, t.id);
          e.dataTransfer.effectAllowed = "move";
          const li = e.currentTarget.closest("li");
          if (li) e.dataTransfer.setDragImage(li, 12, 12);
        }}
      >
        ⠿
      </span>
      <Write
        value={t.text}
        onChange={(v) => renameWeekTask(monday, t.id, v)}
        singleLine
        ariaLabel="Task"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === "Backspace" && !t.text) {
            e.preventDefault();
            remove();
          }
        }}
      />
      <WorkMeta idea={idea} returnDate={monday} />
      {sortable ? (
        <span className="sort-chips">
          {(["A", "B", "C", "D"] as const).map((q) => (
            <button
              key={q}
              className={`q-chip q-${q}`}
              onClick={() => set((x) => void (x.q = q))}
              title={`${Q_INFO[q].title}: ${Q_INFO[q].hint}`}
            >
              {q}
            </button>
          ))}
        </span>
      ) : (
        <Check
          checked={t.done}
          onChange={(v) => setWeekTaskDone(monday, t.id, v)}
          label={`Mark “${t.text}” done`}
        />
      )}
    </li>
  );
}

function AddTask({
  monday,
  q,
  placeholder,
}: {
  monday: string;
  q: Quadrant | null;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  return (
    <div className="add-task">
      <Write
        value={text}
        onChange={setText}
        placeholder={placeholder}
        singleLine
        ariaLabel={q ? `Add to ${q}` : "Add a task of the week"}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (!text.trim()) return;
          editWeek(
            monday,
            (w) =>
              void w.tasks.push({
                id: uid(),
                text: text.trim(),
                q,
                done: false,
              }),
          );
          setText("");
        }}
      />
    </div>
  );
}

function HabitTracker({ monday }: { monday: string }) {
  const week = useWeekWithSeed(monday);
  const [name, setName] = useState("");
  const days = weekDays(monday);
  const today = todayKey();

  return (
    <div className="habits">
      <div className="habit-row habit-head">
        <Label>Habit tracker</Label>
        {WEEKDAYS_MIN.map((w, i) => (
          <a
            key={w}
            href={href("day", days[i])}
            className={`wd-min ${days[i] === today ? "is-today" : ""}`}
          >
            {w}
          </a>
        ))}
      </div>
      {week.habits.map((h, hi) => (
        <div className="habit-row" key={h.id}>
          <Write
            value={h.name}
            onChange={(v) =>
              editWeek(monday, (w) => void (w.habits[hi].name = v))
            }
            singleLine
            ariaLabel="Habit"
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !h.name) {
                e.preventDefault();
                editWeek(monday, (w) => void w.habits.splice(hi, 1));
              }
            }}
          />
          {h.days.map((on, di) => (
            <button
              key={di}
              className="pomo habit-dot"
              aria-pressed={on}
              aria-label={`${h.name} on ${WEEKDAYS_MIN[di]}`}
              onClick={() =>
                editWeek(monday, (w) => void (w.habits[hi].days[di] = !on))
              }
            >
              <HabitMark on={on} seed={h.id + di} />
            </button>
          ))}
        </div>
      ))}
      <div className="habit-row">
        <Write
          value={name}
          onChange={setName}
          placeholder={
            week.habits.length
              ? "+ habit"
              : "Add a habit: exercise, read 10 pages…"
          }
          singleLine
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (!name.trim()) return;
            editWeek(
              monday,
              (w) =>
                void w.habits.push({
                  id: uid(),
                  name: name.trim(),
                  days: Array(7).fill(false),
                }),
            );
            setName("");
          }}
        />
      </div>
    </div>
  );
}
