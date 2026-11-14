#!/usr/bin/env node
/**
 * i18n Audit Script
 * 运行: node scripts/i18n-audit.js
 * 扫描所有 .tsx 文件，报告潜在的硬编码 UI 文本问题
 */

const fs   = require("fs");
const path = require("path");

/* eslint-disable @typescript-eslint/no-require-imports */
// ── 配置 ──────────────────────────────────────────────────────────────────────
const SRC_DIR = path.join(__dirname, "../src/app");
const COMP_DIR = path.join(__dirname, "../src/components");

// 这些模式不算"硬编码UI文本"（枚举值、API字段、技术字符串、已翻译的 ?? / || 兜底）
const IGNORE_PATTERNS = [
  /console\.(log|error|warn)/,
  /throw new Error/,
  /method:\s*"(GET|POST|PATCH|DELETE|PUT)"/,
  /"(BUYER|SELLER|RENTER|LANDLORD|INVESTOR)"/,
  /"(LEAD|ACTIVE|INACTIVE|CLOSED|ARCHIVED|SOLD)"/,
  /"(SCHEDULED|COMPLETED|CANCELLED|PENDING|CONFIRMED)"/,
  /"(CONTRACT|DISCLOSURE|INSPECTION|APPRAISAL|OTHER)"/,
  /"(IMAGE|VIDEO|FLOORPLAN|DOCUMENT|PDF|PNG|JPG|DOCX|XLSX)"/,
  /"(CORE|PRO|ELITE|FIRMADMIN|SUPERADMIN|MANAGER|AGENT)"/,
  /"(PIPELINE|OFFERS|PAID|UNPAID|APPROVED|REJECTED|ACCEPTED|COUNTER|WITHDRAWN|EXPIRED)"/,
  /"(LISTING|SOCIAL|EMAIL|LETTER|FLYER|SHOWING|MEETING|CALL|OPEN_HOUSE|CLOSING|FOLLOW_UP)"/,
  /"(OFFER|APPOINTMENT|GIFT|TRANSACTION|MODIFICATION|REFERRAL|WEBSITE)"/,
  /"(HOT|WARM|COLD|LOW|MEDIUM|HIGH|URGENT)"/,
  /"(USD|EUR|GBP|CNY|JPY)"/,
  /"(left|right|top|bottom|center|auto)"/,
  /"(blue|green|red|purple|orange|yellow|gray|white|black)"/,
  /\?\?\s*"/, // nullish coalescing fallback after a translated key lookup
  /\|\|\s*"/, // logical OR fallback after a translated key lookup
  /Bearer\s/,
  /Authorization/,
  /Content-Type/,
  /application\/json/,
  /localhost:\d+/,
  /\.com|\.org|\.net|\.io/,
  /^\/\//, // comments
  /className=/,
  /placeholder=/,
  /type="(email|password|text|number|submit|button|checkbox|radio|file|date|tel)"/,
  /value="(true|false|0|1)"/,
  /import\s/,
  /from\s"/,
  /require\(/,
  /\.(png|jpg|svg|ico|webp|woff|ttf)"/,
  /aria-label=/,
  /data-/,
];

// 需要报告的模式：长度≥4的大写开头英文词组（UI显示文本特征）
const UI_TEXT_PATTERN = /"[A-Z][a-zA-Z][a-zA-Z ]{2,}"/g;

// ── 扫描逻辑 ──────────────────────────────────────────────────────────────────
function shouldIgnore(line) {
  return IGNORE_PATTERNS.some(p => p.test(line));
}

function scanFile(filePath) {
  const lines  = fs.readFileSync(filePath, "utf8").split("\n");
  const issues = [];

  lines.forEach((line, idx) => {
    if (shouldIgnore(line)) return;
    const matches = line.match(UI_TEXT_PATTERN);
    if (matches) {
      matches.forEach(m => {
        issues.push({ line: idx + 1, text: m, raw: line.trim() });
      });
    }
  });

  return issues;
}

function walkDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  fs.readdirSync(dir).forEach(f => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      results.push(...walkDir(full));
    } else if (f.endsWith(".tsx") || f.endsWith(".ts")) {
      results.push(full);
    }
  });
  return results;
}

