import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketSkillsDir } from './skill-market.mjs';

const REPO_SKILLS = fileURLToPath(new URL('../skills/', import.meta.url));

function parseSkillMarkdown(raw, meta = {}) {
  const lines = raw.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    if (lines[i]?.trim() === '---') i++;
  }
  const body = lines.slice(i).join('\n').trim();
  const titleLine = lines.slice(i).find(l => l.startsWith('#'));
  const name = meta.name || (titleLine ? titleLine.replace(/^#+\s*/, '').trim() : meta.fileName);
  const description = meta.description || body.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim().slice(0, 200) || '';
  return { name, description, content: body || raw.trim() };
}

function readSkillFile(absPath, source) {
  try {
    const raw = readFileSync(absPath, 'utf8');
    const fileName = basename(absPath, '.md');
    const parsed = parseSkillMarkdown(raw, { fileName, name: fileName.replace(/-/g, ' ') });
    return {
      id: `${source}:${basename(absPath, '.md')}`,
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      source,
      path: absPath
    };
  } catch {
    return null;
  }
}

function scanMarkdownDir(dir, source) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith('.md')) {
      const s = readSkillFile(join(dir, ent.name), source);
      if (s) out.push(s);
    }
    if (ent.isDirectory() && (source === 'cursor' || source === 'market')) {
      const skillMd = join(dir, ent.name, 'SKILL.md');
      if (existsSync(skillMd)) {
        const s = readSkillFile(skillMd, source);
        if (s) {
          s.name = ent.name.replace(/-/g, ' ');
          // Skill do Marketplace: os scripts dela ficam em /skills/<id> no computador do agente.
          if (source === 'market') s.content += `

---
Arquivos desta skill no seu computador: /skills/${ent.name} (somente leitura). Para rodar, copie para /work: cp -r /skills/${ent.name} /work/${ent.name}`;
          out.push(s);
        }
      }
    }
  }
  return out;
}

/** Skills descobertas fora do db (repo + Marketplace + ~/.cursor/skills-cursor). */
export function discoverBundledSkills() {
  const cursorHome = join(homedir(), '.cursor', 'skills-cursor');
  return [
    ...scanMarkdownDir(REPO_SKILLS, 'bundled'),
    ...scanMarkdownDir(marketSkillsDir(), 'market'),
    ...scanMarkdownDir(cursorHome, 'cursor')
  ];
}

export function visibleDbSkills(db, chat) {
  return db.skills.filter(k => !k.projectId || k.projectId === chat?.projectId);
}

export function listSkillsCatalog(db, chat) {
  const dbSkills = visibleDbSkills(db, chat).map(k => ({
    id: k.id,
    name: k.name,
    description: k.description || '',
    source: 'user',
    projectId: k.projectId || null
  }));
  const seen = new Set(dbSkills.map(k => k.name.toLowerCase()));
  const discovered = discoverBundledSkills()
    .filter(s => !seen.has(s.name.toLowerCase()))
    .map(({ id, name, description, source }) => ({ id, name, description, source }));
  return [...dbSkills, ...discovered];
}

export function resolveSkillContent(name, db, chat) {
  const key = String(name).trim().toLowerCase();
  const fromDb = visibleDbSkills(db, chat).find(k => k.name.toLowerCase() === key);
  if (fromDb) return { name: fromDb.name, content: fromDb.content, source: 'user' };
  const bundled = discoverBundledSkills().find(s => s.name.toLowerCase() === key || basename(s.path, '.md').toLowerCase() === key.replace(/\s+/g, '-'));
  if (bundled) return { name: bundled.name, content: bundled.content, source: bundled.source };
  return null;
}

/** Resumo para list_skills / prompt (sem conteúdo completo). */
export function formatSkillsList(db, chat) {
  const items = listSkillsCatalog(db, chat);
  if (!items.length) return 'Nenhuma skill disponível. Use save_skill para criar uma ou adicione arquivos .md em skills/.';
  return items.map(k => `${k.name} (${k.source})${k.description ? ': ' + k.description : ''}`).join('\n');
}
