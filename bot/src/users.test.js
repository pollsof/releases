import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KvUnavailableError,
  getUserProfile,
  setUserProfile,
  removeBotUser,
  listAllUsers,
  splitEnv,
} from './users.js';

function memoryKv(initial = {}) {
  const store = { ...initial };
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
    _store: store,
  };
}

describe('splitEnv', () => {
  it('separa e trimma ids', () => {
    assert.deepEqual(splitEnv('1, 2 ,3'), ['1', '2', '3']);
  });
});

describe('setUserProfile', () => {
  it('falha sem POLLARIS_KV', async () => {
    await assert.rejects(
      () => setUserProfile({}, '1879964763', 'usuario'),
      (err) => err instanceof KvUnavailableError
    );
  });

  it('persiste no KV e aparece na listagem', async () => {
    const env = {
      ROOT_ID: '1722873719',
      ALLOWED_USERS: '-5146055997',
      POLLARIS_KV: memoryKv(),
    };

    await setUserProfile(env, '1879964763', 'usuario');

    assert.equal(await getUserProfile(env, '1879964763'), 'usuario');
    const list = await listAllUsers(env);
    assert.ok(list.some(u => u.id === '1879964763' && u.profile === 'usuario'));
    assert.ok(list.some(u => u.id === '1722873719' && u.profile === 'root'));
  });
});

describe('removeBotUser', () => {
  it('falha sem POLLARIS_KV', async () => {
    await assert.rejects(
      () => removeBotUser({}, '1879964763'),
      (err) => err instanceof KvUnavailableError
    );
  });

  it('remove usuario do KV', async () => {
    const env = {
      ROOT_ID: '1722873719',
      POLLARIS_KV: memoryKv({
        bot_users: JSON.stringify({ '1879964763': 'usuario' }),
      }),
    };

    await removeBotUser(env, '1879964763');
    assert.equal(await getUserProfile(env, '1879964763'), null);
  });
});

describe('getUserProfile', () => {
  it('respeita ROOT_ID e ALLOWED_USERS seed', async () => {
    const env = {
      ROOT_ID: '1722873719',
      ALLOWED_USERS: '111,222',
      POLLARIS_KV: memoryKv(),
    };
    assert.equal(await getUserProfile(env, '1722873719'), 'root');
    assert.equal(await getUserProfile(env, '111'), 'usuario');
    assert.equal(await getUserProfile(env, '999'), null);
  });
});