// ── i18n 覆盖检查 ─────────────────────────────────────────────────────────────
function checkI18nCoverage(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  // Brokerage-site pages get their dictionary on the server (siteContext / extraDict)
  const hasUseI18n = content.includes("useI18n") || content.includes("useExtra") || content.includes("LandingPageClient") || content.includes("siteContext") || content.includes("extraDict");
  const hasTrans   = content.includes("t.") || content.includes("(t as any)") || content.includes("X.");
  return { hasUseI18n, hasTrans };
}

// ── 主程序 ────────────────────────────────────────────────────────────────────
console.log("\n🔍 i18n Audit Report\n" + "=".repeat(60));

const allFiles = [...walkDir(SRC_DIR), ...walkDir(COMP_DIR)];

// 1. i18n 覆盖率
console.log("\n📋 1. i18n 覆盖情况");
const pageFiles = allFiles.filter(f => f.endsWith("page.tsx"));
let covered = 0, uncovered = [];
pageFiles.forEach(f => {
  const { hasUseI18n } = checkI18nCoverage(f);
  const rel = path.relative(path.join(__dirname, "../src"), f);
  if (hasUseI18n) {
    covered++;
  } else {
    uncovered.push(rel);
  }
});
console.log(`   ✅ 已接入 i18n: ${covered} 个页面`);
if (uncovered.length) {
  console.log(`   ❌ 未接入 i18n: ${uncovered.length} 个页面`);
  uncovered.forEach(f => console.log(`      · ${f}`));
}

// 2. 硬编码 UI 文本
console.log("\n📋 2. 潜在硬编码 UI 文本（需人工确认是否应走 i18n）");
let totalIssues = 0;
const issuesByFile = {};

allFiles.forEach(f => {
  const rel    = path.relative(path.join(__dirname, "../src"), f);
  if (rel.includes("translations.ts")) return;
  const issues = scanFile(f);
  if (issues.length) {
    issuesByFile[rel] = issues;
    totalIssues += issues.length;
  }
});

if (totalIssues === 0) {
  console.log("   ✅ 未发现明显硬编码文本");
} else {
  const sorted = Object.entries(issuesByFile).sort((a, b) => b[1].length - a[1].length);
  sorted.forEach(([file, issues]) => {
    console.log(`\n   📄 ${file} (${issues.length} 处)`);
    issues.slice(0, 5).forEach(i => {
      console.log(`      L${i.line}: ${i.text}`);
    });
    if (issues.length > 5) console.log(`      ... 及另 ${issues.length - 5} 处`);
  });
  console.log(`\n   合计: ${totalIssues} 处潜在问题 (部分可能是枚举值，需人工判断)`);
}

// 3. || "fallback" 检查
console.log("\n📋 3. '|| \"fallback\"' 硬编码兜底");
let fallbackCount = 0;
allFiles.forEach(f => {
  const rel     = path.relative(path.join(__dirname, "../src"), f);
  if (rel.includes("translations.ts")) return;
  const content = fs.readFileSync(f, "utf8");
  const matches = content.match(/\|\| "[A-Z][^"]{3,}"/g);
  if (matches) {
    console.log(`   ⚠️  ${rel}: ${matches.length} 处`);
    matches.slice(0, 3).forEach(m => console.log(`      ${m}`));
    fallbackCount += matches.length;
  }
});
if (!fallbackCount) console.log("   ✅ 无硬编码兜底字符串");

// 4. 汇总
console.log("\n" + "=".repeat(60));
console.log("📊 汇总");
console.log(`   页面 i18n 覆盖率: ${covered}/${pageFiles.length} (${Math.round(covered/pageFiles.length*100)}%)`);
console.log(`   潜在硬编码文本:   ${totalIssues} 处`);
console.log(`   fallback 兜底:    ${fallbackCount} 处`);
console.log("\n💡 提示: 运行 'node scripts/i18n-audit.js' 可随时重新扫描\n");
