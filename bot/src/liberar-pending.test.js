import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pendingKey,
  isCnpjAlvo,
  buildLiberarStartedMessage,
  buildLiberarReadyMessage,
  buildLiberarFailedMessage,
  saveLiberarPending,
  loadLiberarPending,
  deleteLiberarPending,
  authorizePagesNotify,
  waitForPagesJson,
} from './liberar-pending.js';
import { KvUnavailableError } from './users.js';

function memoryKv(initial = {}) {
  const store = { ...initial };
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
    async delete(key) {
      delete store[key];
    },
    _store: store,
  };
}

describe('pendingKey', () => {
  it('prefixa o sha', () => {
    assert.equal(pendingKey('abc'), 'liberar_pending:abc');
  });
});

describe('mensagens', () => {
  it('monta aviso de inicio para CNPJ', () => {
    const text = buildLiberarStartedMessage({
      sistema: 'green',
      versao: '3.0.0.143',
      alvo: '48255041000155',
      destPath: 'green/48255041000155.json',
    });
    assert.match(text, /Liberacao de versao iniciada/);
    assert.match(text, /cliente/);
    assert.match(text, /48255041000155/);
    assert.match(text, /3\.0\.0\.143/);
  });

  it('monta aviso de inicio para producao', () => {
    const text = buildLiberarStartedMessage({
      sistema: 'green',
      versao: '3.0.0.143',
      alvo: 'green',
      destPath: 'green/green.json',
    });
    assert.match(text, /producao/);
    assert.match(text, /green\/green\.json/);
  });

  it('avisa CNPJ pronto com mention', () => {
    assert.equal(
      buildLiberarReadyMessage({
        username: '@natharuc',
        sistema: 'green',
        versao: '3.0.0.143',
        alvo: '48255041000155',
      }),
      '@natharuc, o cliente 48255041000155 ja pode atualizar para a versao 3.0.0.143'
    );
  });

  it('avisa producao pronta', () => {
    assert.equal(
      buildLiberarReadyMessage({
        username: 'natharuc',
        sistema: 'green',
        versao: '3.0.0.143',
        alvo: 'green',
      }),
      '@natharuc, a producao de green ja pode atualizar para a versao 3.0.0.143'
    );
  });

  it('avisa falha do Pages', () => {
    assert.match(
      buildLiberarFailedMessage({
        username: '@natharuc',
        sistema: 'green',
        versao: '3.0.0.143',
        alvo: '48255041000155',
      }),
      /falhou ao publicar/
    );
  });
});

describe('KV pending', () => {
  it('falha sem KV', async () => {
    await assert.rejects(
      () => saveLiberarPending({}, 'abc', { chatId: 1 }),
      (err) => err instanceof KvUnavailableError
    );
  });

  it('grava, le e apaga', async () => {
    const env = { POLLARIS_KV: memoryKv() };
    const pending = { chatId: 1, sistema: 'green', versao: '1', alvo: 'x' };
    await saveLiberarPending(env, 'deadbeef', pending);
    assert.deepEqual(await loadLiberarPending(env, 'deadbeef'), pending);
    await deleteLiberarPending(env, 'deadbeef');
    assert.equal(await loadLiberarPending(env, 'deadbeef'), null);
  });
});

describe('authorizePagesNotify', () => {
  it('aceita Bearer valido', () => {
    const request = new Request('https://bot.example/internal/pages-deployed', {
      headers: { Authorization: 'Bearer s3cret' },
    });
    assert.equal(authorizePagesNotify(request, { PAGES_NOTIFY_SECRET: 's3cret' }), true);
  });

  it('rejeita token errado ou ausente', () => {
    const request = new Request('https://bot.example/internal/pages-deployed', {
      headers: { Authorization: 'Bearer nope' },
    });
    assert.equal(authorizePagesNotify(request, { PAGES_NOTIFY_SECRET: 's3cret' }), false);
    assert.equal(
      authorizePagesNotify(new Request('https://bot.example/'), { PAGES_NOTIFY_SECRET: 's3cret' }),
      false
    );
  });
});

describe('waitForPagesJson', () => {
  it('retorna true no primeiro 200', async () => {
    const ok = await waitForPagesJson('green/x.json', {
      fetchImpl: async () => new Response('{}', { status: 200 }),
      sleepImpl: async () => {},
    });
    assert.equal(ok, true);
  });

  it('tenta de novo e aceita sucesso posterior', async () => {
    let n = 0;
    const ok = await waitForPagesJson('green/x.json', {
      fetchImpl: async () => {
        n += 1;
        return new Response('', { status: n === 1 ? 404 : 200 });
      },
      sleepImpl: async () => {},
    });
    assert.equal(ok, true);
    assert.equal(n, 2);
  });
});

describe('isCnpjAlvo', () => {
  it('distingue cliente de producao', () => {
    assert.equal(isCnpjAlvo('green', '48255041000155'), true);
    assert.equal(isCnpjAlvo('green', 'green'), false);
  });
});
