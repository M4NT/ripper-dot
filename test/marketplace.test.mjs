import test from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTORS, filterCatalog, matchesQuery, catalogById } from '../web/src/marketplace/catalog.js';
import {
  STATUS, installPlugin, isPluginInstalled, primaryAction, resolveConnectorStatus, filterByStatus
} from '../web/src/marketplace/state.js';
import { runInNewContext } from 'node:vm';
import { authorizationRequestParams, generatePkce, oauthCallbackHtml, oauthCallbackScript, escapeHtml } from '../lib/mcp-oauth.mjs';
import { isTrustedOAuthEvent, OAUTH_MESSAGE_TYPE } from '../web/src/marketplace/mcpOAuth.js';

test('catálogo único: busca acha GitHub e Stripe na lista toda', () => {
  assert.ok(CONNECTORS.some(c => c.id === 'github'));
  assert.ok(CONNECTORS.some(c => c.id === 'stripe'));
  const gh = filterCatalog(CONNECTORS, { q: 'github' });
  assert.equal(gh.length, 1);
  assert.equal(gh[0].id, 'github');
  assert.ok(matchesQuery(catalogById('google-calendar'), 'agenda'));
  assert.ok(matchesQuery(catalogById('atlassian'), 'jira'));
});

test('filtros de categoria, auth e verificado', () => {
  const seo = filterCatalog(CONNECTORS, { category: 'seo' });
  assert.ok(seo.every(c => c.category === 'seo'));
  assert.ok(seo.some(c => c.id === 'google-analytics'));
  const oauth = filterCatalog(CONNECTORS, { auth: 'oauth' });
  assert.ok(oauth.every(c => c.connect.type === 'oauth'));
  const verified = filterCatalog(CONNECTORS, { verified: true });
  assert.ok(verified.length >= oauth.length);
});

test('token ou local instalado conta como conectado, não como login pendente', () => {
  const gh = catalogById('github');
  const settings = { plugins: [{ name: 'github', type: 'http', url: 'https://api.githubcopilot.com/mcp/', enabled: true, auth: { apiKey: 'x' } }] };
  const st = resolveConnectorStatus({
    cat: gh,
    settings,
    authByName: { github: { state: 'lazy', reason: 'Login será solicitado quando o servidor exigir.' } }
  });
  assert.equal(st.id, STATUS.connected);
});

