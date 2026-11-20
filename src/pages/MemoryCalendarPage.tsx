import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  Pin,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { agentApi, type CronJobInfo, type PersonalMemoryItem } from "@/lib/agentApi";
import { buildMemoryWiki, searchMemories, sortUpcomingEvents } from "@/lib/memoryAndCalendar";
import { useLifeStore } from "@/store";
import { cn } from "@/lib/cn";

type SubTab = "memories" | "wiki" | "notes" | "calendar";

export default function MemoryCalendarPage() {
  const [tab, setTab] = useState<SubTab>("memories");
  const memories = useLifeStore((s) => s.memories);
  const notes = useLifeStore((s) => s.notes);
  const calendar = useLifeStore((s) => s.calendar);
  const refreshDomain = useLifeStore((s) => s.refreshDomain);

  // Memories state
  const [memQuery, setMemQuery] = useState("");
  const [memCat, setMemCat] = useState<PersonalMemoryItem["category"]>("preference");
  const [memTitle, setMemTitle] = useState("");
  const [memContent, setMemContent] = useState("");
  const [wikiNotice, setWikiNotice] = useState("");

  // Notes state
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  // Calendar + Routines state
  const [evTitle, setEvTitle] = useState("");
  const [evStart, setEvStart] = useState(() => {
    const d = new Date(Date.now() + 3600000);
    return d.toISOString().slice(0, 16);
  });
  const [evLocation, setEvLocation] = useState("");
  const [evRecurrence, setEvRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [cronJobs, setCronJobs] = useState<CronJobInfo[]>([]);
  const [cronName, setCronName] = useState("");
  const [cronSchedule, setCronSchedule] = useState("0 9 * * *");
  const [cronPrompt, setCronPrompt] = useState("");

  useEffect(() => {
    void refreshDomain("memories");
    void refreshDomain("notes");
    void refreshDomain("calendar");
    void agentApi.getCronJobs().then((r) => setCronJobs(r.jobs)).catch(() => undefined);
  }, [refreshDomain]);

  const filteredMemories = useMemo(
    () => searchMemories(memories, memQuery),
    [memories, memQuery],
  );

  const wikiSections = useMemo(
    () => buildMemoryWiki(memories, notes),
    [memories, notes],
  );

  const sortedEvents = useMemo(() => sortUpcomingEvents(calendar), [calendar]);

  const addMemory = async () => {
    if (!memContent.trim()) return;
    await agentApi.createMemory({
      category: memCat,
      title: memTitle.trim() || "Personal Fact",
      content: memContent.trim(),
      pinned: true,
    });
    setMemTitle("");
    setMemContent("");
    await refreshDomain("memories");
  };

  const togglePin = async (m: PersonalMemoryItem) => {
    await agentApi.updateMemory(m.id, { pinned: !m.pinned });
    await refreshDomain("memories");
  };

  const removeMemory = async (id: string) => {
    await agentApi.deletePersonalMemory(id);
    await refreshDomain("memories");
  };

  const saveNote = async () => {
    if (!noteTitle.trim() && !noteBody.trim()) return;
    const tags = noteTags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (editingNoteId) {
      await agentApi.updateNote(editingNoteId, { title: noteTitle.trim(), body: noteBody, tags });
    } else {
      await agentApi.createNote({ title: noteTitle.trim() || "Quick Note", body: noteBody, tags });
    }
    setEditingNoteId(null);
    setNoteTitle("");
    setNoteBody("");
    setNoteTags("");
    await refreshDomain("notes");
  };

  const deleteNote = async (id: string) => {
    await agentApi.deleteNote(id);
    if (editingNoteId === id) {
      setEditingNoteId(null);
      setNoteTitle("");
      setNoteBody("");
      setNoteTags("");
    }
    await refreshDomain("notes");
  };

  const addEvent = async () => {
    if (!evTitle.trim() || !evStart) return;
    await agentApi.createCalendarEvent({
      title: evTitle.trim(),
      startISO: evStart,
      location: evLocation.trim(),
      recurrence: evRecurrence,
    });
    setEvTitle("");
    setEvLocation("");
    await refreshDomain("calendar");
  };

  const toggleEventDone = async (id: string, completed: boolean) => {
    await agentApi.updateCalendarEvent(id, { completed: !completed });
    await refreshDomain("calendar");
  };

  const deleteEvent = async (id: string) => {
    await agentApi.deleteCalendarEvent(id);
    await refreshDomain("calendar");
  };

  const addRoutine = async () => {
    if (!cronPrompt.trim()) return;
    const res = await agentApi.createCronJob({
      name: cronName.trim() || "Automated Briefing",
      schedule: cronSchedule.trim() || "0 9 * * *",
      prompt: cronPrompt.trim(),
    });
    setCronJobs(res.jobs);
    setCronName("");
    setCronPrompt("");
  };

  const convertRoutineToSkill = async (job: CronJobInfo) => {
    const res = await agentApi.draftWorkflowSkill({
      name: job.name,
      description: `Automated from calendar routine (${job.schedule})`,
      triggers: [job.name.toLowerCase()],
      stepsText: `${job.prompt}\nSummarize status inside Command HUD`,
    });
    setWikiNotice(`Converted routine "${job.name}" into skill "${res.plugin.name}" (pinned@${res.plugin.pinnedSha}).`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h1 className="font-display text-base font-semibold text-fg">Memory, Wiki, Notes & Calendar</h1>
          <p className="text-xs text-fg-muted">
            Personal facts recalled in conversation · Topic Knowledge Wiki · Markdown notebook · Scheduled routines
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-elevated p-1">
          {([
            ["memories", "Personal Memory"],
            ["wiki", "Memory Wiki"],
            ["notes", "Notes Studio"],
            ["calendar", "Calendar & Routines"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
                tab === id ? "bg-accent text-background" : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {wikiNotice && (
        <div className="border-b border-border bg-elevated px-5 py-2 text-xs text-accent">
          {wikiNotice}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "memories" && (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="hud-panel space-y-3 p-4 lg:col-span-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Teach JARVIS a Personal Fact
              </h2>
              <select
                value={memCat}
                onChange={(e) => setMemCat(e.target.value as PersonalMemoryItem["category"])}
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none"
              >
                <option value="preference">Preference</option>
                <option value="person">Person / Contact</option>
                <option value="project">Project</option>
                <option value="routine">Daily Routine</option>
                <option value="fact">Personal Fact</option>
              </select>
              <input
                value={memTitle}
                onChange={(e) => setMemTitle(e.target.value)}
                placeholder="Short title (e.g. Coffee Order)"
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <textarea
                rows={4}
                value={memContent}
                onChange={(e) => setMemContent(e.target.value)}
                placeholder="What should JARVIS always remember about you?"
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => void addMemory()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-background"
              >
                <Plus size={14} /> Save to Memory
              </button>
            </div>

            <div className="space-y-3 lg:col-span-8">
              <div className="hud-panel flex items-center gap-2 px-3 py-2">
                <Search size={14} className="text-fg-muted" />
                <input
                  value={memQuery}
                  onChange={(e) => setMemQuery(e.target.value)}
                  placeholder="Search personal memories..."
                  className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
                />
              </div>

              <div className="space-y-2">
                {filteredMemories.map((m) => (
                  <div key={m.id} className="hud-panel flex items-start justify-between gap-3 p-3.5">
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                          {m.category}
                        </span>
                        <span className="font-semibold text-fg">{m.title}</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{m.content}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void togglePin(m)}
                        title={m.pinned ? "Unpin" : "Pin"}
                        className={cn(
                          "rounded p-1.5 transition-colors",
                          m.pinned ? "text-accent" : "text-fg-muted hover:text-fg",
                        )}
                      >
                        <Pin size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeMemory(m.id)}
                        title="Delete memory"
                        className="rounded p-1.5 text-fg-muted hover:text-red-500"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "wiki" && (
          <div className="mx-auto max-w-5xl space-y-4">
            <div className="hud-panel flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold text-fg">
                  <BookOpen size={15} className="text-accent" /> Visual Knowledge Wiki
                </h2>
                <p className="text-xs text-fg-muted">
                  Compiled from {memories.length} personal memories and {notes.length} markdown notebook pages.
                </p>
              </div>
              <span className="font-mono text-xs text-accent">{wikiSections.length} Topic Chapters</span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {wikiSections.map((section) => (
                <div key={section.id} className="hud-panel flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
                    <div>
                      <h3 className="text-sm font-semibold text-fg">{section.title}</h3>
                      <p className="text-[11px] text-fg-muted">{section.summary}</p>
                    </div>
                    <span className="font-mono text-xs text-accent">{section.entries.length}</span>
                  </div>
                  <div className="space-y-2">
                    {section.entries.map((entry) => (
                      <div key={entry.id} className="hud-elevated p-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-fg">{entry.title}</span>
                          <span className="font-mono text-[10px] uppercase text-fg-muted">
                            {entry.sourceType}
                            {entry.pinned ? " · Pinned" : ""}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] text-fg-muted">
                          {entry.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "notes" && (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="hud-panel space-y-3 p-4 lg:col-span-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                {editingNoteId ? "Edit Note" : "New Note"}
              </h2>
              <input
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Note title..."
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                value={noteTags}
                onChange={(e) => setNoteTags(e.target.value)}
                placeholder="Tags (comma separated, e.g. ideas, work)"
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <textarea
                rows={8}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Write markdown notes, checklist items, or ask JARVIS in chat to take down notes..."
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveNote()}
                  className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-background"
                >
                  {editingNoteId ? "Update Note" : "Save Note"}
                </button>
                {editingNoteId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNoteId(null);
                      setNoteTitle("");
                      setNoteBody("");
                      setNoteTags("");
                    }}
                    className="rounded-lg border border-border px-3 py-2 text-xs text-fg-muted"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2.5 lg:col-span-7">
              {notes.map((note) => (
                <div key={note.id} className="hud-panel p-4">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNoteId(note.id);
                        setNoteTitle(note.title);
                        setNoteBody(note.body);
                        setNoteTags(note.tags.join(", "));
                      }}
                      className="text-left"
                    >
                      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg hover:text-accent">
                        <FileText size={14} className="text-accent" /> {note.title}
                      </h3>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteNote(note.id)}
                      className="text-fg-muted hover:text-red-500"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-fg-muted">{note.body}</p>
                  {note.tags.length > 0 && (
                    <p className="mt-2 text-[11px] text-accent">{note.tags.map((t) => `#${t}`).join("  ")}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "calendar" && (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-5">
              <div className="hud-panel space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Schedule Event
                  </h2>
                  <a
                    href={agentApi.calendarIcsUrl()}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                  >
                    <Download size={12} /> Export .ics
                  </a>
                </div>
                <input
                  value={evTitle}
                  onChange={(e) => setEvTitle(e.target.value)}
                  placeholder="Event title (e.g. Flight Check-in)"
                  className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
                />
                <input
                  type="datetime-local"
                  value={evStart}
                  onChange={(e) => setEvStart(e.target.value)}
                  className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={evLocation}
                    onChange={(e) => setEvLocation(e.target.value)}
                    placeholder="Location (optional)"
                    className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
                  />
                  <select
                    value={evRecurrence}
                    onChange={(e) => setEvRecurrence(e.target.value as typeof evRecurrence)}
                    className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none"
                  >
                    <option value="none">One-time</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void addEvent()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-background"
                >
                  <Calendar size={13} /> Add to Calendar
                </button>
              </div>

              <div className="hud-panel space-y-2.5 p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  Automated Butler Routines
                </h2>
                <input
                  value={cronName}
                  onChange={(e) => setCronName(e.target.value)}
                  placeholder="Routine name"
                  className="w-full rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
                <input
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                  placeholder="Cron (e.g. 0 9 * * *)"
                  className="w-full rounded-lg border border-border bg-elevated px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                <input
                  value={cronPrompt}
                  onChange={(e) => setCronPrompt(e.target.value)}
                  placeholder="Prompt for JARVIS to run automatically..."
                  className="w-full rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void addRoutine()}
                  className="w-full rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
                >
                  Add Automation Routine
                </button>
              </div>
            </div>

            <div className="space-y-2.5 lg:col-span-7">
              {sortedEvents.map((ev) => (
                <div
                  key={ev.id}
                  className={cn(
                    "hud-panel flex items-center justify-between gap-3 p-3.5",
                    ev.completed && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <button
                      type="button"
                      onClick={() => void toggleEventDone(ev.id, Boolean(ev.completed))}
                      className="mt-0.5 text-accent"
                    >
                      {ev.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                    </button>
                    <div>
                      <p className={cn("text-sm font-medium text-fg", ev.completed && "line-through")}>
                        {ev.title}
                      </p>
                      <p className="font-mono text-[11px] text-fg-muted tabular-nums">
                        {new Date(ev.startISO).toLocaleString()}
                        {ev.location ? ` · ${ev.location}` : ""}
                        {ev.recurrence !== "none" ? ` · ${ev.recurrence}` : ""}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteEvent(ev.id)}
                    className="text-fg-muted hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              {cronJobs.map((job) => (
                <div key={job.id} className="hud-panel flex items-center justify-between gap-3 p-3.5">
                  <div>
                    <p className="text-xs font-semibold text-fg">
                      Routine: {job.name} <span className="font-mono text-accent">({job.schedule})</span>
                    </p>
                    <p className="text-xs text-fg-muted">{job.prompt}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void convertRoutineToSkill(job)}
                      title="Save routine as reusable skill"
                      className="flex items-center gap-1 rounded-lg border border-border bg-elevated px-2 py-1 text-[11px] text-fg hover:border-accent"
                    >
                      <Sparkles size={11} className="text-accent" /> Turn into Skill
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void agentApi.cronAction("remove", job.id).then((r) => setCronJobs(r.jobs))
                      }
                      className="text-fg-muted hover:text-red-500"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
