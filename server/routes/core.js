import express from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, newToken } from '../auth.js';
import { requireAuth, requireAdmin, wrap, badRequest, notFound } from '../middleware.js';
import { AUTH_ENABLED } from '../config.js';

const router = express.Router();
const SESSION_DAYS = 30;

const slug = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const publicTeacher = (t) => ({
  id: t.id,
  civilite: t.civilite,
  prenom: t.prenom,
  nom: t.nom,
  email: t.email,
  role: t.role,
  actif: !!t.actif,
  must_change: !!t.must_change,
});

/* ------------------------------ Session ------------------------------ */

router.post(
  '/login',
  wrap((req, res) => {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    const teacher = db
      .prepare('SELECT * FROM teachers WHERE lower(email) = ? AND actif = 1')
      .get(email);
    if (!teacher || !verifyPassword(password, teacher.password_hash))
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });

    const token = newToken();
    db.prepare(
      `INSERT INTO sessions (token, teacher_id, expires_at)
       VALUES (?, ?, datetime('now', ?))`
    ).run(token, teacher.id, `+${SESSION_DAYS} days`);
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();

    res.setHeader(
      'Set-Cookie',
      `lsu_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`
    );
    res.json({ user: publicTeacher(teacher) });
  })
);

router.post(
  '/logout',
  wrap((req, res) => {
    if (req.token) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    res.setHeader('Set-Cookie', 'lsu_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  wrap((req, res) => {
    res.json({
      auth_active: AUTH_ENABLED,
      user: req.user ? publicTeacher(req.user) : null,
    });
  })
);

/**
 * Changement d'identité sans authentification (phase de mise en route).
 * Indisponible dès que LSU_AUTH=1 : on passe alors par /login.
 */
router.post(
  '/profil',
  wrap((req, res) => {
    if (AUTH_ENABLED)
      return res.status(403).json({ error: 'Authentification active : utilisez la connexion' });
    const id = Number(req.body?.teacher_id);
    const t = db.prepare('SELECT * FROM teachers WHERE id = ? AND actif = 1').get(id);
    if (!t) throw notFound('Enseignante introuvable');
    res.setHeader(
      'Set-Cookie',
      `lsu_teacher=${t.id}; SameSite=Lax; Path=/; Max-Age=${365 * 86400}`
    );
    res.json({ user: publicTeacher(t) });
  })
);

router.post(
  '/me/password',
  requireAuth,
  wrap((req, res) => {
    const { actuel, nouveau } = req.body || {};
    if (!verifyPassword(String(actuel || ''), req.user.password_hash))
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    if (String(nouveau || '').length < 8)
      throw badRequest('Le nouveau mot de passe doit comporter au moins 8 caractères');
    db.prepare('UPDATE teachers SET password_hash = ?, must_change = 0 WHERE id = ?').run(
      hashPassword(nouveau),
      req.user.id
    );
    res.json({ ok: true });
  })
);

/* ---------------------------- Enseignantes --------------------------- */

router.get(
  '/teachers',
  requireAuth,
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM student_teachers st WHERE st.teacher_id = t.id) AS nb_eleves
         FROM teachers t ORDER BY t.actif DESC, t.nom COLLATE NOCASE, t.prenom COLLATE NOCASE`
      )
      .all();
    res.json(rows.map((t) => ({ ...publicTeacher(t), nb_eleves: t.nb_eleves })));
  })
);

router.post(
  '/teachers',
  requireAdmin,
  wrap((req, res) => {
    const { civilite, prenom, nom, email, password, role } = req.body || {};
    if (!prenom?.trim() || !nom?.trim()) throw badRequest('Nom et prénom sont obligatoires');
    // Sans authentification, l'identifiant et le mot de passe sont facultatifs :
    // ils sont générés pour que les comptes soient prêts le jour de l'activation.
    const identifiant =
      email?.trim().toLowerCase() ||
      `${slug(prenom)}.${slug(nom)}@local`.replace(/\.{2,}/g, '.');
    if (AUTH_ENABLED && String(password || '').length < 8)
      throw badRequest('Le mot de passe doit comporter au moins 8 caractères');
    if (!AUTH_ENABLED && password && String(password).length < 8)
      throw badRequest('Le mot de passe doit comporter au moins 8 caractères');
    const exists = db.prepare('SELECT id FROM teachers WHERE lower(email) = ?').get(identifiant);
    if (exists) throw badRequest('Cet identifiant est déjà utilisé');

    const info = db
      .prepare(
        `INSERT INTO teachers (civilite, prenom, nom, email, password_hash, role, must_change)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        civilite || 'Mme',
        prenom.trim(),
        nom.trim(),
        identifiant,
        hashPassword(password || newToken().slice(0, 16)),
        role === 'admin' ? 'admin' : 'enseignant'
      );
    res.status(201).json({ id: Number(info.lastInsertRowid), email: identifiant });
  })
);