test('estados: disponível → precisa autenticar → conectado / erro / desativado / expirado', () => {
  const notion = catalogById('notion');
  assert.equal(resolveConnectorStatus({ cat: notion, settings: { plugins: [] } }).id, STATUS.available);

  const installing = resolveConnectorStatus({ cat: notion, settings: { plugins: [] }, installing: true });
  assert.equal(installing.id, STATUS.installing);

  const saved = { plugins: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp', enabled: true, auth: { mode: 'oauth_now' } }] };
  assert.equal(resolveConnectorStatus({ cat: notion, settings: saved }).id, STATUS.needs_auth);

  const ok = resolveConnectorStatus({
    cat: notion,
    settings: saved,
    authByName: { notion: { state: 'ok' } }
  });
  assert.equal(ok.id, STATUS.connected);
  assert.equal(ok.label, 'Conectado');

  const expired = resolveConnectorStatus({
    cat: notion,
    settings: saved,
    authByName: { notion: { state: 'expired', reason: 'Token expirado' } }
  });
  assert.equal(expired.id, STATUS.expired);
  assert.equal(primaryAction(expired.id).id, 'reauth');

  const err = resolveConnectorStatus({ cat: notion, settings: saved, liveError: 'timeout' });
  assert.equal(err.id, STATUS.error);
  assert.equal(err.detail, 'timeout');
  assert.equal(primaryAction(err.id).label, 'Tentar de novo');

  const off = resolveConnectorStatus({
    cat: notion,
    settings: { plugins: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp', enabled: false }] }
  });
  assert.equal(off.id, STATUS.off);
});

test('claude.ai e Omie nativo têm estado próprio', () => {
  const gmail = catalogById('gmail');
  assert.equal(resolveConnectorStatus({ cat: gmail, claudeList: [] }).id, STATUS.available);
  assert.equal(resolveConnectorStatus({
    cat: gmail,
    claudeList: [{ name: 'Gmail', status: 'connected', tools: 4 }]
  }).id, STATUS.connected);
  assert.equal(resolveConnectorStatus({
    cat: gmail,
    claudeList: [{ name: 'Gmail', status: 'failed', error: 'login' }]
  }).id, STATUS.error);

  const omie = catalogById('omie-erp');
  assert.equal(resolveConnectorStatus({ cat: omie, omieCompanies: [] }).id, STATUS.available);
  assert.equal(resolveConnectorStatus({ cat: omie, omieCompanies: [{ slug: 'loja' }] }).id, STATUS.connected);
});

test('instalar de novo um personalizado não o apaga', () => {
  const settings = { plugins: [{ name: 'meu-mcp', type: 'http', url: 'https://mcp.example.com/mcp', enabled: true }] };
  const next = installPlugin('meu-mcp', settings);
  assert.equal(next.length, 1);
  assert.equal(next[0].url, 'https://mcp.example.com/mcp');
});

test('instalar OAuth marca login necessário; instalado ≠ autenticado', () => {
  const plugins = installPlugin('notion', { plugins: [] });
  assert.equal(plugins[0].auth.mode, 'oauth_now');
  assert.equal(isPluginInstalled('notion', { plugins }), true);
  const st = resolveConnectorStatus({ cat: catalogById('notion'), settings: { plugins } });
  assert.equal(st.id, STATUS.needs_auth);
});

test('filtro instalados esconde o que ainda está disponível', () => {
  const notion = catalogById('notion');
  const map = {
    notion: { id: STATUS.connected },
    gmail: { id: STATUS.available }
  };
  const shown = filterByStatus([notion, catalogById('gmail')], map, true);
  assert.deepEqual(shown.map(c => c.id), ['notion']);
});

test('authorize envia resource (RFC 8707) e PKCE S256', () => {
  const pkce = generatePkce();
  const params = authorizationRequestParams({
    clientId: 'cid',
    redirectUri: 'http://127.0.0.1:3000/api/mcp/oauth/callback',
    state: 'st',
    pkce,
    scope: 'mcp',
    resource: 'https://mcp.notion.com/mcp'
  });
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('resource'), 'https://mcp.notion.com/mcp');
  assert.equal(params.get('response_type'), 'code');
  assert.ok(params.get('code_challenge'));
});

test('página do callback usa script externo e não reflete texto externo no script', () => {
  const html = oauthCallbackHtml({ status: 'complete', message: 'Login concluído.', origin: 'http://127.0.0.1:3000' });
  assert.match(html, /src="\/oauth-callback\.js"/);
  assert.match(html, /data-status="complete"/);
  assert.doesNotMatch(html, /postMessage|ripper-mcp-oauth|access_token|refresh_token|Bearer /);
  const payload = '</script><script>alert(1)</script>';
  const evil = oauthCallbackHtml({ status: 'error', message: payload, origin: 'http://127.0.0.1:3000' });
  assert.match(evil, /&#60;\/script&#62;/);
  assert.doesNotMatch(evil, /<script>alert/);
  assert.match(evil, /data-status="error"/);
  assert.doesNotMatch(evil, /data-error|error_description/);
  assert.equal(escapeHtml('<x>'), '&#60;x&#62;');
});

test('oauth-callback.js envia só status, fecha o popup e respeita a origem', () => {
  const js = oauthCallbackScript();
  assert.match(js, /postMessage/);
  assert.match(js, /window\.close/);
  assert.doesNotMatch(js, /error_description|access_token/);
  let closed = false;
  let posted = null;
  const scheduled = [];
  runInNewContext(js, {
    document: { currentScript: { getAttribute: n => (n === 'data-status' ? 'complete' : n === 'data-origin' ? 'http://127.0.0.1:3000' : '') } },
    window: {
      opener: { postMessage: (m, o) => { posted = { m, o }; } },
      close: () => { closed = true; }
    },
    location: { origin: 'http://127.0.0.1:3000' },
    setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); }
  });
  assert.equal(posted.m.type, 'ripper-mcp-oauth');
  assert.equal(posted.m.status, 'complete');
  assert.equal(posted.o, 'http://127.0.0.1:3000');
  assert.equal(scheduled[0].ms, 800);
  scheduled[0].fn();
  assert.equal(closed, true);
});

test('postMessage OAuth exige origin e event.source === popup', () => {
  const popup = { id: 'popup' };
  const ok = { origin: 'http://app', source: popup, data: { type: OAUTH_MESSAGE_TYPE, status: 'complete' } };
  assert.equal(isTrustedOAuthEvent(ok, popup, 'http://app'), true);
  assert.equal(isTrustedOAuthEvent({ ...ok, source: { id: 'other' } }, popup, 'http://app'), false);
  assert.equal(isTrustedOAuthEvent({ ...ok, origin: 'http://evil' }, popup, 'http://app'), false);
});
