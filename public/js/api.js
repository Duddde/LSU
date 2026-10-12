import { toast } from './dom.js';

async function requete(methode, url, corps) {
  const opts = { method: methode, headers: {} };
  if (corps instanceof FormData) opts.body = corps;
  else if (corps !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(corps);
  }
  const rep = await fetch(url, opts);
  const texte = await rep.text();
  let data = null;
  try {
    data = texte ? JSON.parse(texte) : null;
  } catch {
    data = { error: texte };
  }
  if (!rep.ok) {
    const err = new Error(data?.error || `Erreur ${rep.status}`);
    err.status = rep.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => requete('GET', url),
  post: (url, corps) => requete('POST', url, corps),
  put: (url, corps) => requete('PUT', url, corps),
  patch: (url, corps) => requete('PATCH', url, corps),
  del: (url) => requete('DELETE', url),
};

/** Exécute un appel API en signalant les erreurs à l'utilisatrice. */
export async function essaie(promesse, messageOk) {
  try {
    const r = await promesse;
    if (messageOk) toast(messageOk, 'ok');
    return r;
  } catch (err) {
    toast(err.message, 'err');
    throw err;
  }
}

/* ------------------------- État partagé ------------------------------ */

export const etat = {
  user: null,
  authActive: false,
  teachers: [],
  years: [],
  year: null,
  settings: {},
  referentiel: null, // { matieres, competences }
  students: [],
};

export async function chargeContexte() {
  const me = await api.get('/api/me');
  etat.user = me.user;
  etat.authActive = me.auth_active;
  if (!etat.user) return; // écran de connexion
  const [teachers, years, settings] = await Promise.all([
    api.get('/api/teachers'),
    api.get('/api/years'),
    api.get('/api/settings'),
  ]);
  etat.teachers = teachers;
  etat.years = years;
  etat.settings = settings;
  const courante = years.find((y) => y.courante) || years[0];
  if (!etat.year || !years.some((y) => y.id === etat.year.id)) etat.year = courante;
}

export async function chargeReferentiel(force = false) {
  if (!etat.referentiel || force) etat.referentiel = await api.get('/api/referentiel');
  return etat.referentiel;
}

export async function chargeEleves(force = true) {
  if (force || !etat.students.length) etat.students = await api.get('/api/students');
  return etat.students;
}
