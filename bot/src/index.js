/**
 * Pollaris Release Bot -- Cloudflare Worker
 *
 * Publico:
 *   /myid                                -> retorna seu ID do Telegram
 *   /ajuda                               -> lista todos os comandos
 *
 * Usuarios autorizados:
 *   /liberar {sistema}                    -> copia {sistema}/teste.json -> {sistema}/{sistema}.json
 *   /liberar {sistema} {versao}           -> gera {sistema}/{sistema}.json com a versao informada
 *   /liberar {sistema} {versao} {cnpj}    -> gera {sistema}/{cnpj}.json com a versao informada
 *                                         (consulta {sistema}/{versao}.json se existir; senao template {sistema}-v{versao})
 *   /remover {sistema} {cnpj}             -> remove {sistema}/{cnpj}.json do repositorio
 *   /versao  {sistema}                    -> exibe conteudo atual de {sistema}/teste.json
 *   /produtos                             -> lista os produtos disponiveis
 *
 * Root (administrador raiz):
 *   /acesso  {userid}                     -> concede acesso a um usuario
 *   /revogar {userid}                     -> revoga acesso de um usuario
 *   /usuarios                             -> lista todos os usuarios autorizados
 */

const BOT_VERSION = '2.3.2';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('OK', { status: 200 });

    let update;
    try { update = await request.json(); } catch { return new Response('OK', { status: 200 }); }

    if (update?.callback_query) {
      await handleCallback(update.callback_query, env);
      return new Response('OK', { status: 200 });
    }

    const message = update?.message ?? update?.edited_message;
    if (!message?.text) return new Response('OK', { status: 200 });

    const chatId      = message.chat.id;
    const userId      = String(message.from?.id ?? '');
    const rawText     = message.text.trim();
    const isGroup     = message.chat.type === 'group' || message.chat.type === 'supergroup';
    const botUsername = await getBotUsername(env);
    const botMention  = botUsername ? `@${botUsername}` : null;

    if (isGroup) {
      const mentioned = botMention &&
        new RegExp(escapeRegex(botMention), 'i').test(rawText);
      const replyToBot = botUsername &&
        message.reply_to_message?.from?.username?.toLowerCase() === botUsername.toLowerCase();
      if (!mentioned && !replyToBot) {
        return new Response('OK', { status: 200 });
      }
    }

    const text = normalizeCommandText(
      botMention
        ? rawText.replace(new RegExp(escapeRegex(botMention), 'gi'), '').trim()
        : rawText
    );

    const isRoot       = env.ROOT_ID && userId === String(env.ROOT_ID);
    const authorized   = isRoot || await isAuthorized(env, userId);
    const username     = message.from?.username
      ? `@${message.from.username}`
      : (message.from?.first_name ?? `user ${userId}`);
    const ctx          = { env, chatId, userId, username, isRoot, authorized };

    const reply = (msg, md = false, keyboard = null) =>
      sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, md, keyboard);

    if (/^\/(start|menu)(?:@\S+)?/i.test(text)) {
      await reply(buildMenuText(authorized, isRoot), true, mainMenuKeyboard(env, authorized, isRoot));
      return new Response('OK', { status: 200 });
    }

    if (/^\/myid(?:@\S+)?/i.test(text)) {
      await reply(`Seu ID: \`${userId}\``, true, mainMenuKeyboard(env, authorized, isRoot));
      return new Response('OK', { status: 200 });
    }

    if (/^\/ajuda(?:@\S+)?/i.test(text)) {
      await reply(buildHelpText(isRoot), true, mainMenuKeyboard(env, authorized, isRoot));
      return new Response('OK', { status: 200 });
    }

    if (authorized) {
      const matchAcesso = text.match(/^\/acesso(?:@\S+)?\s+(\d+)/i);
      if (matchAcesso) {
        if (!isRoot) return new Response('OK', { status: 200 });
        await addUser(env, matchAcesso[1]);
        await reply(`Acesso concedido para ID \`${matchAcesso[1]}\`.`, true);
        return new Response('OK', { status: 200 });
      }

      const matchRevogar = text.match(/^\/revogar(?:@\S+)?\s+(\d+)/i);
      if (matchRevogar) {
        if (!isRoot) return new Response('OK', { status: 200 });
        await removeUser(env, matchRevogar[1]);
        await reply(`Acesso revogado para ID \`${matchRevogar[1]}\`.`, true);
        return new Response('OK', { status: 200 });
      }

      if (/^\/usuarios(?:@\S+)?/i.test(text)) {
        if (!isRoot) return new Response('OK', { status: 200 });
        await reply(await buildUsersText(env), true);
        return new Response('OK', { status: 200 });
      }

      if (/^\/produtos(?:@\S+)?/i.test(text)) {
        await reply(buildProductsText(env), true, productMenuKeyboard(env, 'cmd:menu'));
        return new Response('OK', { status: 200 });
      }

      const matchVersao = text.match(/^\/versao(?:@\S+)?\s+(\S+)/i);
      if (matchVersao) {
        await handleVersao(ctx, matchVersao[1], reply);
        return new Response('OK', { status: 200 });
      }

      const matchRemover = text.match(/^\/remover(?:@\S+)?\s+(\S+)\s+(\S+)/i);
      if (matchRemover) {
        await handleRemover(ctx, matchRemover[1], matchRemover[2], reply);
        return new Response('OK', { status: 200 });
      }

      const matchLiberar = text.match(/^\/liberar(?:@\S+)?\s+(\S+)(?:\s+(\S+))?(?:\s+(\S+))?/i);
      if (matchLiberar) {
        await handleLiberar(ctx, matchLiberar[1], matchLiberar[2], matchLiberar[3], reply);
        return new Response('OK', { status: 200 });
      }
    }

    await reply(
      buildFallbackText(authorized, isRoot),
      true,
      mainMenuKeyboard(env, authorized, isRoot)
    );
    return new Response('OK', { status: 200 });
  }
};

