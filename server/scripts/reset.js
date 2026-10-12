// Remise à zéro de la base (données + documents).
// Usage : npm run reset -- --oui
// Une sauvegarde datée est systématiquement écrite dans data/sauvegardes/
// avant toute suppression : rien n'est perdu sans filet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sauvegarde } from './sauvegarde.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = process.env.LSU_DATA ? path.resolve(process.env.LSU_DATA) : path.join(ROOT, 'data');
const BASE = path.join(DATA_DIR, 'lsu.sqlite');

/** Ce que la remise à zéro va détruire, pour l'annoncer avant de le faire. */
function contenu() {
  if (!fs.existsSync(BASE)) return null;
  const db = new DatabaseSync(BASE, { readOnly: true });
  try {
    const n = (sql) => {
      try {
        return db.prepare(sql).get().n;
      } catch {
        return 0;
      }
    };
    return {
      eleves: n('SELECT COUNT(*) AS n FROM students'),
      evaluations: n('SELECT COUNT(*) AS n FROM evaluations WHERE niveau IS NOT NULL'),
      enseignantes: n("SELECT COUNT(*) AS n FROM teachers WHERE email <> 'admin@local'"),
      documents: n('SELECT COUNT(*) AS n FROM documents'),
    };
  } finally {
    db.close();
  }
}

const c = contenu();
if (!process.argv.includes('--oui')) {
  console.log(
    c
      ? `Cette commande supprime ${c.eleves} élève(s), ${c.evaluations} évaluation(s), ` +
        `${c.enseignantes} compte(s) enseignante et ${c.documents} document(s).\n` +
        'Une sauvegarde sera écrite dans data/sauvegardes/ avant la suppression.\n' +
        'Pour confirmer : npm run reset -- --oui'
      : 'Aucune base existante : rien à supprimer.'
  );
  process.exit(1);
}

const copie = sauvegarde('avant-reset');
if (copie) console.log(`Sauvegarde écrite dans ${path.relative(ROOT, copie)}`);

for (const f of ['lsu.sqlite', 'lsu.sqlite-wal', 'lsu.sqlite-shm'])
  fs.rmSync(path.join(DATA_DIR, f), { force: true });
fs.rmSync(path.join(DATA_DIR, 'uploads'), { recursive: true, force: true });
console.log('Base et documents supprimés. Le prochain démarrage réimporte les référentiels .odt.');
