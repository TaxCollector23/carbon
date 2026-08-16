import { describe, expect, it } from 'vitest';
import { createInitialState, executeRequest, restoreSnapshot, takeSnapshot } from './try-replica';

const post = (name: string) => ({
  method: 'POST' as const,
  path: '/pets',
  body: JSON.stringify({ name }),
});

describe('try-replica', () => {
  it('starts with the seeded pet and monotonically increasing ids', () => {
    const state = createInitialState();
    expect(state.pets.map((p) => p.id)).toEqual(['pet_1']);
    expect(state.nextId).toBe(2);
    expect(state.snapshot).toBeNull();
  });

  it('persists mutations: create is visible to a subsequent list', () => {
    let state = createInitialState();
    const created = executeRequest(state, post('Mochi'));
    expect(created.response.status).toBe(201);
    state = created.state;

    const listed = executeRequest(state, { method: 'GET', path: '/pets' });
    expect(listed.response.status).toBe(200);
    expect(listed.response.body).toMatchObject({ count: 2 });
    expect(state.pets.map((p) => p.name)).toEqual(['Carbon cat', 'Mochi']);
  });

  it('rejects a POST with a missing or non-string name', () => {
    const state = createInitialState();
    const bad = executeRequest(state, { method: 'POST', path: '/pets', body: '{}' });
    expect(bad.response.status).toBe(400);
    expect(bad.state.pets).toEqual(state.pets);
  });

  it('deletes the most recently created pet', () => {
    let state = createInitialState();
    state = executeRequest(state, post('Mochi')).state;
    const deleted = executeRequest(state, { method: 'DELETE', path: '/pets/{id}' });
    expect(deleted.response.status).toBe(200);
    expect(deleted.response.body).toMatchObject({ deleted: 'pet_2', remaining: 1 });
    expect(deleted.state.pets.map((p) => p.name)).toEqual(['Carbon cat']);
  });

  it('404s read/delete on an empty store', () => {
    let state = createInitialState();
    state = executeRequest(state, { method: 'DELETE', path: '/pets/{id}' }).state;
    const read = executeRequest(state, { method: 'GET', path: '/pets/{id}' });
    const remove = executeRequest(state, { method: 'DELETE', path: '/pets/{id}' });
    expect(read.response.status).toBe(404);
    expect(remove.response.status).toBe(404);
  });

  it('snapshot/restore rolls the store back to the captured list', () => {
    let state = createInitialState();
    state = takeSnapshot(state);
    state = executeRequest(state, post('Mochi')).state;
    state = executeRequest(state, post('Suki')).state;
    expect(state.pets).toHaveLength(3);

    state = restoreSnapshot(state);
    expect(state.pets.map((p) => p.name)).toEqual(['Carbon cat']);
    // Ids keep counting forward even after a restore, so they stay unique.
    expect(state.nextId).toBe(4);
  });

  it('restore is a no-op before any snapshot', () => {
    const state = createInitialState();
    expect(restoreSnapshot(state)).toBe(state);
  });

  it('returns 404 for unknown routes', () => {
    const state = createInitialState();
    const result = executeRequest(state, { method: 'GET', path: '/nope' });
    expect(result.response.status).toBe(404);
    expect(result.state).toBe(state);
  });
});