async function handleCallback(callback, env) {
  const data     = callback.data ?? '';
  const chatId   = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  const userId   = String(callback.from?.id ?? '');
  const isRoot   = env.ROOT_ID && userId === String(env.ROOT_ID);
  const authorized = isRoot || await isAuthorized(env, userId);

  await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callback.id);

  if (!chatId || !messageId) return;

  const username = callback.from?.username
    ? `@${callback.from.username}`
    : (callback.from?.first_name ?? `user ${userId}`);
  const ctx = { env, chatId, userId, username, isRoot, authorized };

  const edit = (msg, md = false, keyboard = null) =>
    editMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, msg, md, keyboard);

  const reply = (msg, md = false, keyboard = null) =>
    sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, md, keyboard);

  if (data === 'cmd:menu') {
    await edit(buildMenuText(authorized, isRoot), true, mainMenuKeyboard(env, authorized, isRoot));
    return;
  }

  if (data === 'cmd:myid') {
    await edit(`Seu ID: \`${userId}\``, true, mainMenuKeyboard(env, authorized, isRoot));
    return;
  }

  if (data === 'cmd:ajuda') {
    await edit(buildHelpText(isRoot), true, mainMenuKeyboard(env, authorized, isRoot));
    return;
  }

  if (!authorized) return;

  if (data === 'cmd:produtos') {
    await edit(buildProductsText(env), true, productMenuKeyboard(env, 'cmd:menu'));
    return;
  }

  if (data === 'cmd:usuarios') {
    if (!isRoot) return;
    await edit(await buildUsersText(env), true, mainMenuKeyboard(env, authorized, isRoot));
    return;
  }

  if (data === 'cmd:versao_menu') {
    await edit('Selecione o produto para ver o staging:', true, productMenuKeyboard(env, 'versao', 'cmd:menu'));
    return;
  }

  if (data === 'cmd:liberar_menu') {
    await edit(
      'Selecione o produto para liberar o staging em producao:',
      true,
      productMenuKeyboard(env, 'liberar_staging', 'cmd:menu')
    );
    return;
  }

  const matchVersao = data.match(/^versao:(\S+)$/);
  if (matchVersao) {
    await handleVersao(ctx, matchVersao[1], edit);
    return;
  }

  const matchLiberarStaging = data.match(/^liberar_staging:(\S+)$/);
  if (matchLiberarStaging) {
    const produto = resolveProduct(ctx.env, matchLiberarStaging[1]);
    if (!produto) {
      await edit(`Erro: produto desconhecido: *${esc(matchLiberarStaging[1])}*`, true, mainMenuKeyboard(ctx.env, authorized, isRoot));
      return;
    }
    const { owner, repo } = githubRepo(ctx.env);
    try {
      const res = await ghGet(ctx.env.GITHUB_TOKEN, owner, repo, `${produto}/teste.json`);
      if (!res.ok) {
        await edit(`Erro: staging de *${esc(produto)}* nao encontrado.`, true, mainMenuKeyboard(ctx.env, authorized, isRoot));
        return;
      }
      const content = decodeGhContent((await res.json()).content);
      const blocked = assertReleaseAllowed(content);
      if (blocked) {
        await edit(blocked, true, mainMenuKeyboard(ctx.env, authorized, isRoot));
        return;
      }
      await edit(
        `Confirmar liberacao de *${esc(produto)}*?\n\nVersao: \`${content.versao ?? 'desconhecida'}\`\nDestino: \`${esc(produto)}/${esc(produto)}.json\``,
        true,
        confirmLiberarKeyboard(produto)
      );
    } catch (err) {
      await edit(`Erro: ${err.message}`, false, mainMenuKeyboard(ctx.env, authorized, isRoot));
    }
    return;
  }

  const matchLiberarConfirm = data.match(/^liberar_confirm:(\S+)$/);
  if (matchLiberarConfirm) {
    await handleLiberar(ctx, matchLiberarConfirm[1], undefined, undefined, edit);
    return;
  }

  if (data === 'liberar_cancel') {
    await edit('Liberacao cancelada.', false, mainMenuKeyboard(ctx.env, authorized, isRoot));
    return;
  }
}

