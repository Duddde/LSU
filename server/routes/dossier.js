import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOAD_DIR } from '../db.js';
import { requireAuth, wrap, badRequest, notFound } from '../middleware.js';
import { buildTree } from './referentiel.js';

const router = express.Router();
export const NIVEAUX = ['vert', 'orange', 'rouge'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).slice(0, 12)}`),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

const getStudent = (id) => {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(Number(id));
  if (!s) throw notFound('Élève introuvable');
  return s;
};

const resolveYear = (value) => {
  if (value) {
    const y = db.prepare('SELECT * FROM years WHERE id = ?').get(Number(value));
    if (y) return y;
  }
  return (
    db.prepare('SELECT * FROM years WHERE courante = 1').get() ||
    db.prepare('SELECT * FROM years ORDER BY libelle DESC LIMIT 1').get()
  );
};

/* --------------------------- Évaluations ----------------------------- */

router.get(
  '/students/:id/evaluations',
  requireAuth,
  wrap((req, res) => {
    const s = getStudent(req.params.id);
    const year = resolveYear(req.query.year);
    const rows = db
      .prepare(
        `SELECT e.node_id, e.niveau, e.commentaire, e.updated_at, t.prenom, t.nom
         FROM evaluations e LEFT JOIN teachers t ON t.id = e.teacher_id
         WHERE e.student_id = ? AND e.year_id = ?`
      )
      .all(s.id, year.id);
    const map = {};
    for (const r of rows)
      map[r.node_id] = {
        niveau: r.niveau,
        commentaire: r.commentaire,
        updated_at: r.updated_at,
        par: r.prenom ? `${r.prenom} ${r.nom}` : null,
      };
    // Toutes les années, pour l'affichage de l'évolution par compétence.
    const toutes = db
      .prepare(
        `SELECT e.node_id, y.id AS year_id, y.libelle, e.niveau
         FROM evaluations e JOIN years y ON y.id = e.year_id
         WHERE e.student_id = ? AND e.niveau IS NOT NULL
         ORDER BY y.libelle`
      )
      .all(s.id);
    const evolution = {};
    for (const r of toutes) (evolution[r.node_id] ||= []).push({ annee: r.libelle, niveau: r.niveau });
    res.json({ year, evaluations: map, evolution });
  })
);

router.put(
  '/students/:id/evaluations/:nodeId',
  requireAuth,
  wrap((req, res) => {
    const s = getStudent(req.params.id);
    const nodeId = Number(req.params.nodeId);
    if (!db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(nodeId))
      throw badRequest('Compétence introuvable');
    const year = resolveYear(req.body?.year_id);
    let niveau = req.body?.niveau ?? null;
    if (niveau !== null && !NIVEAUX.includes(niveau))
      throw badRequest(`Niveau invalide (attendu : ${NIVEAUX.join(', ')} ou vide)`);
    const commentaire = String(req.body?.commentaire ?? '');

    const previous = db
      .prepare('SELECT * FROM evaluations WHERE student_id = ? AND node_id = ? AND year_id = ?')
      .get(s.id, nodeId, year.id);

    db.prepare(
      `INSERT INTO evaluations (student_id, node_id, year_id, niveau, commentaire, teacher_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(student_id, node_id, year_id) DO UPDATE SET
         niveau = excluded.niveau, commentaire = excluded.commentaire,
         teacher_id = excluded.teacher_id, updated_at = datetime('now')`
    ).run(s.id, nodeId, year.id, niveau, commentaire, req.user?.id ?? null);

    if (!previous || previous.niveau !== niveau || previous.commentaire !== commentaire) {
      db.prepare(
        `INSERT INTO eval_history (student_id, node_id, year_id, niveau, commentaire, teacher_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(s.id, nodeId, year.id, niveau, commentaire, req.user?.id ?? null);
    }
    res.json({ ok: true, year_id: year.id });
  })
);

router.get(
  '/students/:id/historique',
  requireAuth,
  wrap((req, res) => {
    const s = getStudent(req.params.id);
    const nodeId = req.query.node_id ? Number(req.query.node_id) : null;
    const rows = db
      .prepare(
        `SELECT h.*, y.libelle AS annee, n.label AS competence, t.prenom, t.nom
         FROM eval_history h
         JOIN years y ON y.id = h.year_id
         LEFT JOIN nodes n ON n.id = h.node_id
         LEFT JOIN teachers t ON t.id = h.teacher_id
         WHERE h.student_id = ? ${nodeId ? 'AND h.node_id = ?' : ''}
         ORDER BY h.created_at DESC LIMIT 300`
      )
      .all(...(nodeId ? [s.id, nodeId] : [s.id]));
    res.json(
      rows.map((r) => ({
        node_id: r.node_id,
        competence: r.competence,
        annee: r.annee,
        niveau: r.niveau,
        commentaire: r.commentaire,
        date: r.created_at,
        par: r.prenom ? `${r.prenom} ${r.nom}` : null,
      }))
    );
  })
);

/* ----------------------------- Synthèse ------------------------------ */