router.patch(
  '/teachers/:id',
  requireAuth,
  wrap((req, res) => {
    const id = Number(req.params.id);
    const isSelf = id === req.user.id;
    if (!isSelf && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Action réservée aux comptes administrateurs' });
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id);
    if (!t) throw notFound('Enseignante introuvable');

    const { civilite, prenom, nom, email, role, actif, password } = req.body || {};
    db.prepare(
      `UPDATE teachers SET civilite = ?, prenom = ?, nom = ?, email = ?, role = ?, actif = ?
       WHERE id = ?`
    ).run(
      civilite ?? t.civilite,
      (prenom ?? t.prenom).trim(),
      (nom ?? t.nom).trim(),
      (email ?? t.email).trim().toLowerCase(),
      req.user.role === 'admin' ? (role === 'admin' ? 'admin' : 'enseignant') : t.role,
      req.user.role === 'admin' ? (actif === false || actif === 0 ? 0 : 1) : t.actif,
      id
    );
    if (password) {
      if (String(password).length < 8)
        throw badRequest('Le mot de passe doit comporter au moins 8 caractères');
      if (!isSelf && req.user.role !== 'admin')
        return res.status(403).json({ error: 'Action non autorisée' });
      db.prepare('UPDATE teachers SET password_hash = ?, must_change = ? WHERE id = ?').run(
        hashPassword(password),
        isSelf ? 0 : 1,
        id
      );
      db.prepare('DELETE FROM sessions WHERE teacher_id = ? AND token <> ?').run(
        id,
        req.token || ''
      );
    }
    res.json({ ok: true });
  })
);

router.delete(
  '/teachers/:id',
  requireAdmin,
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw badRequest('Vous ne pouvez pas désactiver votre propre compte');
    const nbAdmins = db
      .prepare("SELECT COUNT(*) AS n FROM teachers WHERE role = 'admin' AND actif = 1 AND id <> ?")
      .get(id).n;
    if (nbAdmins === 0) throw badRequest('Il doit rester au moins un compte administrateur actif');
    db.prepare('UPDATE teachers SET actif = 0 WHERE id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE teacher_id = ?').run(id);
    res.json({ ok: true });
  })
);

/* ------------------------------- Élèves ------------------------------ */

const studentTeachers = db.prepare(
  `SELECT t.id, t.civilite, t.prenom, t.nom FROM student_teachers st
   JOIN teachers t ON t.id = st.teacher_id WHERE st.student_id = ?
   ORDER BY t.nom COLLATE NOCASE`
);

export function hydrateStudent(s) {
  return { ...s, archive: !!s.archive, enseignantes: studentTeachers.all(s.id) };
}

router.get(
  '/students',
  requireAuth,
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM evaluations e WHERE e.student_id = s.id AND e.niveau IS NOT NULL) AS nb_evals
         FROM students s
         ORDER BY s.nom COLLATE NOCASE, s.prenom COLLATE NOCASE`
      )
      .all();
    res.json(rows.map(hydrateStudent));
  })
);

router.post(
  '/students',
  requireAuth,
  wrap((req, res) => {
    const { prenom, nom, date_naissance, classe, date_entree, rattacher } = req.body || {};
    if (!prenom?.trim() || !nom?.trim()) throw badRequest("Nom et prénom de l'élève sont obligatoires");
    if (date_naissance && !/^\d{4}-\d{2}-\d{2}$/.test(date_naissance))
      throw badRequest('Date de naissance attendue au format JJ/MM/AAAA');
    const info = db
      .prepare(
        `INSERT INTO students (prenom, nom, date_naissance, classe, date_entree, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        prenom.trim(),
        nom.trim(),
        date_naissance || null,
        classe?.trim() || null,
        date_entree || null,
        req.user.id
      );
    const id = Number(info.lastInsertRowid);
    if (rattacher !== false)
      db.prepare('INSERT OR IGNORE INTO student_teachers VALUES (?, ?)').run(id, req.user.id);
    res.status(201).json(hydrateStudent(db.prepare('SELECT * FROM students WHERE id = ?').get(id)));
  })
);

router.get(
  '/students/:id',
  requireAuth,
  wrap((req, res) => {
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(Number(req.params.id));
    if (!s) throw notFound('Élève introuvable');
    const commentaires = db
      .prepare(
        `SELECT y.id AS year_id, y.libelle, yc.commentaire
         FROM years y LEFT JOIN year_comments yc ON yc.year_id = y.id AND yc.student_id = ?
         ORDER BY y.libelle DESC`
      )
      .all(s.id);
    res.json({ ...hydrateStudent(s), commentaires_annuels: commentaires });
  })
);