function buildMenuText(authorized, isRoot) {
  const lines = [
    '*Pollaris Release Bot*',
    `_v${BOT_VERSION}_`,
    '',
    'Use os botoes abaixo ou os comandos em `/ajuda`.',
  ];
  if (authorized) {
    lines.push('', '_Voce tem acesso aos comandos de release._');
  }
  if (isRoot) {
    lines.push('_Voce e administrador root._');
  }
  return lines.join('\n');
}

function buildHelpText(isRoot) {
  const lines = [
    `*Comandos disponiveis* (_bot v${BOT_VERSION}_):`,
    '',
    '`/myid` - seu ID do Telegram',
    '`/ajuda` - esta mensagem',
    '`/menu` - menu com botoes',
    '',
    '*Para autorizados:*',
    '`/produtos` - lista de produtos',
    '`/versao {sistema}` - versao em staging',
    '`/liberar {sistema}` - publica de teste para producao',
    '`/liberar {sistema} {versao}` - publica versao especifica',
    '`/liberar {sistema} {versao} {cnpj}` - publica versao para CNPJ',
    '`/remover {sistema} {cnpj}` - remove arquivo do repositorio',
  ];
  if (isRoot) {
    lines.push('', '*Root:*');
    lines.push('`/acesso {userid}` - concede acesso');
    lines.push('`/revogar {userid}` - revoga acesso');
    lines.push('`/usuarios` - lista usuarios autorizados');
  }
  return lines.join('\n');
}

function buildFallbackText(authorized, isRoot) {
  if (authorized) {
    return 'Nao entendi essa mensagem. Use `/ajuda` para ver os comandos ou os botoes abaixo.';
  }
  return 'Ola! Nao entendi essa mensagem. Use `/ajuda` para ver o que posso fazer ou `/myid` para obter seu ID.';
}

function buildProductsText(env) {
  const lista = splitEnv(env.VALID_PRODUCTS).join(', ') || '(nenhum configurado)';
  return `Produtos disponiveis: ${lista}`;
}

async function buildUsersText(env) {
  const list = await listUsers(env);
  return list.length
    ? `*Usuarios autorizados (${list.length}):*\n` + list.map(id => `- \`${id}\``).join('\n')
    : 'Nenhum usuario autorizado alem do root.';
}

function mainMenuKeyboard(env, authorized, isRoot) {
  const rows = [
    [
      { text: 'Meu ID', callback_data: 'cmd:myid' },
      { text: 'Ajuda', callback_data: 'cmd:ajuda' },
    ],
  ];

  if (authorized) {
    rows.push([{ text: 'Produtos', callback_data: 'cmd:produtos' }]);
    rows.push([
      { text: 'Ver staging', callback_data: 'cmd:versao_menu' },
      { text: 'Liberar staging', callback_data: 'cmd:liberar_menu' },
    ]);
  }

  if (isRoot) {
    rows.push([{ text: 'Usuarios', callback_data: 'cmd:usuarios' }]);
  }

  return { inline_keyboard: rows };
}

