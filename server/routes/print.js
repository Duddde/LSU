import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, ROOT } from '../db.js';
import { requireAuth, wrap, notFound } from '../middleware.js';
import { buildTree } from './referentiel.js';
import { synthese } from './dossier.js';

const router = express.Router();

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const frDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : iso;
};

const ageAt = (naissance, ref = new Date()) => {
  if (!naissance) return null;
  const n = new Date(naissance);
  let a = ref.getFullYear() - n.getFullYear();
  if (ref.getMonth() < n.getMonth() || (ref.getMonth() === n.getMonth() && ref.getDate() < n.getDate())) a--;
  return a;
};

function settings() {
  const out = {};
  for (const r of db.prepare('SELECT cle, valeur FROM settings').all()) out[r.cle] = r.valeur;
  return out;
}

/** Logo en data-URI s'il a été déposé dans public/assets/logos. */
function logo(file) {
  const full = path.join(ROOT, 'public', 'assets', 'logos', file);
  if (!fs.existsSync(full)) return null;
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
}

function firstLogo(names) {
  for (const n of names) {
    const d = logo(n);
    if (d) return d;
  }
  return null;
}

const LOGOS = () => ({
  etat: firstLogo([
    'education-nationale.png',
    'education-nationale.jpg',
    'education-nationale.svg',
  ]),
  fol: firstLogo(['fol58.png', 'fol58.jpg', 'fol58.svg']),
  institut: firstLogo(['pierre-chanay.png', 'pierre-chanay.jpg', 'pierre-chanay.svg']),
});

