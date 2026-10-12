import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, seed, ROOT } from './db.js';
import { parseCookies } from './auth.js';
import { AUTH_ENABLED } from './config.js';
import coreRoutes from './routes/core.js';
import referentielRoutes from './routes/referentiel.js';
import dossierRoutes from './routes/dossier.js';
import printRoutes from './routes/print.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST; // non défini = double pile IPv4/IPv6

const { bootstrapPassword } = seed();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

/* --- Identité de la requête ------------------------------------------ */
app.use((req, _res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  if (AUTH_ENABLED) {
    const token = cookies.lsu_session;
    if (token) {
      const row = db
        .prepare(
          `SELECT t.* FROM sessions s JOIN teachers t ON t.id = s.teacher_id
           WHERE s.token = ? AND s.expires_at > datetime('now') AND t.actif = 1`
        )
        .get(token);
      if (row) {
        req.user = row;
        req.token = token;
      }
    }
  } else {
    // Mode sans authentification : l'identité vient du sélecteur de l'en-tête.
    const id = Number(cookies.lsu_teacher);
    req.user =
      (id && db.prepare('SELECT * FROM teachers WHERE id = ? AND actif = 1').get(id)) ||
      db
        .prepare(
          `SELECT * FROM teachers WHERE actif = 1
           ORDER BY (role = 'admin') DESC, id LIMIT 1`
        )
        .get();
  }
  next();
});

/* --- Routes ---------------------------------------------------------- */
app.use('/api', coreRoutes);
app.use('/api', referentielRoutes);
app.use('/api', dossierRoutes);
app.use('/print', printRoutes);

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.get(/^\/(?!api|print|assets)/, (_req, res) =>
  res.sendFile(path.join(ROOT, 'public', 'index.html'))
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur' });
});

app.listen(PORT, HOST, () => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
  console.log(`\n  Livret Scolaire Unique — http://localhost:${PORT}`);
  console.log(`  ${n} entrées dans le référentiel, base : data/lsu.sqlite`);
  if (AUTH_ENABLED) {
    console.log('  Authentification : ACTIVE (LSU_AUTH=1)');
    if (bootstrapPassword) {
      console.log('\n  ┌───────────────────────────────────────────────┐');
      console.log('  │  Premier démarrage : compte administrateur     │');
      console.log('  │  identifiant  : admin@local                    │');
      console.log(`  │  mot de passe : ${bootstrapPassword.padEnd(30)}│`);
      console.log('  │  (à changer à la première connexion)           │');
      console.log('  └───────────────────────────────────────────────┘');
    }
  } else {
    console.log('  Authentification : désactivée — identité choisie dans l\'en-tête');
    console.log('  (pour l\'activer plus tard : LSU_AUTH=1 npm start)');
  }
  console.log('');
});
