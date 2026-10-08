// يبني صفحات «المعرفة» الثابتة من تصدير وحدات المعرفة في مستودع المنصة.
// التشغيل: node tools/build-knowledge.mjs <path-to>/platform_units.json
// لا يُنشر إلا ما في الملف الممرَّر؛ الحقول الداخلية لا تدخل التصدير أصلًا.
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://wodouh.com";
const APP = "https://app.wodouh.com";
const today = new Date().toISOString().slice(0, 10);
// المصدر: ملف تصدير من مستودع المنصة، أو رابط واجهة المقالات المنشورة في المنصة.
const source = process.argv[2];
const raw = /^https?:\/\//.test(source)
  ? await (await fetch(source, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) })).json()
  : JSON.parse(readFileSync(source, "utf8"));
const list = Array.isArray(raw) ? raw : raw.items;
if (!Array.isArray(list) || list.length === 0) {
  // لا مقالات منشورة أو رد غير متوقع: نُبقي الصفحات الحالية كما هي ولا نحذف شيئًا.
  console.log("no published articles; keeping current pages");
  process.exit(0);
}
const units = list.map((u) => ({
  code: String(u.slug),
  slug: String(u.slug),
  title: u.seoTitle || u.title,
  heading: u.title,
  kind: u.kind ?? "",
  category: u.category || "عام",
  excerpt: String(u.metaDescription || u.excerpt || "").replace(/\*\*/g, ""),
  body: String(u.body ?? ""),
  author: u.author ?? u.authorName ?? "فريق وضوح",
  source_public: u.source_public ?? "",
  modified: (u.updatedAt ?? "").slice(0, 10),
})).filter((u) => /^[a-z0-9-]+$/.test(u.code) && u.body);
// روابط مقروءة: رمز المقال في المنصة (مثل plt-fin-ref-001) يقابله رابط بكلمات عربية.
// الخريطة محفوظة في tools/article-urls.json حتى لا يتغير الرابط إن تغيّر العنوان لاحقًا.
// مقال جديد بلا رابط يأخذ رابطًا من عنوانه مرة واحدة ويُحفظ في الخريطة.
const URLS_FILE = join(root, "tools", "article-urls.json");
const urlMap = JSON.parse(readFileSync(URLS_FILE, "utf8"));
const READABLE = /^[\u0621-\u064A\u0660-\u0669a-z0-9]+(-[\u0621-\u064A\u0660-\u0669a-z0-9]+)*$/;
function readableSlug(title) {
  return String(title)
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")          // التشكيل والتطويل
    .replace(/[^\u0621-\u064A\u0660-\u0669a-zA-Z0-9\s-]/g, " ")
    .trim().split(/[\s-]+/).filter(Boolean).slice(0, 7).join("-").toLowerCase();
}
let mapChanged = false;
const taken = new Set(Object.values(urlMap));
for (const unit of units) {
  if (!READABLE.test(urlMap[unit.code] ?? "")) {
    let candidate = readableSlug(unit.heading) || unit.code;
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${readableSlug(unit.heading)}-${n}`;
    urlMap[unit.code] = candidate; taken.add(candidate); mapChanged = true;
  }
  unit.slug = urlMap[unit.code];
}
if (mapChanged) writeFileSync(URLS_FILE, JSON.stringify(urlMap, null, 2) + "\n");
const href = (path) => SITE + encodeURI(path);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

const CTA = {
  "المالية": ["اعرف أين يذهب ربحك", "قل لنا وضع نشاطك، ونحدد لك أول خطوة في الربح."],
  "التسويق": ["اعرف أي قناة تجيب عملاءك فعلًا", "قل لنا وضع نشاطك، ونحدد لك أول خطوة في التسويق."],
  "المبيعات": ["اعرف أين تضيع فرصك", "قل لنا وضع نشاطك، ونحدد لك أول خطوة في المبيعات."],
  "القيادة": ["اعرف من أين تبدأ", "قل لنا وضع نشاطك، ونحدد لك أولوية واحدة واضحة."],
};

function markdown(body) {
  const lines = body.split("\n");
  const out = [];
  let i = 0;
  const list = (indent) => {
    // قائمة بمستوى إزاحة واحد، مع قوائم فرعية
    const ordered = /^\s*\d+\. /.test(lines[i]);
    const items = [];
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)([-*]|\d+\.) (.*)$/);
      if (!m) break;
      if (m[1].length < indent) break;
      if (m[1].length > indent) { items[items.length - 1] += list(m[1].length); continue; }
      items.push(inline(m[3]));
      i += 1;
    }
    const tag = ordered ? "ol" : "ul";
    return `<${tag}>${items.map((x) => `<li>${x}</li>`).join("")}</${tag}>`;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const h = line.match(/^(#{2,3}) (.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i += 1; continue; }
    if (/^\s*([-*]|\d+\.) /.test(line)) { out.push(list(line.match(/^\s*/)[0].length)); continue; }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i += 1; }
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const data = rows.filter((r) => !/^\|[\s:|-]+\|?$/.test(r));
      const [head, ...rest] = data;
      out.push(`<div class="table"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^>/.test(line)) { out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); i += 1; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3} |\s*([-*]|\d+\.) |\||>)/.test(lines[i])) { para.push(lines[i]); i += 1; }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