const CSS = `
@import url("/css/fonts.css");
/* Palette et typographie du thème « 2a » : le document imprimé et l'écran
   parlent la même langue. Les couleurs sont données en oklch comme dans app.css. */
:root {
  --vert: oklch(0.58 0.12 150); --orange: oklch(0.72 0.14 65); --rouge: oklch(0.57 0.17 25);
  --gris: #7a7973; --ink: #1c1d1f; --ink-2: #55544f; --ink-3: #7a7973;
  --line: #e1dfd8; --line-2: #f2f0eb;
  --cat1: oklch(0.72 0.14 55); --cat2: oklch(0.82 0.13 95); --cat3: #a9a8a2;
  --mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  font: 10.5pt/1.5 "Schibsted Grotesk", "Segoe UI", system-ui, sans-serif;
  color: var(--ink); margin: 0; -webkit-font-smoothing: antialiased;
}
.page { padding: 14mm 12mm 18mm; }

/* ------------------------------- En-tete ------------------------------ */
header.livret {
  display: grid; grid-template-columns: 110px minmax(0, 1fr) 110px; align-items: center; gap: 20px;
  border-bottom: 2px solid var(--ink); padding-bottom: 14px;
}
header.livret img { height: 56px; width: 100%; object-fit: contain; }
header.livret .titre { text-align: center; }
header.livret h1 { font-size: 17pt; font-weight: 600; margin: 0 0 3px; letter-spacing: -0.01em; }
header.livret .sous { font-size: 9pt; color: var(--ink-3); }
header.livret .vide {
  height: 56px; border: 1px dashed #c4c2bc; border-radius: 4px; display: flex; align-items: center;
  justify-content: center; font-family: var(--mono); font-size: 6pt; color: var(--ink-3);
  text-align: center; padding: 2px;
  background: repeating-linear-gradient(135deg, #f6f5f1 0 5px, #fff 5px 10px);
}

/* ------------------------------ Identite ------------------------------ */
.identite { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 16px 0 0; }
.identite div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.identite b { font-size: 7.5pt; font-weight: 500; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.06em; }
.identite span { font-size: 10pt; font-weight: 500; }

/* ------------------------------- Légende ------------------------------ */
.legende {
  display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin: 14px 0;
  padding: 8px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  font-size: 9pt; color: var(--ink-2);
}
.legende b { font-weight: 500; color: var(--ink-3); }
.puce { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
.puce.vert { background: var(--vert); } .puce.orange { background: var(--orange); }
.puce.rouge { background: var(--rouge); } .puce.nc { background: #fff; border: 1px solid #b5b3ad; }

/* --------------------------- Hiérarchie ------------------------------- */
/* Pas de bandeaux pleins : la hiérarchie est portée par la typographie et
   par un petit marqueur de la couleur du niveau, comme dans le référentiel. */
h2.matiere {
  font-size: 14pt; font-weight: 600; letter-spacing: -0.01em; margin: 22px 0 0;
  padding-bottom: 7px; border-bottom: 1px solid var(--ink);
}
h3.cat1, h4.cat2 {
  display: flex; align-items: center; gap: 8px; font-weight: 600; margin: 0;
  padding: 11px 0 6px; background: none; border: 0;
}
h3.cat1 { font-size: 10.5pt; }
h4.cat2 { font-size: 10pt; padding-left: 12px; }
h3.cat1::before, h4.cat2::before {
  content: ''; width: 10px; height: 10px; border-radius: 2px; flex: none;
}
h3.cat1::before { background: var(--cat1); }
h4.cat2::before { background: var(--cat2); }

/* ----------------------------- Compétences ---------------------------- */
table.comp { width: 100%; border-collapse: collapse; font-size: 9pt; }
table.comp td { border-bottom: 1px solid var(--line-2); padding: 5px 6px; vertical-align: top; }
table.comp tr:last-child td { border-bottom: 1px solid var(--line); }
table.comp td.lab { padding-left: 26px; }
table.comp td.niv { width: 140px; white-space: nowrap; font-weight: 600; }
table.comp td.com { width: 30%; color: var(--ink-3); font-style: italic; }
.niv.vert { color: var(--vert); } .niv.orange { color: var(--orange); } .niv.rouge { color: var(--rouge); }
.niv.nc { color: var(--ink-3); font-weight: 400; }

/* ------------------------------- Blocs -------------------------------- */
.bloc { margin-top: 18px; border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; page-break-inside: avoid; }
.bloc h3 { margin: 0 0 6px; font-size: 10pt; font-weight: 600; }
.bloc p { margin: 0; white-space: pre-wrap; min-height: 18px; font-size: 10pt; line-height: 1.55; }
table.syn { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 8px; }
table.syn th, table.syn td { border-bottom: 1px solid var(--line-2); padding: 7px 8px; text-align: left; }
table.syn th { font-size: 8pt; font-weight: 500; color: var(--ink-3); border-bottom: 1px solid var(--line); }
.bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #efede8; min-width: 110px; }
.bar span { display: block; }

/* ----------------------- Signatures et mentions ----------------------- */
.signatures { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; margin-top: 28px; font-size: 9.5pt; }
.signatures div { border-top: 1px solid var(--ink); padding-top: 6px; min-height: 52px; }
footer.mentions {
  margin-top: 20px; border-top: 1px solid var(--line); padding-top: 10px;
  font-size: 7pt; line-height: 1.5; color: var(--ink-3); text-align: justify;
}

/* ------------------------------ Barre écran --------------------------- */
.toolbar {
  position: sticky; top: 0; background: #fff; color: var(--ink); padding: 10px 14px;
  display: flex; gap: 12px; align-items: center; font-size: 9.5pt;
  border-bottom: 1px solid var(--line);
}
.toolbar button {
  font: inherit; font-weight: 600; padding: 8px 16px; border: 0; border-radius: 9px;
  background: oklch(0.45 0.08 215); color: #fff; cursor: pointer;
}
.toolbar button:hover { background: oklch(0.39 0.08 215); }
.toolbar span { color: var(--ink-3); }
/* À l'écran, le document se présente comme la feuille A4 qu'il deviendra. */
@media screen {
  body { background: #e9e7e1; }
  .page {
    max-width: 210mm; margin: 24px auto; background: #fff; border-radius: 4px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .06), 0 12px 32px rgba(0, 0, 0, .08);
  }
}
@media print { .toolbar { display: none; } .page { padding: 0; } @page { size: A4; margin: 12mm 11mm 12mm; } }
`;

