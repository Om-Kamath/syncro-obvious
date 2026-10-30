// Generic undo/redo command stack (LIFO) over an immutable state value.
// Commands are pure state transformations; the stack owns only history
// discipline: ordering, the redo branch, the history cap, and eviction
// notifications so callers can release resources (e.g. blob URLs) when a
// command can no longer be undone or re-applied.

export type EvictionReason =
  | 'overflow'   // pushed out of the history cap — can never be undone again
  | 'superseded' // discarded redo branch after a new command executed post-undo
  | 'cleared';   // history reset wholesale (e.g. loading another project)

export interface EditCommand<S> {
  readonly label: string;
  apply(state: S): S;
  undo(state: S): S;
}

export class CommandStack<S, C extends EditCommand<S> = EditCommand<S>> {
  private undoStack: C[] = [];
  private redoStack: C[] = [];

  constructor(
    private readonly maxHistory: number = 50,
    // `C` lets callers with a richer command type (e.g. TimelineEditCommand)
    // keep the eviction callback fully typed instead of narrowing at the site.
    private readonly onEvict?: (command: C, reason: EvictionReason) => void,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Apply a new command on top of `state`, discarding any redo branch. */
  execute(command: C, state: S): S {
    this.discardRedo();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      const evicted = this.undoStack.shift();
      if (evicted) this.onEvict?.(evicted, 'overflow');
    }
    return command.apply(state);
  }

  /** Revert the most recent command; null when nothing to undo. */
  undo(state: S): S | null {
    const command = this.undoStack.pop();
    if (!command) return null;
    this.redoStack.push(command);
    return command.undo(state);
  }

  /** Re-apply the most recently undone command; null when nothing to redo. */
  redo(state: S): S | null {
    const command = this.redoStack.pop();
    if (!command) return null;
    this.undoStack.push(command);
    return command.apply(state);
  }

  /** Drop the entire history (both directions), notifying for each command. */
  clear(): void {
    for (const command of [...this.undoStack, ...this.redoStack]) {
      this.onEvict?.(command, 'cleared');
    }
    this.undoStack = [];
    this.redoStack = [];
  }

  private discardRedo(): void {
    if (this.onEvict) {
      for (const command of this.redoStack) this.onEvict(command, 'superseded');
    }
    this.redoStack = [];
  }
}