router.patch(
  '/students/:id',
  requireAuth,
  wrap((req, res) => {
    const id = Number(req.params.id);
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!s) throw notFound('Élève introuvable');
    const b = req.body || {};
    db.prepare(
      `UPDATE students SET prenom = ?, nom = ?, date_naissance = ?, classe = ?, date_entree = ?,
                           commentaire_scolarite = ?, archive = ?
       WHERE id = ?`
    ).run(
      (b.prenom ?? s.prenom).trim(),
      (b.nom ?? s.nom).trim(),
      b.date_naissance !== undefined ? b.date_naissance || null : s.date_naissance,
      b.classe !== undefined ? b.classe?.trim() || null : s.classe,
      b.date_entree !== undefined ? b.date_entree || null : s.date_entree,
      b.commentaire_scolarite ?? s.commentaire_scolarite,
      b.archive === true || b.archive === 1 ? 1 : 0,
      id
    );
    res.json(hydrateStudent(db.prepare('SELECT * FROM students WHERE id = ?').get(id)));
  })
);

router.delete(
  '/students/:id',
  requireAdmin,
  wrap((req, res) => {
    db.prepare('DELETE FROM students WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  })
);

/* Rattachement élève <-> enseignante */
router.put(
  '/students/:id/teachers',
  requireAuth,
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id))
      throw notFound('Élève introuvable');
    const ids = Array.isArray(req.body?.teacher_ids) ? req.body.teacher_ids.map(Number) : [];
    db.prepare('DELETE FROM student_teachers WHERE student_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO student_teachers VALUES (?, ?)');
    for (const tid of ids) if (db.prepare('SELECT 1 FROM teachers WHERE id = ?').get(tid)) ins.run(id, tid);
    res.json({ enseignantes: studentTeachers.all(id) });
  })
);

/* Commentaires */
router.put(
  '/students/:id/commentaire-scolarite',
  requireAuth,
  wrap((req, res) => {
    db.prepare('UPDATE students SET commentaire_scolarite = ? WHERE id = ?').run(
      String(req.body?.commentaire ?? ''),
      Number(req.params.id)
    );
    res.json({ ok: true });
  })
);

router.put(
  '/students/:id/commentaire-annuel',
  requireAuth,
  wrap((req, res) => {
    const year_id = Number(req.body?.year_id);
    if (!db.prepare('SELECT 1 FROM years WHERE id = ?').get(year_id))
      throw badRequest('Année scolaire inconnue');
    db.prepare(
      `INSERT INTO year_comments (student_id, year_id, commentaire)
       VALUES (?, ?, ?)
       ON CONFLICT(student_id, year_id)
       DO UPDATE SET commentaire = excluded.commentaire, updated_at = datetime('now')`
    ).run(Number(req.params.id), year_id, String(req.body?.commentaire ?? ''));
    res.json({ ok: true });
  })
);

/* ------------------------------- Années ------------------------------ */

router.get(
  '/years',
  requireAuth,
  wrap((_req, res) => {
    res.json(db.prepare('SELECT id, libelle, courante FROM years ORDER BY libelle DESC').all());
  })
);

router.post(
  '/years',
  requireAuth,
  wrap((req, res) => {
    const libelle = String(req.body?.libelle || '').trim();
    if (!/^\d{4}-\d{4}$/.test(libelle)) throw badRequest('Année scolaire attendue au format 2025-2026');
    db.prepare('INSERT OR IGNORE INTO years (libelle) VALUES (?)').run(libelle);
    const row = db.prepare('SELECT id, libelle, courante FROM years WHERE libelle = ?').get(libelle);
    res.status(201).json(row);
  })
);

router.post(
  '/years/:id/courante',
  requireAuth,
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM years WHERE id = ?').get(id)) throw notFound('Année inconnue');
    db.prepare('UPDATE years SET courante = 0').run();
    db.prepare('UPDATE years SET courante = 1 WHERE id = ?').run(id);
    res.json({ ok: true });
  })
);

/* ----------------------------- Paramètres ---------------------------- */

router.get(
  '/settings',
  requireAuth,
  wrap((_req, res) => {
    const out = {};
    for (const r of db.prepare('SELECT cle, valeur FROM settings').all()) out[r.cle] = r.valeur;
    res.json(out);
  })
);

router.put(
  '/settings',
  requireAdmin,
  wrap((req, res) => {
    const stmt = db.prepare(
      `INSERT INTO settings (cle, valeur) VALUES (?, ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`
    );
    for (const [k, v] of Object.entries(req.body || {})) stmt.run(k, String(v ?? ''));
    res.json({ ok: true });
  })
);

export default router;
