import express from 'express';
import { db, importReferentielTree } from '../db.js';
import { requireAuth, wrap, badRequest, notFound } from '../middleware.js';
import { parseReferentielOdt } from '../odt.js';
import multer from 'multer';
import os from 'node:os';
import fs from 'node:fs';

const router = express.Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 20 * 1024 * 1024 } });

/** Arbre complet (matières -> orange -> jaune -> gris -> compétences). */
export function buildTree({ includeArchived = false } = {}) {
  const rows = db
    .prepare(
      `SELECT id, parent_id, label, depth, position, cycle, hors_pdf, archive
       FROM nodes ${includeArchived ? '' : 'WHERE archive = 0'}
       ORDER BY depth, position, id`
    )
    .all();
  const byId = new Map();
  for (const r of rows)
    byId.set(r.id, {
      id: r.id,
      parent_id: r.parent_id,
      label: r.label,
      depth: r.depth,
      cycle: r.cycle,
      hors_pdf: !!r.hors_pdf,
      archive: !!r.archive,
      children: [],
    });
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) {
      parent.children.push(node);
      node.hors_pdf = node.hors_pdf || parent.hors_pdf;
    } else roots.push(node);
  }
  // hors_pdf est héréditaire : on le propage après rattachement complet.
  const propagate = (n, flag) => {
    n.hors_pdf = n.hors_pdf || flag;
    n.children.forEach((c) => propagate(c, n.hors_pdf));
  };
  roots.forEach((r) => propagate(r, false));
  return roots;
}

/** Liste plate des compétences (feuilles) avec leur chemin, pour la recherche. */
export function flattenLeaves(roots) {
  const out = [];
  const walk = (node, path) => {
    const here = [...path, node];
    if (!node.children.length) {
      out.push({
        id: node.id,
        label: node.label,
        cycle: node.cycle,
        hors_pdf: node.hors_pdf,
        matiere: here[0]?.label || '',
        matiere_id: here[0]?.id,
        chemin: here.slice(1, -1).map((n) => n.label),
        path_ids: here.map((n) => n.id),
      });
    } else node.children.forEach((c) => walk(c, here));
  };
  roots.forEach((r) => walk(r, []));
  return out;
}

router.get(
  '/referentiel',
  requireAuth,
  wrap((req, res) => {
    const roots = buildTree({ includeArchived: req.query.archives === '1' });
    res.json({ matieres: roots, competences: flattenLeaves(roots) });
  })
);

/* ----------------------- Création / modification --------------------- */

