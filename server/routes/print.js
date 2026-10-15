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
:root { --vert:#2f8f4e; --orange:#e08900; --rouge:#c92a2a; --gris:#8b9199; }
* { box-sizing: border-box; }
body { font: 11pt/1.45 "Segoe UI", system-ui, sans-serif; color: #1c2127; margin: 0; }
.page { padding: 14mm 12mm 18mm; }
header.livret { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #1c2127; padding-bottom: 10px; }
header.livret img { height: 56px; width: auto; object-fit: contain; }
header.livret .titre { flex: 1; text-align: center; }
header.livret h1 { font-size: 16pt; margin: 0 0 2px; letter-spacing: .4px; }
header.livret .sous { font-size: 9.5pt; color: #555e68; }
.identite { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px 20px; margin: 12px 0 6px;
            border: 1px solid #c8ced6; border-radius: 6px; padding: 8px 12px; background: #f7f9fb; }
.identite div { font-size: 10pt; }
.identite b { color: #3b434d; font-weight: 600; }
.legende { display: flex; gap: 16px; align-items: center; margin: 10px 0 14px; font-size: 9.5pt; }
.puce { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
.puce.vert { background: var(--vert); } .puce.orange { background: var(--orange); }
.puce.rouge { background: var(--rouge); } .puce.nc { background: #fff; border: 1px solid var(--gris); }
h2.matiere { background: #1c2127; color: #fff; font-size: 12pt; padding: 5px 10px; margin: 16px 0 0; border-radius: 4px 4px 0 0; }
h3.cat1 { background: #ffcc99; font-size: 11pt; margin: 8px 0 0; padding: 4px 10px; border-left: 4px solid #e08900; }
h4.cat2 { background: #e6f4ea; font-size: 10.5pt; margin: 6px 0 0; padding: 3px 10px 3px 18px; border-left: 4px solid #2f8f4e; }
table.comp { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
table.comp td { border-bottom: 1px solid #e3e7ec; padding: 3px 6px; vertical-align: top; }
table.comp td.lab { padding-left: 26px; }
table.comp td.niv { width: 150px; white-space: nowrap; font-weight: 600; }
table.comp td.com { width: 32%; color: #434b55; font-style: italic; }
.niv.vert { color: var(--vert); } .niv.orange { color: var(--orange); } .niv.rouge { color: var(--rouge); }
.niv.nc { color: var(--gris); font-weight: 400; }
.bloc { margin-top: 16px; border: 1px solid #c8ced6; border-radius: 6px; padding: 10px 12px; page-break-inside: avoid; }
.bloc h3 { margin: 0 0 6px; font-size: 11pt; }
.bloc p { margin: 0; white-space: pre-wrap; min-height: 18px; }
table.syn { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 6px; }
table.syn th, table.syn td { border: 1px solid #c8ced6; padding: 4px 8px; text-align: left; }
table.syn th { background: #eef2f6; }
.bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: #edf0f3; min-width: 110px; }
.bar span { display: block; }
.signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 20px; font-size: 9.5pt; }
.signatures div { border-top: 1px solid #9aa2ab; padding-top: 4px; min-height: 48px; }
footer.mentions { margin-top: 18px; border-top: 1px solid #c8ced6; padding-top: 6px; font-size: 7.5pt; color: #5a636d; text-align: justify; }
.toolbar { position: sticky; top: 0; background: #1c2127; color: #fff; padding: 8px 12px; display: flex; gap: 10px; align-items: center; font-size: 10pt; }
.toolbar button { font: inherit; padding: 5px 14px; border: 0; border-radius: 5px; background: #4c9aff; color: #fff; cursor: pointer; }
.toolbar span { opacity: .8; }
@media print { .toolbar { display: none; } .page { padding: 0; } @page { size: A4; margin: 12mm 11mm 12mm; } }
`;

function header(st, titre) {
  const l = LOGOS();
  const slot = (src, alt, fallback) =>
    src
      ? `<img src="${src}" alt="${esc(alt)}">`
      : `<div style="height:56px;width:70px;border:1px dashed #c0c7cf;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:6.5pt;color:#8b9199;text-align:center;padding:2px">${esc(fallback)}</div>`;
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
    .map(([k, v]) => `<div><b>${esc(k)} :</b> ${esc(v || '—')}</div>`)
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
const LABEL = { vert: 'Seul', orange: 'Avec aide', rouge: "Avec beaucoup d'aide" };

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
