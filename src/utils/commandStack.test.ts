import { describe, it, expect } from 'vitest';
import { CommandStack } from './commandStack';
import type { EditCommand, EvictionReason } from './commandStack';

type State = Array<{ id: string; n: number }>;

function makeCommand(
  name: string,
  apply: (s: State) => State,
  undo: (s: State) => State,
): EditCommand<State> {
  return { label: name, apply, undo };
}

function makeStack(maxHistory = 50) {
  const evicted: Array<[EditCommand<State>, EvictionReason]> = [];
  const stack = new CommandStack<State>(maxHistory, (command, reason) => {
    evicted.push([command, reason]);
  });
  return { stack, evicted };
}

describe('CommandStack', () => {
  it('returns null from undo/redo on empty history', () => {
    const { stack } = makeStack();
    expect(stack.undo([])).toBeNull();
    expect(stack.redo([])).toBeNull();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it('op -> undo -> redo restores state equality', () => {
    const { stack } = makeStack();
    const s0: State = [{ id: 'a', n: 1 }];
    const command = makeCommand(
      'op',
      s => s.map(x => ({ ...x, n: x.n + 1 })),
      s => s.map(x => ({ ...x, n: x.n - 1 })),
    );

    const s1 = stack.execute(command, s0);
    expect(s1).toEqual([{ id: 'a', n: 2 }]);
    expect(stack.canUndo).toBe(true);

    const s2 = stack.undo(s1);
    expect(s2).toEqual(s0);

    const s3 = stack.redo(s2!);
    expect(s3).toEqual(s1);
    expect(s3).toEqual([{ id: 'a', n: 2 }]);
  });

  it('undoes and redoes multiple commands in LIFO order', () => {
    const { stack } = makeStack();
    const append = (id: string) =>
      makeCommand(
        `add ${id}`,
        s => [...s, { id, n: s.length }],
        s => s.filter(x => x.id !== id),
      );
    const s1 = stack.execute(append('a'), []);
    const s2 = stack.execute(append('b'), s1);
    const s3 = stack.execute(append('c'), s2);
    expect(s3).toEqual([
      { id: 'a', n: 0 },
      { id: 'b', n: 1 },
      { id: 'c', n: 2 },
    ]);

    expect(stack.undo(s3)).toEqual(s2);
    expect(stack.undo(s2!)).toEqual(s1);
    expect(stack.redo(s1!)).toEqual(s2);
    expect(stack.undo(s2!)).toEqual(s1);
  });

  it('clears the redo branch on a new execute and reports superseded evictions', () => {
    const { stack, evicted } = makeStack();
    const s0: State = [];
    const identity = (s: State) => s;
    const a = makeCommand('a', identity, identity);
    const b = makeCommand('b', identity, identity);
    const c = makeCommand('c', identity, identity);

    stack.execute(a, s0);
    stack.execute(b, s0);
    stack.undo(s0); // b moves to the redo branch
    expect(stack.canRedo).toBe(true);

    stack.execute(c, s0); // executing discards the redo branch
    expect(stack.canRedo).toBe(false);
    expect(evicted).toEqual([[b, 'superseded']]);
  });

  it('evicts the oldest command with overflow when the history cap is exceeded', () => {
    const { stack, evicted } = makeStack(2);
    const identity = (s: State) => s;
    const a = makeCommand('a', identity, identity);
    const b = makeCommand('b', identity, identity);
    const c = makeCommand('c', identity, identity);

    stack.execute(a, []);
    stack.execute(b, []);
    stack.execute(c, []); // a falls out of the cap

    expect(stack.canUndo).toBe(true);
    expect(stack.undo([])).not.toBeNull();
    expect(stack.undo([])).not.toBeNull();
    expect(stack.undo([])).toBeNull(); // a is gone for good
    expect(evicted).toEqual([[a, 'overflow']]);
  });

  it('clear() drops both stacks and reports cleared evictions', () => {
    const { stack, evicted } = makeStack();
    const identity = (s: State) => s;
    const a = makeCommand('a', identity, identity);
    const b = makeCommand('b', identity, identity);

    stack.execute(a, []);
    stack.execute(b, []);
    stack.undo([]);
    stack.clear();

    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    expect(evicted.map(([cmd, reason]) => [cmd.label, reason])).toEqual([
      ['a', 'cleared'],
      ['b', 'cleared'],
    ]);
  });

  it('does not report superseded evictions when no callback is provided', () => {
    const stack = new CommandStack<State>();
    const identity = (s: State) => s;
    const a = makeCommand('a', identity, identity);
    stack.execute(a, []);
    stack.undo([]);
    expect(() => stack.execute(a, [])).not.toThrow();
    expect(stack.canRedo).toBe(false);
  });

  it('command state transformations are pure — the stack never mutates inputs', () => {
    const { stack } = makeStack();
    const s0: State = [{ id: 'a', n: 1 }];
    const command = makeCommand(
      'double',
      s => [...s, { id: 'b', n: 2 }],
      s => s.filter(x => x.id !== 'b'),
    );
    const s1 = stack.execute(command, s0);
    expect(s0).toEqual([{ id: 'a', n: 1 }]);
    expect(s1).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
  });
});