function productMenuKeyboard(env, action, backAction = 'cmd:menu') {
  const products = splitEnv(env.VALID_PRODUCTS);
  const rows = [];

  for (let i = 0; i < products.length; i += 2) {
    rows.push(
      products.slice(i, i + 2).map(p => ({
        text: p,
        callback_data: `${action}:${p}`,
      }))
    );
  }

  rows.push([{ text: 'Voltar', callback_data: backAction }]);
  return { inline_keyboard: rows };
}

function confirmLiberarKeyboard(produto) {
  return {
    inline_keyboard: [
      [
        { text: 'Confirmar liberacao', callback_data: `liberar_confirm:${produto}` },
        { text: 'Cancelar', callback_data: 'liberar_cancel' },
      ],
    ],
  };
}

async function handleVersao(ctx, produtoRaw, send) {
  const { owner, repo } = githubRepo(ctx.env);
  const produto = resolveProduct(ctx.env, produtoRaw);
  if (!produto) {
    const valid = splitEnv(ctx.env.VALID_PRODUCTS).join(', ') || '(nenhum)';
    await send(`Erro: produto desconhecido: *${esc(produtoRaw)}*\nProdutos validos: ${valid}`, true);
    return;
  }

  try {
    const res = await ghGet(ctx.env.GITHUB_TOKEN, owner, repo, `${produto}/teste.json`);
    if (res.status === 404) {
      await send(`Erro: produto *${esc(produto)}* nao encontrado.`, true, mainMenuKeyboard(ctx.env, ctx.authorized, ctx.isRoot));
      return;
    }
    const data    = await res.json();
    const content = decodeGhContent(data.content);
    await send(
      `*Staging de ${esc(produto)}:*\n\`\`\`\n${JSON.stringify(content, null, 2)}\n\`\`\``,
      true,
      productMenuKeyboard(ctx.env, 'versao', 'cmd:menu')
    );
  } catch (err) {
    await send(`Erro: ${err.message}`);
  }
}

async function handleRemover(ctx, produtoRaw, cnpjRaw, send) {
  const { owner, repo } = githubRepo(ctx.env);
  if (!owner || !repo) {
    await send('Erro: REPO_OWNER/REPO_NAME nao configurados no worker.', true);
    return;
  }

  const produto = resolveProduct(ctx.env, produtoRaw);
  if (!produto) {
    const valid = splitEnv(ctx.env.VALID_PRODUCTS).join(', ') || '(nenhum)';
    await send(`Erro: produto desconhecido: *${esc(produtoRaw)}*\nProdutos validos: ${valid}`, true);
    return;
  }

  const cnpj = normalizeDigits(cnpjRaw);
  if (!cnpj) {
    await send(`Erro: CPF/CNPJ invalido: *${esc(cnpjRaw)}*`, true);
    return;
  }

  try {
    const found = await findGithubFile(ctx.env.GITHUB_TOKEN, owner, repo, produto, cnpj);
    if (!found.res?.ok) {
      const status = found.res?.status ?? 'sem resposta';
      await send(
        `Erro: arquivo *${esc(found.path)}* nao encontrado em \`${owner}/${repo}\` (HTTP ${status}).`,
        true
      );
      return;
    }

    const { sha } = await found.res.json();
    const delRes = await ghDelete(
      ctx.env.GITHUB_TOKEN, owner, repo, found.path, sha,
      `chore: remove ${found.path} via Telegram (${ctx.username})`
    );
    if (!delRes.ok) {
      const body = await delRes.text();
      await send(`Erro: falha ao remover (${delRes.status}):\n${body.slice(0, 300)}`);
    } else {
      await send(`*${esc(found.path)}* removido com sucesso.`, true);
    }
  } catch (err) {
    await send(`Erro: ${err.message}`);
  }
}