const head = (title, description, path, extra = "") => `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${href(path)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${href(path)}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:locale" content="ar_SA">
<link rel="icon" href="/favicon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Noto+Kufi+Arabic:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/knowledge/knowledge.css">
${extra}
</head>
<body>
<header>
  <div class="container">
    <a class="brand" href="/" aria-label="وضوح، الرئيسية"><img src="/icon-192.png" alt="" width="30" height="30" style="border-radius:7px">وضوح</a>
    <nav>
      <a href="/knowledge/">المعرفة</a>
      <a href="${APP}/sign-in">دخول</a>
      <a class="keep btn small" href="${APP}/join">ابدأ الآن</a>
    </nav>
  </div>
</header>
`;
const foot = `<footer>
  <div class="container">
    <span>© وضوح</span>
    <span><a href="/">الرئيسية</a><a href="/knowledge/">المعرفة</a><a href="/privacy.html">الخصوصية</a><a href="/terms.html">الشروط</a></span>
  </div>
</footer>
</body>
</html>
`;

const dir = join(root, "knowledge");
for (const entry of readdirSync(dir)) {
  const path = join(dir, entry);
  if (statSync(path).isDirectory()) rmSync(path, { recursive: true });
}

const categories = [...new Set(units.map((u) => u.category))];
for (const unit of units) {
  const path = `/knowledge/${unit.slug}/`;
  const [ctaTitle, ctaText] = CTA[unit.category] ?? CTA["القيادة"];
  const related = units.filter((u) => u.category === unit.category && u.slug !== unit.slug).slice(0, 3);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: unit.heading,
    description: unit.excerpt,
    inLanguage: "ar",
    author: unit.author === "فريق وضوح" ? { "@type": "Organization", name: "وضوح", url: SITE } : { "@type": "Person", name: unit.author },
    publisher: { "@type": "Organization", name: "وضوح", url: SITE, logo: { "@type": "ImageObject", url: `${SITE}/icon-512.png` } },
    mainEntityOfPage: href(path),
    articleSection: unit.category,
    dateModified: unit.modified || today,
  };
  const html = head(`${unit.title} | وضوح`, unit.excerpt, path, `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`) + `<main class="container article">
  <p class="crumbs"><a href="/knowledge/">المعرفة</a> · ${esc(unit.category)}${unit.kind ? ` · ${esc(unit.kind)}` : ""}</p>
  <h1>${esc(unit.heading)}</h1>
  <p class="byline">كتبه: ${esc(unit.author)}${unit.source_public ? ` · ${esc(unit.source_public)}` : ""}</p>
  <article>
${markdown(unit.body)}
  </article>
  <aside class="cta">
    <h2>${esc(ctaTitle)}</h2>
    <p>${esc(ctaText)}</p>
    <a class="btn" href="${APP}/join">ابدأ الآن</a>
  </aside>
  ${related.length ? `<section class="related"><h2>اقرأ أيضًا</h2><ul>${related.map((r) => `<li><a href="/knowledge/${r.slug}/">${esc(r.heading)}</a><span>${esc(r.excerpt)}</span></li>`).join("")}</ul></section>` : ""}
</main>
` + foot;
  mkdirSync(join(dir, unit.slug), { recursive: true });
  writeFileSync(join(dir, unit.slug, "index.html"), html);
  // الرابط القديم بالرمز يبقى ويحوّل إلى الجديد، حتى لا ينكسر رابط شاركه أحد.
  if (unit.code !== unit.slug) {
    mkdirSync(join(dir, unit.code), { recursive: true });
    writeFileSync(join(dir, unit.code, "index.html"), `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${esc(unit.heading)} | وضوح</title>
<link rel="canonical" href="${href(path)}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${path}">
</head><body><p>انتقل المقال إلى <a href="${path}">${esc(unit.heading)}</a>.</p></body></html>
`);
  }
}