function header(st, titre) {
  const l = LOGOS();
  const slot = (src, alt, fallback) =>
    src ? `<img src="${src}" alt="${esc(alt)}">` : `<div class="vide">${esc(fallback)}</div>`;
  return `<header class="livret">
    ${slot(l.etat, 'République française — Éducation nationale', 'Logo Éducation nationale')}
    <div class="titre">
      <h1>${esc(titre)}</h1>
      <div class="sous">${esc(st.etablissement || '')}${st.gestionnaire ? ' — ' + esc(st.gestionnaire) : ''}</div>
    </div>
    ${slot(l.institut || l.fol, 'Institut Pierre Chanay — FOL 58', 'Logo Institut Pierre Chanay / FOL 58')}
  </header>`;
}

function identite(eleve, extra = []) {
  const age = ageAt(eleve.date_naissance);
  const lignes = [
    ['Nom', eleve.nom],
    ['Prénom', eleve.prenom],
    ['Date de naissance', frDate(eleve.date_naissance) + (age != null ? ` (${age} ans)` : '')],
    ['Groupe', eleve.classe || '—'],
    ['Enseignante(s)', eleve.enseignantes.map((t) => `${t.prenom} ${t.nom}`).join(', ') || '—'],
    ...extra,
  ];
  return `<section class="identite">${lignes
    .map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v || '—')}</span></div>`)
    .join('')}</section>`;
}

function legende(st) {
  return `<div class="legende"><b>Légende :</b>
    <span><i class="puce vert"></i>${esc(st.legende_vert)}</span>
    <span><i class="puce orange"></i>${esc(st.legende_orange)}</span>
    <span><i class="puce rouge"></i>${esc(st.legende_rouge)}</span>
    <span><i class="puce nc"></i>Non évalué sur la période</span>
  </div>`;
}

// Libellés courts pour la colonne de droite ; la légende en tête de document
// porte la formulation complète (paramétrable).
const LABEL = { vert: 'Seul', orange: 'Avec aide', rouge: "Beaucoup d'aide" };

function toolbar(label) {
  return `<div class="toolbar">
    <button onclick="window.print()">Imprimer / Enregistrer en PDF</button>
    <span>${esc(label)} — dans la boîte d'impression, choisir « Enregistrer au format PDF ».</span>
  </div>`;
}

function mentions(st) {
  return `<footer class="mentions"><b>Mentions légales —</b> ${esc(st.mentions_legales)}
   ${st.etablissement ? `<br><b>${esc(st.etablissement)}</b>${st.gestionnaire ? ' — ' + esc(st.gestionnaire) : ''}${st.ville ? ' — ' + esc(st.ville) : ''}` : ''}
   <br>Édité le ${frDate(new Date().toISOString())} depuis l'application Livret scolaire.</footer>`;
}

function studentOr404(id) {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(Number(id));
  if (!s) throw notFound('Élève introuvable');
  s.enseignantes = db
    .prepare(
      `SELECT t.prenom, t.nom FROM student_teachers st JOIN teachers t ON t.id = st.teacher_id
       WHERE st.student_id = ? ORDER BY t.nom`
    )
    .all(s.id);
  return s;
}

/* ------------------------- Bilan d'une année ------------------------- */

