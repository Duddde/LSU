/** Mini-helpers DOM, sans dépendance. */

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    // « value » doit passer par la propriété : <textarea> n'a pas d'attribut value,
    // le texte saisi ne s'afficherait donc pas en revenant sur une compétence.
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clear = (el) => {
  while (el.firstChild) el.firstChild.remove();
  return el;
};

export const mount = (el, ...children) => {
  clear(el);
  append(el, children);
  return el;
};

/* ------------------------------- Texte ------------------------------- */

export const normalise = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .toLowerCase();

export const initiales = (s = '', p = '') => (s[0] || '').toUpperCase() + (p[0] || '').toUpperCase();

export function frDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : '';
}

export function frDateHeure(iso) {
  if (!iso) return '';
  const s = String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z');
  const d = new Date(s);
  if (isNaN(d)) return iso;
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function age(naissance, ref = new Date()) {
  if (!naissance) return null;
  const n = new Date(naissance);
  if (isNaN(n)) return null;
  let a = ref.getFullYear() - n.getFullYear();
  if (ref.getMonth() < n.getMonth() || (ref.getMonth() === n.getMonth() && ref.getDate() < n.getDate())) a--;
  return a;
}

export const tranche = (a) => (a == null ? '' : a < 11 ? '6 → 11 ans' : a < 15 ? '11 → 15 ans' : '15 → 18 ans');

export const taille = (o) =>
  o < 1024 ? `${o} o` : o < 1048576 ? `${(o / 1024).toFixed(0)} Ko` : `${(o / 1048576).toFixed(1)} Mo`;

/** Surligne les occurrences de `q` dans `texte` (retourne un fragment). */
export function surligne(texte, q) {
  const frag = document.createDocumentFragment();
  const nq = normalise(q);
  if (!nq) return frag.append(texte), frag;
  const nt = normalise(texte);
  let i = 0;
  let pos = nt.indexOf(nq);
  while (pos >= 0) {
    frag.append(texte.slice(i, pos), h('mark', {}, texte.slice(pos, pos + nq.length)));
    i = pos + nq.length;
    pos = nt.indexOf(nq, i);
  }
  frag.append(texte.slice(i));
  return frag;
}

/* ------------------------------ Toasts ------------------------------- */

export function toast(message, type = '') {
  const el = h('div', { class: `toast ${type}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, type === 'err' ? 5200 : 2600);
}

/* ------------------------------ Modales ------------------------------ */

export function modale({ titre, corps, actions = [], large = false, onOuvert }) {
  const voile = h('div', { class: 'voile' });
  const fermer = () => voile.remove();
  const boite = h(
    'div',
    { class: `modale ${large ? 'large' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    h('header', {}, h('h2', {}, titre), h('button', { class: 'fermer', title: 'Fermer', onclick: fermer }, '×')),
    h('div', { class: 'corps' }, corps),
    actions.length ? h('footer', {}, actions.map((a) => (typeof a === 'function' ? a(fermer) : a))) : null
  );
  voile.append(boite);
  voile.addEventListener('mousedown', (e) => {
    if (e.target === voile) fermer();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      fermer();
      document.removeEventListener('keydown', esc);
    }
  });
  document.body.append(voile);
  boite.querySelector('input, select, textarea, button')?.focus();
  onOuvert?.({ fermer, boite });
  return { fermer, boite };
}

export function confirme(message, { titre = 'Confirmation', libelle = 'Confirmer', danger = true } = {}) {
  return new Promise((resolve) => {
    const { fermer } = modale({
      titre,
      corps: h('p', { style: { margin: 0, whiteSpace: 'pre-line' } }, message),
      actions: [
        h('button', { class: 'btn', onclick: () => (fermer(), resolve(false)) }, 'Annuler'),
        h(
          'button',
          { class: `btn ${danger ? 'danger' : 'primaire'}`, onclick: () => (fermer(), resolve(true)) },
          libelle
        ),
      ],
    });
  });
}

/** Enregistrement différé (frappe au clavier). */
export function debounce(fn, ms = 600) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}