const indexLd = { "@context": "https://schema.org", "@type": "CollectionPage", name: "مركز المعرفة | وضوح", inLanguage: "ar", url: `${SITE}/knowledge/` };
writeFileSync(join(dir, "index.html"), head("مركز المعرفة | وضوح", "قواعد ومؤشرات وقوالب عملية لصاحب النشاط: المالية، التسويق، المبيعات، والقيادة.", "/knowledge/", `<script type="application/ld+json">${JSON.stringify(indexLd)}</script>`) + `<main class="container">
  <div class="intro">
    <h1>مركز المعرفة</h1>
    <p>قواعد ومؤشرات وقوالب قصيرة، مكتوبة من تجربة الأنشطة الصغيرة والمتوسطة. اقرأ ما يخص موقفك وطبّقه اليوم.</p>
    <nav class="cats">${categories.map((c) => `<a href="#${esc(c)}">${esc(c)}</a>`).join("")}</nav>
  </div>
${categories.map((c) => `  <section class="cat" id="${esc(c)}">
    <h2>${esc(c)}</h2>
    <div class="cards">
${units.filter((u) => u.category === c).map((u) => `      <a class="card" href="/knowledge/${u.slug}/"><small>${esc(u.kind || u.category)}</small><h3>${esc(u.heading)}</h3><p>${esc(u.excerpt)}</p><span>${esc(u.author)}</span></a>`).join("\n")}
    </div>
  </section>`).join("\n")}
</main>
` + foot);

const urls = ["/", "/knowledge/", ...units.map((u) => `/knowledge/${u.slug}/`), "/privacy.html", "/terms.html"];
writeFileSync(join(root, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${href(u)}</loc><lastmod>${u.includes("privacy") || u.includes("terms") ? "2026-09-25" : (units.find((x) => u === `/knowledge/${x.slug}/`)?.modified || today)}</lastmod></url>`).join("\n")}
</urlset>
`);
// شريط «اقرأ قبل أن تبدأ» في الرئيسية: أول ثلاث مقالات منشورة، حتى لا يشير لمقال غير موجود.
const homePath = join(root, "index.html");
const home = readFileSync(homePath, "utf8");
const strip = units.slice(0, 3).map((u) => `        <a class="link" href="/knowledge/${u.slug}/"><b>${esc(u.heading)}</b><span>${esc(u.excerpt.length > 70 ? u.excerpt.slice(0, u.excerpt.lastIndexOf(" ", 70)) + "…" : u.excerpt)}</span></a>`).join("\n");
const nextHome = home.replace(/(<!-- knowledge:start -->\n)[\s\S]*?(        <!-- knowledge:end -->)/, `$1${strip}\n$2`);
if (nextHome !== home) writeFileSync(homePath, nextHome);
console.log(`built ${units.length} articles in ${categories.length} categories`);