router.get(
  '/eleve/:id',
  requireAuth,
  wrap((req, res) => {
    const eleve = studentOr404(req.params.id);
    const st = { ...settings() };
    const year =
      (req.query.year && db.prepare('SELECT * FROM years WHERE id = ?').get(Number(req.query.year))) ||
      db.prepare('SELECT * FROM years WHERE courante = 1').get();
    const avecVides = req.query.vides === '1';
    const filtre = String(req.query.matieres || '')
      .split(',')
      .filter(Boolean)
      .map(Number);

    const evals = new Map();
    for (const r of db
      .prepare('SELECT node_id, niveau, commentaire FROM evaluations WHERE student_id = ? AND year_id = ?')
      .all(eleve.id, year.id))
      evals.set(r.node_id, r);

    let matieres = buildTree().filter((m) => !m.hors_pdf);
    if (filtre.length) matieres = matieres.filter((m) => filtre.includes(m.id));

    const corps = matieres
      .map((m) => renderMatiere(m, evals, avecVides))
      .filter(Boolean)
      .join('');

    const commentaireAnnuel =
      db
        .prepare('SELECT commentaire FROM year_comments WHERE student_id = ? AND year_id = ?')
        .get(eleve.id, year.id)?.commentaire || '';

    const periode = req.query.periode === '2' ? 'Semestre 2' : 'Semestre 1';
    res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Livret ${esc(eleve.nom)} ${esc(eleve.prenom)} — ${esc(year.libelle)} — ${periode}</title>
<style>${CSS}</style></head><body>
${toolbar(`Bilan ${year.libelle} — ${periode}`)}
<div class="page">
${header(st, 'Livret scolaire')}
${identite(eleve, [['Année scolaire', year.libelle], ['Période', periode]])}
${legende(st)}
${corps || '<p><i>Aucune compétence évaluée pour cette période.</i></p>'}
<div class="bloc"><h3>Appréciation générale — ${esc(year.libelle)}</h3><p>${esc(commentaireAnnuel)}</p></div>
<div class="signatures">
  <div>L'enseignante</div><div>Les représentants légaux</div>
</div>
${mentions(st)}
</div>
${req.query.auto === '1' ? '<script>window.addEventListener("load",()=>window.print())</script>' : ''}
</body></html>`);
  })
);

function renderMatiere(matiere, evals, avecVides) {
  const lignes = [];
  let evalues = 0;

  const walk = (node, depth) => {
    if (node.hors_pdf) return '';
    if (!node.children.length) return '';
    const feuilles = node.children.filter((c) => !c.children.length && !c.hors_pdf);
    const branches = node.children.filter((c) => c.children.length);
    let html = '';
    const visibles = feuilles.filter((f) => avecVides || evals.get(f.id)?.niveau);
    if (visibles.length) {
      html += `<table class="comp">${visibles
        .map((f) => {
          const e = evals.get(f.id);
          if (e?.niveau) evalues++;
          const niv = e?.niveau;
          return `<tr>
            <td class="lab">${esc(f.label)}</td>
            <td class="niv ${niv || 'nc'}">${niv ? `<i class="puce ${niv}"></i>${LABEL[niv]}` : '<i class="puce nc"></i>—'}</td>
            <td class="com">${esc(e?.commentaire || '')}</td>
          </tr>`;
        })
        .join('')}</table>`;
    }
    for (const b of branches) {
      const inner = walk(b, depth + 1);
      if (!inner) continue;
      // Seules les deux catégories principales (orange, jaune) sont titrées :
      // la grise est aplatie, ses compétences suivent la catégorie jaune.
      const tag = depth === 0 ? 'h3 class="cat1"' : depth === 1 ? 'h4 class="cat2"' : null;
      const close = tag ? tag.split(' ')[0] : null;
      html += tag ? `<${tag}>${esc(b.label)}</${close}>${inner}` : inner;
    }
    return html;
  };

  const corps = walk(matiere, 0);
  if (!corps || (!evalues && !avecVides)) return '';
  lignes.push(`<h2 class="matiere">${esc(matiere.label)}</h2>`, corps);
  return lignes.join('');
}

/* --------------------- Synthèse de progression ----------------------- */

router.get(
  '/synthese/:id',
  requireAuth,
  wrap((req, res) => {
    const eleve = studentOr404(req.params.id);
    const st = settings();
    const annees = synthese(eleve.id).map((a) => ({
      ...a,
      matieres: a.matieres.filter((m) => !m.hors_pdf),
    }));

    const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0);
    const bar = (m) =>
      `<div class="bar">
        <span style="width:${pct(m.vert, m.total)}%;background:var(--vert)"></span>
        <span style="width:${pct(m.orange, m.total)}%;background:var(--orange)"></span>
        <span style="width:${pct(m.rouge, m.total)}%;background:var(--rouge)"></span>
       </div>`;

    const tableaux = annees
      .map(
        (a) => `<h2 class="matiere">Année scolaire ${esc(a.libelle)}</h2>
      <table class="syn"><tr><th>Matière</th><th>Seul</th><th>Avec aide</th><th>Avec beaucoup d&rsquo;aide</th>
      <th>Compétences évaluées</th><th>Répartition</th></tr>
      ${a.matieres
        .map(
          (m) => `<tr><td>${esc(m.label)}</td><td>${m.vert}</td><td>${m.orange}</td><td>${m.rouge}</td>
          <td>${m.total} / ${m.total_referentiel}</td><td>${bar(m)}</td></tr>`
        )
        .join('')}
      </table>`
      )
      .join('');

    // Évolution matière par matière, d'une année sur l'autre.
    const matieres = new Map();
    for (const a of annees)
      for (const m of a.matieres) {
        const row = matieres.get(m.id) || { label: m.label, parAnnee: {} };
        row.parAnnee[a.libelle] = m;
        matieres.set(m.id, row);
      }
    const entetes = annees.map((a) => a.libelle);
    const evolution = matieres.size
      ? `<h2 class="matiere">Évolution d'une année sur l'autre</h2>
      <table class="syn"><tr><th>Matière</th>${entetes
        .map((h) => `<th>${esc(h)}<br><span style="font-weight:400;font-size:8.5pt">acquis / évaluées</span></th>`)
        .join('')}</tr>
      ${[...matieres.values()]
        .map(
          (r) => `<tr><td>${esc(r.label)}</td>${entetes
            .map((h) => {
              const m = r.parAnnee[h];
              return `<td>${m ? `${m.vert} / ${m.total} <span style="color:#6b747e">(${pct(m.vert, m.total)} %)</span>` : '—'}</td>`;
            })
            .join('')}</tr>`
        )
        .join('')}
      </table>`
      : '';

    const commentaires = db
      .prepare(
        `SELECT y.libelle, yc.commentaire FROM year_comments yc JOIN years y ON y.id = yc.year_id
         WHERE yc.student_id = ? AND TRIM(yc.commentaire) <> '' ORDER BY y.libelle`
      )
      .all(eleve.id);

    const periode = req.query.periode === '2' ? 'Semestre 2' : 'Semestre 1';
    res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Synthèse ${esc(eleve.nom)} ${esc(eleve.prenom)}</title><style>${CSS}</style></head><body>
${toolbar(`Synthèse de progression — ${periode}`)}
<div class="page">
${header(st, 'Synthèse de progression — parcours scolaire')}
${identite(eleve, [['Période', periode]])}
${legende(st)}
${tableaux || '<p><i>Aucune évaluation enregistrée.</i></p>'}
${evolution}
<div class="bloc"><h3>Commentaire global de scolarité</h3><p>${esc(eleve.commentaire_scolarite || '')}</p></div>
${commentaires
  .map(
    (c) => `<div class="bloc"><h3>Appréciation ${esc(c.libelle)}</h3><p>${esc(c.commentaire)}</p></div>`
  )
  .join('')}
<div class="signatures"><div>L'enseignante</div><div>Les représentants légaux</div></div>
${mentions(st)}
</div>
${req.query.auto === '1' ? '<script>window.addEventListener("load",()=>window.print())</script>' : ''}
</body></html>`);
  })
);

export default router;
