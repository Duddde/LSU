import { AUTH_ENABLED } from './config.js';

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
  if (AUTH_ENABLED && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Action réservée aux comptes administrateurs' });
  next();
}

/** Enveloppe un handler pour router les exceptions vers le middleware d'erreur. */
export const wrap = (fn) => (req, res, next) => {
  try {
    return fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

export function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export function notFound(message = 'Ressource introuvable') {
  const err = new Error(message);
  err.status = 404;
  return err;
}
