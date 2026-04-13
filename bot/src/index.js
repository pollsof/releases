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
 *   /remover {sistema} {cnpj}             -> remove {sistema}/{cnpj}.json do repositorio
 *   /versao  {sistema}                    -> exibe conteudo atual de {sistema}/teste.json
 *   /produtos                             -> lista os produtos disponiveis
 *
 * Root (administrador raiz):
 *   /acesso  {userid}                     -> concede acesso a um usuario
 *   /revogar {userid}                     -> revoga acesso de um usuario
 *   /usuarios                             -> lista todos os usuarios autorizados
 */

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('OK', { status: 200 });

    let update;
    try { update = await request.json(); } catch { return new Response('OK', { status: 200 }); }

    const message = update?.message ?? update?.edited_message;
    if (!message?.text) return new Response('OK', { status: 200 });

    const chatId     = message.chat.id;
    const userId     = String(message.from?.id ?? '');
    const rawText    = message.text.trim();
    const isGroup    = message.chat.type === 'group' || message.chat.type === 'supergroup';
    const botMention = env.BOT_USERNAME ? `@${env.BOT_USERNAME}` : null;
    const reply      = (msg, md = false) => sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, md);

    if (isGroup && botMention && !rawText.includes(botMention)) {
      return new Response('OK', { status: 200 });
    }

    const text = botMention
      ? rawText.replace(new RegExp(escapeRegex(botMention), 'gi'), '').trim()
      : rawText;

    const isRoot = env.ROOT_ID && userId === String(env.ROOT_ID);

    // /myid -- publico
    if (/^\/myid/i.test(text)) {
      await reply(`\uD83E\uDEAA Seu ID: \`${userId}\``, true);
      return new Response('OK', { status: 200 });
    }

    // /ajuda -- publico
    if (/^\/ajuda/i.test(text)) {
      const lines = [
        '\uD83D\uDCD6 *Comandos dispon\u00EDveis:*',
        '',
        '`/myid` \u2014 seu ID do Telegram',
        '`/ajuda` \u2014 esta mensagem',
        '',
        '*Para autorizados:*',
        '`/produtos` \u2014 lista de produtos',
        '`/versao {sistema}` \u2014 vers\u00E3o em staging',
        '`/liberar {sistema}` \u2014 publica de teste para produ\u00E7\u00E3o',
        '`/liberar {sistema} {versao}` \u2014 publica vers\u00E3o espec\u00EDfica',
        '`/liberar {sistema} {versao} {cnpj}` \u2014 publica vers\u00E3o para CNPJ',
        '`/remover {sistema} {cnpj}` \u2014 remove arquivo do reposit\u00F3rio',
      ];
      if (isRoot) {
        lines.push('', '*Root:*');
        lines.push('`/acesso {userid}` \u2014 concede acesso');
        lines.push('`/revogar {userid}` \u2014 revoga acesso');
        lines.push('`/usuarios` \u2014 lista usu\u00E1rios autorizados');
      }
      await reply(lines.join('\n'), true);
      return new Response('OK', { status: 200 });
    }

    if (!isRoot && !(await isAuthorized(env, userId))) {
      return new Response('OK', { status: 200 });
    }

    const username = message.from?.username
      ? `@${message.from.username}`
      : (message.from?.first_name ?? `user ${userId}`);

    // /acesso {userid}
    const matchAcesso = text.match(/^\/acesso\s+(\d+)/i);
    if (matchAcesso) {
      if (!isRoot) return new Response('OK', { status: 200 });
      const target = matchAcesso[1];
      await addUser(env, target);
      await reply(`\u2705 Acesso concedido para ID \`${target}\`.`, true);
      return new Response('OK', { status: 200 });
    }

    // /revogar {userid}
    const matchRevogar = text.match(/^\/revogar\s+(\d+)/i);
    if (matchRevogar) {
      if (!isRoot) return new Response('OK', { status: 200 });
      const target = matchRevogar[1];
      await removeUser(env, target);
      await reply(`\uD83D\uDEAB Acesso revogado para ID \`${target}\`.`, true);
      return new Response('OK', { status: 200 });
    }

    // /usuarios
    if (/^\/usuarios/i.test(text)) {
      if (!isRoot) return new Response('OK', { status: 200 });
      const list = await listUsers(env);
      const msg = list.length
        ? `\uD83D\uDC65 *Usu\u00E1rios autorizados (${list.length}):*\n` + list.map(id => `\u2022 \`${id}\``).join('\n')
        : '\uD83D\uDC65 Nenhum usu\u00E1rio autorizado al\u00E9m do root.';
      await reply(msg, true);
      return new Response('OK', { status: 200 });
    }

    // /produtos
    if (/^\/produtos/i.test(text)) {
      const lista = splitEnv(env.VALID_PRODUCTS).join(', ') || '(nenhum configurado)';
      await reply(`\uD83D\uDCE6 Produtos dispon\u00EDveis: ${lista}`);
      return new Response('OK', { status: 200 });
    }

    // /versao {produto}
    const matchVersao = text.match(/^\/versao\s+(\S+)/i);
    if (matchVersao) {
      const produto = matchVersao[1].toLowerCase();
      try {
        const res = await ghGet(env.GITHUB_TOKEN, env.REPO_OWNER, env.REPO_NAME, `${produto}/teste.json`);
        if (res.status === 404) {
          await reply(`\u274C Produto *${esc(produto)}* n\u00E3o encontrado.`, true);
          return new Response('OK', { status: 200 });
        }
        const data    = await res.json();
        const content = JSON.parse(atob(data.content.replace(/\n/g, '')));
        await reply(
          `\uD83D\uDCCB *Staging de ${esc(produto)}:*\n\`\`\`\n${JSON.stringify(content, null, 2)}\n\`\`\``,
          true
        );
      } catch (err) {
        await reply(`\u274C Erro: ${err.message}`);
      }
      return new Response('OK', { status: 200 });
    }

    // /remover {produto} {cnpj}
    const matchRemover = text.match(/^\/remover\s+(\S+)\s+(\S+)/i);
    if (matchRemover) {
      const produto = matchRemover[1].toLowerCase();
      const cnpj    = matchRemover[2];
      const path    = `${produto}/${cnpj}.json`;
      try {
        const res = await ghGet(env.GITHUB_TOKEN, env.REPO_OWNER, env.REPO_NAME, path);
        if (res.status === 404) {
          await reply(`\u274C Arquivo *${esc(path)}* n\u00E3o existe.`, true);
          return new Response('OK', { status: 200 });
        }
        const { sha } = await res.json();
        const delRes = await ghDelete(
          env.GITHUB_TOKEN, env.REPO_OWNER, env.REPO_NAME, path, sha,
          `chore: remove ${path} via Telegram (${username})`
        );
        if (!delRes.ok) {
          await reply(`\u274C Falha ao remover (${delRes.status}).`);
        } else {
          await reply(`\uD83D\uDDD1\uFE0F *${esc(path)}* removido com sucesso.`, true);
        }
      } catch (err) {
        await reply(`\u274C Erro: ${err.message}`);
      }
      return new Response('OK', { status: 200 });
    }

    // /liberar {sistema} [{versao} [{cnpj}]]
    const matchLiberar = text.match(/^\/liberar\s+(\S+)(?:\s+(\S+))?(?:\s+(\S+))?/i);
    if (matchLiberar) {
      const sistema = matchLiberar[1].toLowerCase();
      const arg2    = matchLiberar[2];  // versao (se presente)
      const arg3    = matchLiberar[3];  // cnpj   (se presente)

      const validProducts = splitEnv(env.VALID_PRODUCTS);
      if (validProducts.length > 0 && !validProducts.includes(sistema)) {
        await reply(`\u274C Produto desconhecido: *${esc(sistema)}*\nProdutos v\u00E1lidos: ${validProducts.join(', ')}`, true);
        return new Response('OK', { status: 200 });
      }

      try {
        const alvo     = arg3 ?? sistema;
        const destPath = `${sistema}/${alvo}.json`;
        let contentB64;

        if (arg2) {
          // Versao informada: gerar JSON
          const versao = arg2;
          const vUnder = versao.replace(/\./g, '_');
          const url    = `https://github.com/${env.REPO_OWNER}/${env.REPO_NAME}/releases/download/${sistema}-v${versao}/pollaris.${sistema}_${vUnder}.zip`;
          const json   = JSON.stringify({ versao, url, obrigatorio: true });
          contentB64   = btoa(json);
        } else {
          // Sem versao: copiar de teste.json
          const srcPath = `${sistema}/teste.json`;
          const srcRes  = await ghGet(env.GITHUB_TOKEN, env.REPO_OWNER, env.REPO_NAME, srcPath);
          if (srcRes.status === 404) {
            await reply(`\u274C Arquivo *${esc(srcPath)}* n\u00E3o encontrado.`, true);
            return new Response('OK', { status: 200 });
          }
          if (!srcRes.ok) {
            await reply(`\u274C Erro ao ler GitHub (${srcRes.status}).`);
            return new Response('OK', { status: 200 });
          }
          contentB64 = (await srcRes.json()).content;
        }

        const destRes = await ghGet(env.GITHUB_TOKEN, env.REPO_OWNER, env.REPO_NAME, destPath);
        const destSha = destRes.ok ? (await destRes.json()).sha : undefined;

        const putRes = await ghPut(
          env.GITHUB_TOKEN, env.REPO_OWNER, env.REPO_NAME, destPath, contentB64,
          `release: ${sistema}/${alvo} via Telegram (${username})`,
          destSha
        );

        if (!putRes.ok) {
          const body = await putRes.text();
          await reply(`\u274C Falha no commit (${putRes.status}):\n${body}`);
        } else {
          const acao = destSha ? 'atualizado' : 'criado';
          await reply(`\u2705 *${esc(destPath)}* ${acao} com sucesso!`, true);
        }
      } catch (err) {
        await reply(`\u274C Erro interno: ${err.message}`);
      }
      return new Response('OK', { status: 200 });
    }

    return new Response('OK', { status: 200 });
  }
};

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

function ghGet(token, owner, repo, path) {
  return fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    { headers: ghHeaders(token) }
  );
}

function ghPut(token, owner, repo, path, contentBase64, message, sha) {
  const body = { message, content: contentBase64 };
  if (sha) body.sha = sha;
  return fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    {
      method:  'PUT',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }
  );
}

function ghDelete(token, owner, repo, path, sha, message) {
  return fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    {
      method:  'DELETE',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, sha }),
    }
  );
}

function sendMessage(token, chatId, text, markdown = false) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      chat_id:    chatId,
      text,
      parse_mode: markdown ? 'Markdown' : undefined,
    }),
  });
}

function splitEnv(str) {
  return (str ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

function esc(str) {
  return str.replace(/[_*`[\]]/g, '\\$&');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
