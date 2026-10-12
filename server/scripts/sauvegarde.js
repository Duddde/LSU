// Sauvegarde de la base et des documents. Usage : npm run sauvegarde
// Le serveur peut rester allumé : la copie est faite par SQLite lui-même
// (VACUUM INTO), elle est donc toujours cohérente.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = process.env.LSU_DATA ? path.resolve(process.env.LSU_DATA) : path.join(ROOT, 'data');
const SAUVEGARDES = path.join(DATA_DIR, 'sauvegardes');

/** Copie datée de la base et des documents. Renvoie le dossier créé, ou null. */
export function sauvegarde(motif = '') {
  const base = path.join(DATA_DIR, 'lsu.sqlite');
  if (!fs.existsSync(base)) return null;
  const horodatage = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dossier = path.join(SAUVEGARDES, horodatage + (motif ? `-${motif}` : ''));
  fs.mkdirSync(dossier, { recursive: true });

  const db = new DatabaseSync(base, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${path.join(dossier, 'lsu.sqlite').replace(/\\/g, '/').replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const uploads = path.join(DATA_DIR, 'uploads');
  if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dossier, 'uploads'), { recursive: true });
  return dossier;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dossier = sauvegarde(process.argv[2]?.replace(/[^a-z0-9-]/gi, '') || '');
  console.log(
    dossier
      ? `Sauvegarde écrite dans ${path.relative(ROOT, dossier)}`
      : 'Aucune base à sauvegarder.'
  );
}