async function handleLiberar(ctx, sistemaRaw, arg2, arg3, send) {
  const { owner, repo } = githubRepo(ctx.env);
  const sistema = resolveProduct(ctx.env, sistemaRaw);
  if (!sistema) {
    const valid = splitEnv(ctx.env.VALID_PRODUCTS).join(', ') || '(nenhum)';
    await send(
      `Erro: produto desconhecido: *${esc(sistemaRaw)}*\nProdutos validos: ${valid}`,
      true
    );
    return;
  }

  try {
    const alvo = arg3 ? normalizeDigits(arg3) : sistema;

    if (arg3 && !alvo) {
      await send(`Erro: CPF/CNPJ invalido: *${esc(arg3)}*`, true);
      return;
    }

    if (arg3 && arg2 && isPrVersion(arg2)) {
      await send(assertReleaseBlockedMessage(), true);
      return;
    }

    const destPath = `${sistema}/${alvo}.json`;
    let contentB64;

    if (arg2) {
      const versao = arg2;

      if (isPrVersion(versao)) {
        await send(assertReleaseBlockedMessage(), true);
        return;
      }

      const manifestPath = `${sistema}/${versao}.json`;
      const srcRes = await ghGet(ctx.env.GITHUB_TOKEN, owner, repo, manifestPath);

      if (srcRes.ok) {
        contentB64 = (await srcRes.json()).content;
      } else {
        const vUnder = versao.replace(/\./g, '_');
        const url    = `https://github.com/${owner}/${repo}/releases/download/${sistema}-v${versao}/pollaris.${sistema}_${vUnder}.zip`;
        const json   = JSON.stringify({ versao, url, obrigatorio: true });
        contentB64   = btoa(json);
      }
    } else {
      const srcPath = `${sistema}/teste.json`;
      const srcRes  = await ghGet(ctx.env.GITHUB_TOKEN, owner, repo, srcPath);
      if (srcRes.status === 404) {
        await send(`Erro: arquivo *${esc(srcPath)}* nao encontrado.`, true);
        return;
      }
      if (!srcRes.ok) {
        await send(`Erro ao ler GitHub (${srcRes.status}).`);
        return;
      }
      contentB64 = (await srcRes.json()).content;
    }

    const manifest = decodeGhContent(contentB64);
    const blocked = assertReleaseAllowed(manifest);
    if (blocked) {
      await send(blocked, true);
      return;
    }

    const destRes = await ghGet(ctx.env.GITHUB_TOKEN, owner, repo, destPath);
    const destSha = destRes.ok ? (await destRes.json()).sha : undefined;

    const putRes = await ghPut(
      ctx.env.GITHUB_TOKEN, owner, repo, destPath, contentB64,
      `release: ${sistema}/${alvo} via Telegram (${ctx.username})`,
      destSha
    );

    if (!putRes.ok) {
      const body = await putRes.text();
      await send(`Erro: falha no commit (${putRes.status}):\n${body}`);
    } else {
      const acao = destSha ? 'atualizado' : 'criado';
      await send(`*${esc(destPath)}* ${acao} com sucesso.`, true, mainMenuKeyboard(ctx.env, ctx.authorized, ctx.isRoot));
    }
  } catch (err) {
    await send(`Erro interno: ${err.message}`);
  }
}

function isPrManifest(manifest) {
  if (manifest?.versao && isPrVersion(manifest.versao)) return true;
  const url = String(manifest?.url ?? '');
  if (url.includes('-prv-')) return true;
  const tag = String(manifest?.tag ?? '');
  if (tag.includes('-prv-')) return true;
  return false;
}

function assertReleaseBlockedMessage() {
  return (
    'Erro: versoes de PR nao podem ser liberadas para clientes.\n' +
    'Use o seletor de versao no Green com *Colaborando* ativo.'
  );
}

function assertReleaseAllowed(manifest) {
  if (isPrManifest(manifest)) return assertReleaseBlockedMessage();
  return null;
}

function normalizeCommandText(text) {
  return String(text ?? '').replace(/^(\/\w+)@\S+/i, '$1').trim();
}

// Username do bot: usa BOT_USERNAME se configurado; senao descobre via
// getMe e guarda em cache no escopo do modulo (persiste por isolate).
// Sem username conhecido, o bot fica mudo em grupos para nao responder tudo.
let cachedBotUsername = null;

async function getBotUsername(env) {
  if (env.BOT_USERNAME) return String(env.BOT_USERNAME).replace(/^@/, '');
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const res  = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
    const data = await res.json();
    if (data?.ok && data.result?.username) {
      cachedBotUsername = data.result.username;
    }
  } catch {
    // rede falhou; tentaremos de novo na proxima mensagem
  }
  return cachedBotUsername;
}

// Gerenciamento de acesso (Cloudflare KV)

const KV_KEY = 'allowed_users';

async function isAuthorized(env, userId) {
  const seed = splitEnv(env.ALLOWED_USERS);
  if (seed.includes(userId)) return true;
  const stored = await env.POLLARIS_KV?.get(KV_KEY);
  if (!stored) return false;
  return JSON.parse(stored).includes(userId);
}

