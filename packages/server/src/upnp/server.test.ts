import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RadioManager } from '../radios.ts';
import { switchToPlayerMode } from './server.ts';

function fakeManager(start: { power: boolean; mode: number }, follows = true) {
  const calls: string[] = [];
  const state = { ...start };
  const control = {
    status: async () => ({ power: state.power, mode: { key: state.mode, id: '', label: '', selectable: true } }),
    modes: async () => [
      { key: 5, id: 'fm', label: 'FM', selectable: true },
      { key: 3, id: 'mp', label: 'Music player', selectable: true },
    ],
    setPower: async (on: boolean) => {
      calls.push(`power ${on}`);
      state.power = on;
    },
    setMode: async (k: number) => {
      calls.push(`mode ${k}`);
      if (follows) state.mode = k;
    },
  };
  return { calls, manager: { get: () => control } as unknown as RadioManager };
}

test('the radio is woken and switched to its music player', async () => {
  const { calls, manager } = fakeManager({ power: false, mode: 5 });
  await switchToPlayerMode(manager, 1, /music player/i, () => {});
  assert.deepEqual(calls, ['power true', 'mode 3']);
});

test('nothing is touched when the radio is already there', async () => {
  const { calls, manager } = fakeManager({ power: true, mode: 3 });
  await switchToPlayerMode(manager, 1, /music player/i, () => {});
  assert.deepEqual(calls, []);
});

test('an unknown mode name is an error, not a guess', async () => {
  const { manager } = fakeManager({ power: true, mode: 5 });
  await assert.rejects(switchToPlayerMode(manager, 1, /nonexistent/i, () => {}), /no mode matches/);
});
