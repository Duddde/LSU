import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseReferentielOdt } from './odt.js';
import { hashPassword } from './auth.js';
import postureTree from './referentiel-posture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
// LSU_DATA permet de travailler sur une base séparée (tests, démonstration)
// sans jamais toucher aux données réelles de l'établissement.
export const DATA_DIR = process.env.LSU_DATA ? path.resolve(process.env.LSU_DATA) : path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'lsu.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 8000');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS teachers (
  id            INTEGER PRIMARY KEY,
  civilite      TEXT    NOT NULL DEFAULT 'Mme',
  prenom        TEXT    NOT NULL,
  nom           TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'enseignant',  -- 'admin' | 'enseignant'
  actif         INTEGER NOT NULL DEFAULT 1,
  must_change   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id             INTEGER PRIMARY KEY,
  prenom         TEXT NOT NULL,
  nom            TEXT NOT NULL,
  date_naissance TEXT,
  classe         TEXT,
  date_entree    TEXT,
  commentaire_scolarite TEXT NOT NULL DEFAULT '',
  archive        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES teachers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS student_teachers (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS years (
  id      INTEGER PRIMARY KEY,
  libelle TEXT NOT NULL UNIQUE,     -- « 2025-2026 »
  courante INTEGER NOT NULL DEFAULT 0
);

-- Arbre du référentiel : profondeur 0 = matière, 1 = orange, 2 = jaune, 3 = gris,
-- les feuilles (compétences évaluables) peuvent se trouver à n'importe quelle profondeur.
CREATE TABLE IF NOT EXISTS nodes (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,
  depth      INTEGER NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  cycle      TEXT,
  hors_pdf   INTEGER NOT NULL DEFAULT 0,   -- suivi en interne, masqué dans le PDF
  archive    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

CREATE TABLE IF NOT EXISTS evaluations (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  node_id    INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  year_id    INTEGER NOT NULL REFERENCES years(id) ON DELETE CASCADE,
  niveau     TEXT,                          -- 'vert' | 'orange' | 'rouge' | NULL
  commentaire TEXT NOT NULL DEFAULT '',
  teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, node_id, year_id)
);
CREATE INDEX IF NOT EXISTS idx_eval_student ON evaluations(student_id, year_id);

CREATE TABLE IF NOT EXISTS eval_history (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL,
  node_id    INTEGER NOT NULL,
  year_id    INTEGER NOT NULL,
  niveau     TEXT,
  commentaire TEXT,
  teacher_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hist ON eval_history(student_id, node_id);

CREATE TABLE IF NOT EXISTS year_comments (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  year_id    INTEGER NOT NULL REFERENCES years(id) ON DELETE CASCADE,
  commentaire TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, year_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  libelle     TEXT NOT NULL,
  categorie   TEXT NOT NULL DEFAULT 'Autre',
  fichier     TEXT NOT NULL,
  nom_origine TEXT NOT NULL,
  mime        TEXT,
  taille      INTEGER,
  teacher_id  INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  cle    TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);
`);

/* ------------------------------------------------------------------ */
/* Amorçage                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_SETTINGS = {
  etablissement: 'Institut Pierre Chanay',
  gestionnaire: 'FOL 58 — Fédération des Œuvres Laïques de la Nièvre',
  ville: '',
  mentions_legales:
    "Document interne établi au titre du suivi des acquis scolaires de l'élève. " +
    "Les informations qu'il contient sont confidentielles et relèvent du secret professionnel " +
    "partagé ; elles sont traitées conformément au RGPD (règlement UE 2016/679) et à la loi " +
    "n° 78-17 du 6 janvier 1978 modifiée. Toute diffusion à un tiers non autorisé est interdite. " +
    "Droit d'accès, de rectification et d'effacement auprès de la direction de l'établissement.",
  legende_vert: "Réalisé seul (peu d'aide)",
  legende_orange: 'Réalisé avec aide',
  legende_rouge: "Réalisé avec beaucoup d'aide",
};

export function currentSchoolYearLabel(d = new Date()) {
  const y = d.getFullYear();
  return d.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function insertTree(node, parentId, depth, position, horsPdf) {
  const info = db
    .prepare(
      'INSERT INTO nodes (parent_id, label, depth, position, cycle, hors_pdf) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(parentId, node.label, depth, position, node.cycle || null, horsPdf ? 1 : 0);
  const id = Number(info.lastInsertRowid);
  (node.children || []).forEach((child, i) => insertTree(child, id, depth + 1, i, horsPdf));
  return id;
}

export function importReferentielTree(tree, { horsPdf = false } = {}) {
  const maxPos =
    db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM nodes WHERE parent_id IS NULL').get()
      ?.p ?? -1;
  return insertTree(tree, null, 0, maxPos + 1, horsPdf);
}

export function seed() {
  const n = (sql) => db.prepare(sql).get()?.n ?? 0;

  for (const [cle, valeur] of Object.entries(DEFAULT_SETTINGS)) {
    db.prepare('INSERT OR IGNORE INTO settings (cle, valeur) VALUES (?, ?)').run(cle, valeur);
  }

  if (n('SELECT COUNT(*) AS n FROM years') === 0) {
    const label = currentSchoolYearLabel();
    db.prepare('INSERT INTO years (libelle, courante) VALUES (?, 1)').run(label);
    const [a] = label.split('-').map(Number);
    db.prepare('INSERT OR IGNORE INTO years (libelle, courante) VALUES (?, 0)').run(
      `${a - 1}-${a}`
    );
  }

  let bootstrapPassword = null;
  if (n('SELECT COUNT(*) AS n FROM teachers') === 0) {
    bootstrapPassword = crypto.randomBytes(5).toString('base64url');
    db.prepare(
      `INSERT INTO teachers (civilite, prenom, nom, email, password_hash, role, must_change)
       VALUES ('', 'Direction', '(compte administrateur)', 'admin@local', ?, 'admin', 1)`
    ).run(hashPassword(bootstrapPassword));
  }

  // Amorçage du référentiel, matière par matière : une matière déjà présente
  // n'est jamais réimportée, et une interruption ne laisse pas d'amorçage partiel.
  const presentes = new Set(
    db
      .prepare('SELECT label FROM nodes WHERE parent_id IS NULL')
      .all()
      .map((r) => r.label)
  );
  // Référentiels fournis par l'établissement, déposés à la racine du projet.
  for (const file of fs
    .readdirSync(ROOT)
    .filter((f) => f.toLowerCase().endsWith('.odt') && !f.startsWith('~$'))
    .sort()) {
    const matiere = guessMatiere(file);
    if (presentes.has(matiere)) continue;
    try {
      importReferentielTree(parseReferentielOdt(path.join(ROOT, file), matiere));
      presentes.add(matiere);
      console.log(`  référentiel importé : ${matiere}  (${file})`);
    } catch (err) {
      console.warn(`  !! import impossible pour ${file} : ${err.message}`);
    }
  }
  if (!presentes.has(postureTree.label)) {
    importReferentielTree(postureTree, { horsPdf: true });
    console.log(`  référentiel importé : ${postureTree.label} (hors PDF)`);
  }

  return { bootstrapPassword };
}

/** « Récap programmes Mathématiques 2025.odt » -> « Mathématiques » */
export function guessMatiere(filename) {
  const known = [
    'Mathématiques',
    'Français',
    'Questionner le monde',
    'Histoire-Géographie',
    'Sciences et technologie',
    'Langue vivante',
    'Éducation physique et sportive',
    'Enseignements artistiques',
    'Enseignement moral et civique',
  ];
  const base = filename.replace(/\.odt$/i, '');
  const norm = (s) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  const hit = known.find((k) => norm(base).includes(norm(k)));
  if (hit) return hit;
  return base
    .replace(/r[eé]cap(itulatif)?\s*(des)?\s*programmes?\s*/i, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .trim();
}