async function addUser(env, userId) {
  const stored = await env.POLLARIS_KV?.get(KV_KEY);
  const list   = stored ? JSON.parse(stored) : [];
  if (!list.includes(userId)) {
    list.push(userId);
    await env.POLLARIS_KV?.put(KV_KEY, JSON.stringify(list));
  }
}

async function removeUser(env, userId) {
  const stored = await env.POLLARIS_KV?.get(KV_KEY);
  if (!stored) return;
  const list = JSON.parse(stored).filter(id => id !== userId);
  await env.POLLARIS_KV?.put(KV_KEY, JSON.stringify(list));
}

async function listUsers(env) {
  const stored  = await env.POLLARIS_KV?.get(KV_KEY);
  const dynamic = stored ? JSON.parse(stored) : [];
  const seed    = splitEnv(env.ALLOWED_USERS);
  return [...new Set([...seed, ...dynamic])];
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent':  'pollaris-bot/1.0',
    Accept:        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function trimEnv(value) {
  return String(value ?? '').trim();
}

function githubRepo(env) {
  return {
    owner: trimEnv(env.REPO_OWNER),
    repo:  trimEnv(env.REPO_NAME),
  };
}

function resolveProduct(env, input) {
  const raw = trimEnv(input);
  if (!raw) return null;
  const products = splitEnv(env.VALID_PRODUCTS);
  if (!products.length) return raw.toLowerCase();
  const match = products.find(p => p.toLowerCase() === raw.toLowerCase());
  return match ? match.toLowerCase() : null;
}

function ghEncodePath(path) {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

async function findGithubFile(token, owner, repo, produto, cnpj) {
  const directPath = `${produto}/${cnpj}.json`;
  let res = await ghGet(token, owner, repo, directPath);
  if (res.ok) return { path: directPath, res };

  const listRes = await ghGet(token, owner, repo, produto);
  if (listRes.ok) {
    const items = await listRes.json();
    if (Array.isArray(items)) {
      const hit = items.find(item =>
        item.type === 'file' &&
        item.name.toLowerCase().endsWith('.json') &&
        normalizeDigits(item.name.replace(/\.json$/i, '')) === cnpj
      );
      if (hit) {
        const path = `${produto}/${hit.name}`;
        res = await ghGet(token, owner, repo, path);
        if (res.ok) return { path, res };
      }
    }
  }

  return { path: directPath, res };
}

function ghGet(token, owner, repo, path) {
  return fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${ghEncodePath(path)}`,
    { headers: ghHeaders(token) }
  );
}

function ghPut(token, owner, repo, path, contentBase64, message, sha) {
  const body = { message, content: contentBase64 };
  if (sha) body.sha = sha;
  return fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${ghEncodePath(path)}`,
    {
      method:  'PUT',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }
  );
}

function ghDelete(token, owner, repo, path, sha, message) {
  return fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${ghEncodePath(path)}`,
    {
      method:  'DELETE',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, sha }),
    }
  );
}

function sendMessage(token, chatId, text, markdown = false, replyMarkup = null) {
  const body = { chat_id: chatId, text };
  if (markdown) body.parse_mode = 'Markdown';
  if (replyMarkup) body.reply_markup = replyMarkup;
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

function editMessage(token, chatId, messageId, text, markdown = false, replyMarkup = null) {
  const body = { chat_id: chatId, message_id: messageId, text };
  if (markdown) body.parse_mode = 'Markdown';
  if (replyMarkup) body.reply_markup = replyMarkup;
  return fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

function answerCallbackQuery(token, callbackQueryId, text = null) {
  const body = { callback_query_id: callbackQueryId };
  if (text) body.text = text;
  return fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

function splitEnv(str) {
  return (str ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

function normalizeDigits(str) {
  return String(str ?? '').replace(/\D/g, '');
}

function decodeGhContent(contentB64) {
  return JSON.parse(atob(String(contentB64).replace(/\n/g, '')));
}

function esc(str) {
  return str.replace(/[_*`[\]]/g, '\\$&');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Versao de PR: 3o segmento > 0 (ex.: 3.0.27.1). Main: 3.0.0.111 */
function isPrVersion(versao) {
  const parts = String(versao ?? '').split('.').map(Number);
  if (parts.length < 4 || parts.some(n => Number.isNaN(n))) return false;
  return parts[2] > 0;
}