router.post(
  '/nodes',
  requireAuth,
  wrap((req, res) => {
    const { parent_id, label, cycle, hors_pdf } = req.body || {};
    if (!String(label || '').trim()) throw badRequest("L'intitulé est obligatoire");
    let depth = 0;
    if (parent_id) {
      const parent = db.prepare('SELECT * FROM nodes WHERE id = ?').get(Number(parent_id));
      if (!parent) throw badRequest('Catégorie parente introuvable');
      depth = parent.depth + 1;
    }
    const pos =
      (db
        .prepare(
          `SELECT COALESCE(MAX(position), -1) AS p FROM nodes
           WHERE parent_id IS ?`
        )
        .get(parent_id ? Number(parent_id) : null)?.p ?? -1) + 1;
    const info = db
      .prepare(
        `INSERT INTO nodes (parent_id, label, depth, position, cycle, hors_pdf)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        parent_id ? Number(parent_id) : null,
        String(label).trim(),
        depth,
        pos,
        cycle?.trim() || null,
        hors_pdf ? 1 : 0
      );
    res.status(201).json({ id: Number(info.lastInsertRowid), depth });
  })
);

router.patch(
  '/nodes/:id',
  requireAuth,
  wrap((req, res) => {
    const id = Number(req.params.id);
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    if (!node) throw notFound('Entrée du référentiel introuvable');
    const b = req.body || {};
    if (b.label !== undefined && !String(b.label).trim())
      throw badRequest("L'intitulé ne peut pas être vide");
    db.prepare(
      `UPDATE nodes SET label = ?, cycle = ?, hors_pdf = ?, archive = ? WHERE id = ?`
    ).run(
      b.label !== undefined ? String(b.label).trim() : node.label,
      b.cycle !== undefined ? b.cycle?.trim() || null : node.cycle,
      b.hors_pdf !== undefined ? (b.hors_pdf ? 1 : 0) : node.hors_pdf,
      b.archive !== undefined ? (b.archive ? 1 : 0) : node.archive,
      id
    );
    res.json({ ok: true });
  })
);

/**
 * Déplacement d'une entrée.
 *  - { direction: 'up' | 'down' }        : permutation avec le frère voisin
 *  - { parent_id, before_id | index }    : glisser-déposer (changement de parent
 *                                          et / ou de rang dans la fratrie)
 * `before_id` désigne le frère devant lequel insérer, `null` = à la fin.
 */
router.post(
  '/nodes/:id/move',
  requireAuth,
  wrap((req, res) => {
    const id = Number(req.params.id);
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    if (!node) throw notFound('Entrée introuvable');
    const b = req.body || {};

    if (b.direction) {
      const siblings = db
        .prepare('SELECT id, position FROM nodes WHERE parent_id IS ? ORDER BY position, id')
        .all(node.parent_id);
      const i = siblings.findIndex((s) => s.id === id);
      const j = b.direction === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= siblings.length) return res.json({ ok: true });
      const upd = db.prepare('UPDATE nodes SET position = ? WHERE id = ?');
      siblings.forEach((s, k) => upd.run(k, s.id));
      upd.run(j, siblings[i].id);
      upd.run(i, siblings[j].id);
      return res.json({ ok: true });
    }

    const parentId = b.parent_id === null || b.parent_id === undefined ? null : Number(b.parent_id);
    let parent = null;
    if (parentId !== null) {
      parent = db.prepare('SELECT * FROM nodes WHERE id = ?').get(parentId);
      if (!parent) throw badRequest('Destination introuvable');
    }
    // Une matière reste une matière : pas de rétrogradation ni de promotion
    // accidentelle d'une catégorie au rang de matière.
    if ((node.parent_id === null) !== (parentId === null))
      throw badRequest(
        node.parent_id === null
          ? "Une matière ne peut pas devenir une catégorie : déposez-la entre deux matières."
          : "Seules les matières peuvent être déposées au premier niveau."
      );
    const branche = descendantIds(id);
    if (parentId !== null && branche.includes(parentId))
      throw badRequest('Impossible de déplacer une entrée dans sa propre arborescence');

    const siblings = db
      .prepare('SELECT id FROM nodes WHERE parent_id IS ? AND id <> ? ORDER BY position, id')
      .all(parentId, id)
      .map((r) => r.id);
    let index = siblings.length;
    if (b.before_id !== null && b.before_id !== undefined) {
      const at = siblings.indexOf(Number(b.before_id));
      if (at >= 0) index = at;
    } else if (Number.isInteger(b.index)) {
      index = Math.max(0, Math.min(Number(b.index), siblings.length));
    }
    siblings.splice(index, 0, id);

    const depth = parent ? parent.depth + 1 : 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE nodes SET parent_id = ?, depth = ? WHERE id = ?').run(parentId, depth, id);
      if (depth !== node.depth) {
        const ecart = depth - node.depth;
        const enfants = branche.filter((x) => x !== id);
        if (enfants.length)
          db.prepare(
            `UPDATE nodes SET depth = depth + ? WHERE id IN (${enfants.map(() => '?').join(',')})`
          ).run(ecart, ...enfants);
      }
      const upd = db.prepare('UPDATE nodes SET position = ? WHERE id = ?');
      siblings.forEach((sid, k) => upd.run(k, sid));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true, parent_id: parentId, depth, position: index });
  })
);

/**
 * Suppression. Si des évaluations existent sur la branche, on archive
 * (les livrets déjà renseignés restent lisibles) sauf ?force=1.
 */
router.delete(
  '/nodes/:id',
  requireAuth,
  wrap((req, res) => {
    const id = Number(req.params.id);
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    if (!node) throw notFound('Entrée introuvable');
    const ids = descendantIds(id);
    const used = db
      .prepare(
        `SELECT COUNT(*) AS n FROM evaluations
         WHERE niveau IS NOT NULL AND node_id IN (${ids.map(() => '?').join(',')})`
      )
      .get(...ids).n;
    if (used > 0 && req.query.force !== '1') {
      const stmt = db.prepare('UPDATE nodes SET archive = 1 WHERE id = ?');
      ids.forEach((x) => stmt.run(x));
      return res.json({ archive: true, evaluations: used });
    }
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id); // cascade sur les enfants
    res.json({ supprime: true, evaluations: used });
  })
);

function descendantIds(id) {
  const out = [id];
  const stmt = db.prepare('SELECT id FROM nodes WHERE parent_id = ?');
  for (let i = 0; i < out.length; i++) for (const r of stmt.all(out[i])) out.push(r.id);
  return out;
}

/* ------------------------- Import d'un ODT --------------------------- */

router.post(
  '/referentiel/import',
  requireAuth,
  upload.single('fichier'),
  wrap((req, res) => {
    if (!req.file) throw badRequest('Aucun fichier reçu');
    try {
      const matiere = String(req.body?.matiere || '').trim() || undefined;
      const tree = parseReferentielOdt(req.file.path, matiere || req.file.originalname.replace(/\.odt$/i, ''));
      const count = (function n(t) {
        return 1 + (t.children || []).reduce((s, c) => s + n(c), 0);
      })(tree);
      const id = importReferentielTree(tree, { horsPdf: req.body?.hors_pdf === '1' });
      res.status(201).json({ id, matiere: tree.label, entrees: count });
    } finally {
      fs.rm(req.file.path, { force: true }, () => {});
    }
  })
);

export default router;