/** Récapitulatif par matière et par année (progression). */
export function synthese(studentId) {
  const roots = buildTree();
  const matiereOf = new Map();
  const walk = (node, matiere) => {
    matiereOf.set(node.id, matiere);
    node.children.forEach((c) => walk(c, matiere));
  };
  roots.forEach((r) => walk(r, r));

  const rows = db
    .prepare(
      `SELECT e.node_id, e.niveau, y.id AS year_id, y.libelle
       FROM evaluations e JOIN years y ON y.id = e.year_id
       WHERE e.student_id = ? AND e.niveau IS NOT NULL
       ORDER BY y.libelle`
    )
    .all(studentId);

  const annees = new Map();
  for (const r of rows) {
    const matiere = matiereOf.get(r.node_id);
    if (!matiere) continue;
    const annee = annees.get(r.year_id) || {
      year_id: r.year_id,
      libelle: r.libelle,
      matieres: new Map(),
    };
    const m =
      annee.matieres.get(matiere.id) || {
        id: matiere.id,
        label: matiere.label,
        hors_pdf: matiere.hors_pdf,
        vert: 0,
        orange: 0,
        rouge: 0,
        total: 0,
      };
    m[r.niveau]++;
    m.total++;
    annee.matieres.set(matiere.id, m);
    annees.set(r.year_id, annee);
  }
  const totalParMatiere = new Map();
  const countLeaves = (n) => (n.children.length ? n.children.reduce((s, c) => s + countLeaves(c), 0) : 1);
  roots.forEach((r) => totalParMatiere.set(r.id, countLeaves(r)));

  return [...annees.values()]
    .sort((a, b) => a.libelle.localeCompare(b.libelle))
    .map((a) => ({
      year_id: a.year_id,
      libelle: a.libelle,
      matieres: [...a.matieres.values()].map((m) => ({
        ...m,
        total_referentiel: totalParMatiere.get(m.id) || m.total,
      })),
    }));
}

router.get(
  '/students/:id/synthese',
  requireAuth,
  wrap((req, res) => {
    const s = getStudent(req.params.id);
    res.json({ annees: synthese(s.id) });
  })
);

/* ------------------------ Dossier élève (GED) ------------------------ */

export const CATEGORIES_DOC = [
  'Bilan / livret',
  'Évaluation',
  'Projet (PPS, PAP, PPRE)',
  'Courrier / famille',
  'Compte rendu de réunion',
  'Document médical ou paramédical',
  'Production de l’élève',
  'Autre',
];

router.get(
  '/students/:id/documents',
  requireAuth,
  wrap((req, res) => {
    const s = getStudent(req.params.id);
    const rows = db
      .prepare(
        `SELECT d.*, t.prenom, t.nom FROM documents d
         LEFT JOIN teachers t ON t.id = d.teacher_id
         WHERE d.student_id = ? ORDER BY d.created_at DESC`
      )
      .all(s.id);
    res.json({
      categories: CATEGORIES_DOC,
      documents: rows.map((d) => ({
        id: d.id,
        libelle: d.libelle,
        categorie: d.categorie,
        nom_origine: d.nom_origine,
        mime: d.mime,
        taille: d.taille,
        date: d.created_at,
        par: d.prenom ? `${d.prenom} ${d.nom}` : null,
      })),
    });
  })
);

router.post(
  '/students/:id/documents',
  requireAuth,
  upload.single('fichier'),
  wrap((req, res) => {
    const s = getStudent(req.params.id);
    if (!req.file) throw badRequest('Aucun fichier reçu');
    const info = db
      .prepare(
        `INSERT INTO documents (student_id, libelle, categorie, fichier, nom_origine, mime, taille, teacher_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        s.id,
        String(req.body?.libelle || req.file.originalname).trim(),
        CATEGORIES_DOC.includes(req.body?.categorie) ? req.body.categorie : 'Autre',
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.user?.id ?? null
      );
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  })
);

router.get(
  '/documents/:id/fichier',
  requireAuth,
  wrap((req, res) => {
    const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
    if (!d) throw notFound('Document introuvable');
    const full = path.join(UPLOAD_DIR, d.fichier);
    if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full))
      throw notFound('Fichier absent du dossier de stockage');
    res.setHeader('Content-Type', d.mime || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.nom_origine)}`
    );
    fs.createReadStream(full).pipe(res);
  })
);

router.patch(
  '/documents/:id',
  requireAuth,
  wrap((req, res) => {
    const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
    if (!d) throw notFound('Document introuvable');
    db.prepare('UPDATE documents SET libelle = ?, categorie = ? WHERE id = ?').run(
      String(req.body?.libelle ?? d.libelle).trim() || d.libelle,
      CATEGORIES_DOC.includes(req.body?.categorie) ? req.body.categorie : d.categorie,
      d.id
    );
    res.json({ ok: true });
  })
);

router.delete(
  '/documents/:id',
  requireAuth,
  wrap((req, res) => {
    const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
    if (!d) throw notFound('Document introuvable');
    db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
    fs.rm(path.join(UPLOAD_DIR, d.fichier), { force: true }, () => {});
    res.json({ ok: true });
  })
);

export default router;
