import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReleaseBody,
  formatReleaseTelegramMessage,
} from './format-release-telegram.mjs';

describe('formatReleaseTelegramMessage', () => {
  it('espelha a release de producao e so inclui o zip', () => {
    const message = formatReleaseTelegramMessage({
      name: 'Pollaris Tech v1.0.0.3',
      tag_name: 'tech-v1.0.0.3',
      body: [
        '## Pollaris Tech v1.0.0.3',
        '',
        '### Novidades e Melhorias',
        '',
        '- fix: keep Tech lockup aspect ratio when scaling (8f03031)',
        '- feat: swap Tech lockup and watermark to new kit (1f58846)',
        '',
        '---',
        '',
        '**Download:** [pollaris.tech_1_0_0_3.zip](https://github.com/pollsof/releases/releases/download/tech-v1.0.0.3/pollaris.tech_1_0_0_3.zip)',
        '',
        '**Configuracao de atualizacao:** `https://releases.pollaris.com.br/tech/teste.json`',
        '',
      ].join('\n'),
      assets: [
        {
          name: 'pollaris.tech_1_0_0_3.zip',
          browser_download_url:
            'https://github.com/pollsof/releases/releases/download/tech-v1.0.0.3/pollaris.tech_1_0_0_3.zip',
        },
        {
          name: 'Source code (zip)',
          browser_download_url: 'https://github.com/pollsof/releases/archive/refs/tags/tech-v1.0.0.3.zip',
        },
      ],
    });

    assert.equal(
      message,
      [
        'Pollaris Tech v1.0.0.3',
        '',
        'Novidades e Melhorias',
        '',
        '- fix: keep Tech lockup aspect ratio when scaling (8f03031)',
        '- feat: swap Tech lockup and watermark to new kit (1f58846)',
        '',
        'Download: pollaris.tech_1_0_0_3.zip',
        'https://github.com/pollsof/releases/releases/download/tech-v1.0.0.3/pollaris.tech_1_0_0_3.zip',
      ].join('\n')
    );
    assert.equal(message.includes('teste.json'), false);
    assert.equal(message.includes('Source code'), false);
  });

  it('espelha pre-release e so linka o zip', () => {
    const message = formatReleaseTelegramMessage({
      name: 'Pollaris Green PR #34.13 v3.0.34.13',
      tag_name: 'green-prv-34.13',
      prerelease: true,
      body: [
        '## Preview Build',
        '',
        '- Pull request: [PR #34.13](https://github.com/pollsof/green/pull/34)',
        '- Branch: feature/feature-emissao-fiscal',
        '- Commit: b376186',
        '- Download: [pollaris.green_3_0_34_13.zip](https://github.com/pollsof/releases/releases/download/green-prv-34.13/pollaris.green_3_0_34_13.zip)',
        '',
        'Use o seletor de versao no Green com *Colaborando* ativo para testar esta build.',
      ].join('\n'),
      assets: [
        {
          name: 'pollaris.green_3_0_34_13.zip',
          browser_download_url:
            'https://github.com/pollsof/releases/releases/download/green-prv-34.13/pollaris.green_3_0_34_13.zip',
        },
      ],
    });

    assert.equal(
      message,
      [
        'Pollaris Green PR #34.13 v3.0.34.13',
        '',
        'Preview Build',
        '',
        '- Pull request: PR #34.13',
        '- Branch: feature/feature-emissao-fiscal',
        '- Commit: b376186',
        '- Download: pollaris.green_3_0_34_13.zip',
        'https://github.com/pollsof/releases/releases/download/green-prv-34.13/pollaris.green_3_0_34_13.zip',
        '',
        'Use o seletor de versao no Green com Colaborando ativo para testar esta build.',
      ].join('\n')
    );
  });

  it('anexa o zip se o body nao tiver o link', () => {
    const message = formatReleaseTelegramMessage({
      name: 'Pollaris Snack v2.0.0.1',
      tag_name: 'snack-v2.0.0.1',
      body: '### Novidades e Melhorias\n\n- feat: foo',
      assets: [
        {
          name: 'pollaris.snack_2_0_0_1.zip',
          browser_download_url:
            'https://github.com/pollsof/releases/releases/download/snack-v2.0.0.1/pollaris.snack_2_0_0_1.zip',
        },
      ],
    });

    assert.match(message, /pollaris\.snack_2_0_0_1\.zip\nhttps:\/\/github\.com\/pollsof\/releases/);
  });
});

describe('formatReleaseBody', () => {
  it('remove configuracao json e mantem o zip', () => {
    const body = formatReleaseBody(
      '**Download:** [app.zip](https://example.com/app.zip)\n\n**Configuracao de atualizacao:** `https://releases.pollaris.com.br/tech/teste.json`'
    );
    assert.match(body, /app\.zip\nhttps:\/\/example.com\/app\.zip/);
    assert.equal(body.includes('teste.json'), false);
  });
});
