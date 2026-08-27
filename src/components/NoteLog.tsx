// RIGHT PANE, below Moves. A scratchpad where each note is pinned to the move
// that was on the board when it was written, so a note about a position can be
// clicked to go back to that position.
//
// Notes are session-only by design: nothing here is written to storage or to
// the share link, and replacing the move log clears them (see PositionNote).
// About says so, because a notes panel that silently forgets would otherwise
// read as a bug.

import { useEffect, useRef, useState } from "react";
import { moveLabel } from "../engine/moveLabel";
import type { MoveLogEntry, PositionNote } from "../config/types";

interface NoteLogProps {
  entries: MoveLogEntry[];
  currentIndex: number;
  notes: PositionNote[];
  onAdd: (text: string) => void;
  onDelete: (id: number) => void;
  onJump: (index: number) => void;
}

export function NoteLog({
  entries,
  currentIndex,
  notes,
  onAdd,
  onDelete,
  onJump,
}: NoteLogProps) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Opening the composer should put the caret in it - the button and the box
  // are far enough apart on screen that requiring a second click to type is a
  // small papercut on every single note.
  useEffect(() => {
    if (composing) inputRef.current?.focus();
  }, [composing]);

  // Sorted by the move each note sits on so the pad reads in game order however
  // the notes were written - jumping back to move 3 and annotating it puts that
  // note above the one from move 20. `id` breaks ties so several notes on one
  // move keep the order they were typed in.
  const ordered = [...notes].sort((a, b) => a.index - b.index || a.id - b.id);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
    setComposing(false);
  }

  function cancel() {
    setDraft("");
    setComposing(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter saves, Shift+Enter breaks the line - the convention for a compact
    // compose box. Escape abandons the draft.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <div className="note-log">
      <div className="note-log-header">
        <h2>Notes</h2>
        <button
          type="button"
          className="action-btn"
          onClick={() => (composing ? cancel() : setComposing(true))}
          title="Write a note about the position on the board"
        >
          {composing ? "Cancel" : "+ Add note"}
        </button>
      </div>

      {composing && (
        <div className="note-compose">
          {/* Read from currentIndex on every render rather than captured when
              the composer opened: the move buttons and arrow keys still work
              with this box on screen, so a captured label would quietly start
              lying about where the note is going to land. */}
          <label className="note-compose-target" htmlFor="note-draft">
            On <strong>{moveLabel(entries, currentIndex)}</strong>
          </label>
          <textarea
            id="note-draft"
            ref={inputRef}
            className="note-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="What's worth remembering here?"
          />
          <div className="note-compose-actions">
            <button
              type="button"
              className="action-btn"
              onClick={submit}
              disabled={draft.trim().length === 0}
            >
              Add
            </button>
            <span className="note-hint">Enter to save · Shift+Enter for a new line</span>
          </div>
        </div>
      )}

      {ordered.length === 0 ? (
        <p className="status">No notes yet.</p>
      ) : (
        <ul className="note-log-list">
          {ordered.map((note) => (
            <li
              className={note.index === currentIndex ? "note-row current" : "note-row"}
              key={note.id}
            >
              {/* The whole row is the jump target; delete is its own control
                  beside it, since a button can't be nested inside a button. */}
              <button
                type="button"
                className="note-jump"
                onClick={() => onJump(note.index)}
                title="Go back to this position"
              >
                <span className="note-move">{moveLabel(entries, note.index)}</span>
                <span className="note-text">{note.text}</span>
              </button>
              <button
                type="button"
                className="note-delete"
                onClick={() => onDelete(note.id)}
                aria-label={`Delete note on ${moveLabel(entries, note.index)}`}
                title="Delete this note"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
