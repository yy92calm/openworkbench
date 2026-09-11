#!/usr/bin/env node
// Skill catalog budget lint (Codex parity: name <= 64, description <= 1024).
// The skill catalog is injected into every session's system prompt — an
// over-long description is a permanent per-turn token cost, and a missing
// description breaks model-side skill selection. Lint only: never rewrite.
//
// Two structural checks (docs/20260911-01):
//   a) reference existence — `references/…` / `scripts/…` file paths mentioned
//      in a skill's SKILL.md must exist under that skill dir; a stale pointer
//      silently breaks progressive disclosure.
//   b) methodology template — finance-core/references/*.md must keep the
//      five-section contract's stable headings (何时参考/核心目标/避坑). The
//      step-section heading varies by knowledge type (分析步骤/主要内容/
//      主要框架) and is not enforced. The output-spec file is exempt.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'app-config', '.opencode', 'skills');
const NAME_MAX = 64;
const DESC_MAX = 1024;

// A path mention counts only when references/ or scripts/ starts a token
// (preceded by start/whitespace/backtick/quote/paren) — this skips embedded
// occurrences like `skills/html-review/scripts/review_html.py` whose real
// anchor is the skills/ prefix, not the skill-root-relative scripts/ dir.
const REF_PATH_RE = /(?:^|[\s`"(])((?:references|scripts)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g;

// skill-creator is the meta-skill that teaches skill anatomy — its body is
// full of hypothetical example paths (scripts/rotate_pdf.py, references/finance.md …)
// that are lessons, not pointers. Its two real references are checked by hand.
const REF_CHECK_EXEMPT = new Set(['skill-creator']);

const FINANCE_CORE_EXEMPT = new Set(['html-report-style.md']);
const FIVE_SECTION_REQUIRED = ['何时参考', '核心目标', '避坑'];

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^(name|description):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

if (!existsSync(ROOT)) {
  console.error(`skills dir not found: ${ROOT}`);
  process.exit(1);
}

const violations = [];
let count = 0;
for (const entry of readdirSync(ROOT)) {
  const file = join(ROOT, entry, 'SKILL.md');
  if (!statSync(join(ROOT, entry)).isDirectory() || !existsSync(file)) continue;
  count++;
  const text = readFileSync(file, 'utf-8');
  const fm = parseFrontmatter(text);
  if (!fm) {
    violations.push(`${entry}: missing or malformed frontmatter`);
    continue;
  }
  if (!fm.name) violations.push(`${entry}: frontmatter has no name`);
  else if (fm.name.length > NAME_MAX)
    violations.push(`${entry}: name ${fm.name.length} > ${NAME_MAX} chars`);
  if (!fm.description) violations.push(`${entry}: frontmatter has no description`);
  else if (fm.description.length > DESC_MAX)
    violations.push(`${entry}: description ${fm.description.length} > ${DESC_MAX} chars`);

  // (a) reference existence: every references/… or scripts/… file path named
  // in SKILL.md must resolve under the skill dir.
  const body = text.slice(text.indexOf('\n---', 3) + 4);
  if (!REF_CHECK_EXEMPT.has(entry)) {
    for (const m of body.matchAll(REF_PATH_RE)) {
      if (!existsSync(join(ROOT, entry, m[1])))
        violations.push(`${entry}: SKILL.md points at missing file ${m[1]}`);
    }
  }

  // (b) methodology template (finance-core only — the ported five-section pack).
  if (entry === 'finance-core') {
    const refDir = join(ROOT, entry, 'references');
    for (const ref of readdirSync(refDir)) {
      if (!ref.endsWith('.md') || FINANCE_CORE_EXEMPT.has(ref)) continue;
      const content = readFileSync(join(refDir, ref), 'utf-8');
      for (const heading of FIVE_SECTION_REQUIRED) {
        if (!content.includes(heading))
          violations.push(`${entry}/references/${ref}: missing template section ${heading}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`skill catalog lint failed (${count} skills scanned):`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`skill catalog lint ok (${count} skills scanned)`);
