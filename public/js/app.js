import { h, mount, toast, initiales } from './dom.js';
import { api, etat, chargeContexte } from './api.js';
import vueEleves from './vue-eleves.js';
import vueEleve from './vue-eleve.js';
import vueReferentiel from './vue-referentiel.js';
import vueEnseignantes from './vue-enseignantes.js';
import vueParametres from './vue-parametres.js';

const ROUTES = [
  { re: /^\/eleves?$/, vue: vueEleves, onglet: 'eleves' },
  { re: /^\/eleve\/(\d+)$/, vue: vueEleve, onglet: 'eleves' },
  { re: /^\/referentiel$/, vue: vueReferentiel, onglet: 'referentiel' },
  { re: /^\/enseignantes$/, vue: vueEnseignantes, onglet: 'enseignantes' },
  { re: /^\/parametres$/, vue: vueParametres, onglet: 'parametres' },
];

export const navigue = (route) => {
  location.hash = '#' + route;
};

function entete(ongletActif) {
  const el = document.getElementById('entete');
  const lien = (route, libelle, cle) =>
    h('a', { href: '#' + route, class: ongletActif === cle ? 'actif' : '' }, libelle);

  const selectAnnee = h(
    'select',
    {
      title: 'Année scolaire de travail',
      onchange: (e) => {
        etat.year = etat.years.find((y) => y.id === Number(e.target.value));
        rend();
      },
    },
    etat.years.map((y) => h('option', { value: y.id, selected: y.id === etat.year?.id }, y.libelle))
  );

  const selectPeriode = h(
    'select',
    {
      title: 'Semestre du livret',
      'aria-label': 'Semestre du livret',
      onchange: (e) => {
        etat.periode = e.target.value;
        localStorage.setItem('lsu_periode', etat.periode);
        rend();
      },
    },
    ['1', '2'].map((p) => h('option', { value: p, selected: p === etat.periode }, `Semestre ${p}`))
  );

  const identite = etat.authActive
    ? h(
        'div',
        { class: 'ident-pilule' },
        h('span', { class: 'avatar' }, initiales(etat.user?.prenom, etat.user?.nom)),
        h('span', {}, etat.user ? `${etat.user.prenom} ${etat.user.nom}` : ''),
        h(
          'button',
          {
            class: 'btn mini',
            onclick: async () => {
              await api.post('/api/logout');
              location.reload();
            },
          },
          'Déconnexion'
        )
      )
    : h(
        'div',
        { class: 'ident-pilule' },
        h('span', { class: 'avatar' }, initiales(etat.user?.prenom, etat.user?.nom)),
        h(
          'select',
          {
            title: 'Identité courante (filtre « mes élèves »)',
            'aria-label': 'Identité courante',
            onchange: async (e) => {
              await api.post('/api/profil', { teacher_id: Number(e.target.value) });
              await chargeContexte();
              rend();
              toast(`Profil : ${etat.user.prenom} ${etat.user.nom}`);
            },
          },
          etat.teachers
            .filter((t) => t.actif)
            .map((t) =>
              h('option', { value: t.id, selected: t.id === etat.user?.id }, `${t.civilite} ${t.prenom} ${t.nom}`)
            )
        )
      );

  mount(
    el,
    h(
      'div',
      { class: 'brand' },
      'Livret scolaire',
      h('small', {}, etat.settings.etablissement || '')
    ),
    h(
      'nav',
      {},
      lien('/eleves', 'Élèves', 'eleves'),
      lien('/referentiel', 'Référentiel', 'referentiel'),
      lien('/enseignantes', 'Enseignantes', 'enseignantes'),
      lien('/parametres', 'Paramètres', 'parametres')
    ),
    h('div', { class: 'spacer' }),
    h('div', { class: 'seg-entete' }, selectAnnee, selectPeriode),
    identite
  );
}

async function rend() {
  if (etat.authActive && !etat.user) {
    const { default: vueConnexion } = await import('./vue-connexion.js');
    mount(document.getElementById('vue'), vueConnexion());
    return;
  }
  const route = location.hash.replace(/^#/, '') || '/eleves';
  const trouve = ROUTES.find((r) => r.re.test(route));
  entete(trouve?.onglet);
  const cible = document.getElementById('vue');
  if (!trouve) {
    mount(cible, h('div', { class: 'vide' }, 'Page introuvable. ', h('a', { href: '#/eleves' }, 'Retour aux élèves')));
    return;
  }
  const params = route.match(trouve.re).slice(1);
  mount(cible, h('div', { class: 'vide' }, 'Chargement…'));
  try {
    const contenu = await trouve.vue(...params);
    mount(cible, contenu);
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error(err);
    mount(
      cible,
      h('div', { class: 'carte' }, h('div', { class: 'corps' }, h('p', {}, `Erreur : ${err.message}`)))
    );
  }
}

window.addEventListener('hashchange', rend);

(async function demarre() {
  try {
    await chargeContexte();
  } catch (err) {
    document.getElementById('vue').textContent = `Impossible de contacter le serveur : ${err.message}`;
    return;
  }
  await rend();
})();

export { rend };
