import { h, mount, toast } from './dom.js';
import { api, essaie, etat, chargeContexte } from './api.js';

export default async function vueParametres() {
  const s = etat.settings;

  const champs = {
    etablissement: ['Établissement', 'text'],
    gestionnaire: ['Organisme gestionnaire', 'text'],
    ville: ['Ville / adresse (pied de page)', 'text'],
  };
  const legendes = {
    legende_vert: ['Réalisé seul', 'var(--vert)'],
    legende_orange: ['Réalisé avec aide', 'var(--orange)'],
    legende_rouge: ["Réalisé avec beaucoup d'aide", 'var(--rouge)'],
  };
  const entrees = {};
  for (const [cle, [libelle, type]] of Object.entries(champs))
    entrees[cle] = h('input', { type, value: s[cle] || '' });
  for (const [cle, [defaut]] of Object.entries(legendes))
    entrees[cle] = h('input', { type: 'text', value: s[cle] || '', placeholder: defaut });
  entrees.mentions_legales = h('textarea', { value: s.mentions_legales || '', style: { minHeight: '130px' } });

  const annees = h('div', {});
  function dessineAnnees() {
    mount(
      annees,
      h(
        'div',
        { class: 'row' },
        etat.years.map((y) =>
          h(
            'span',
            { class: `pastille ${y.courante ? 'moi' : ''}`, style: { fontSize: '13px', padding: '4px 10px' } },
            y.libelle,
            y.courante ? ' (courante)' : '',
            !y.courante
              ? h(
                  'button',
                  {
                    class: 'btn mini',
                    style: { marginLeft: '6px' },
                    onclick: async () => {
                      await essaie(api.post(`/api/years/${y.id}/courante`), `Année courante : ${y.libelle}`);
                      await chargeContexte();
                      dessineAnnees();
                    },
                  },
                  'définir comme courante'
                )
              : null
          )
        )
      )
    );
  }
  dessineAnnees();

  const nouvelleAnnee = h('input', { type: 'text', placeholder: '2026-2027', style: { maxWidth: '140px' } });

  async function enregistre() {
    const payload = {};
    for (const cle of Object.keys(entrees)) payload[cle] = entrees[cle].value;
    await essaie(api.put('/api/settings', payload), 'Paramètres enregistrés');
    await chargeContexte();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  const carte = (titre, descr, ...contenu) =>
    h(
      'div',
      { class: 'carte' },
      h(
        'header',
        {},
        h('div', { class: 'titres grow' }, h('h2', {}, titre), descr ? h('div', { class: 'descr' }, descr) : null)
      ),
      h('div', { class: 'corps' }, ...contenu)
    );

  /* ----------------------------- Sections ---------------------------- */

  const SECTIONS = [
    [
      'etablissement',
      'Établissement',
      () =>
        h(
          'div',
          { class: 'pile', style: { gap: '20px' } },
          carte(
            'Établissement et mentions légales',
            'Imprimés en en-tête et pied de chaque livret.',
            h(
              'div',
              { class: 'grille' },
              Object.entries(champs).map(([cle, [libelle]]) =>
                h('label', { class: 'champ' }, h('span', {}, libelle), entrees[cle])
              )
            ),
            h('label', { class: 'champ' }, h('span', {}, 'Mentions légales'), entrees.mentions_legales)
          ),
          carte(
            'Légende des couleurs',
            'Libellés affichés dans l’évaluation et sur les PDF.',
            h(
              'div',
              { class: 'grille', style: { gap: '16px' } },
              Object.entries(legendes).map(([cle, [, couleur]]) =>
                h('div', { class: 'champ-legende' }, h('i', { style: { background: couleur } }), entrees[cle])
              )
            )
          ),
          h(
            'div',
            { class: 'barre-actions' },
            h('button', { class: 'btn primaire', onclick: enregistre }, 'Enregistrer')
          )
        ),
    ],
    [
      'annees',
      'Années scolaires',
      () =>
        carte(
          'Années scolaires',
          'L’année courante est celle proposée par défaut dans l’en-tête.',
          annees,
          h(
            'div',
            { class: 'row', style: { marginTop: '12px' } },
            nouvelleAnnee,
            h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  if (!/^\d{4}-\d{4}$/.test(nouvelleAnnee.value.trim()))
                    return toast('Format attendu : 2026-2027', 'err');
                  await essaie(api.post('/api/years', { libelle: nouvelleAnnee.value.trim() }), 'Année ajoutée');
                  nouvelleAnnee.value = '';
                  await chargeContexte();
                  dessineAnnees();
                },
              },
              'Ajouter une année'
            )
          )
        ),
    ],
    [
      'logos',
      'Logos du livret',
      () =>
        carte(
          'Logos du livret',
          'Intégrés automatiquement en en-tête des PDF.',
          h(
            'p',
            { style: { marginTop: 0 } },
            'Déposez les fichiers officiels dans ',
            h('code', {}, 'public/assets/logos/'),
            ' avec ces noms exacts (png, jpg ou svg) :'
          ),
          h(
            'ul',
            { class: 'small' },
            h('li', {}, h('code', {}, 'education-nationale.png'), ' — bloc-marque Ministère de l’Éducation nationale / République française'),
            h('li', {}, h('code', {}, 'pierre-chanay.png'), ' — Institut Pierre Chanay'),
            h('li', {}, h('code', {}, 'fol58.png'), ' — FOL 58 (utilisé si le logo de l’institut est absent)')
          ),
          h('p', { class: 'small muted' }, 'Tant qu’un fichier est absent, un emplacement en pointillés apparaît à sa place sur le document.'),
          h('div', { class: 'row' }, ...['education-nationale', 'pierre-chanay', 'fol58'].map(apercu))
        ),
    ],
    [
      'auth',
      'Authentification',
      () =>
        carte(
          'Authentification',
          etat.authActive ? 'Active.' : 'Désactivée — phase de mise en route.',
          etat.authActive
            ? h('p', { style: { marginTop: 0 } }, 'Chaque enseignante se connecte avec son identifiant et son mot de passe.')
            : h(
                'div',
                {},
                h('p', { style: { marginTop: 0 } }, 'L’identité se choisit dans l’en-tête et tout le monde a tous les droits.'),
                h(
                  'p',
                  { class: 'small muted', style: { marginBottom: 0 } },
                  'Pour l’activer, démarrer le serveur avec la variable d’environnement ',
                  h('code', {}, 'LSU_AUTH=1'),
                  ' : les comptes et les mots de passe déjà saisis sont alors utilisés, sans aucune autre modification.'
                )
              )
        ),
    ],
  ];

  let section = SECTIONS[0][0];
  const nav = h('div', { class: 'param-nav' });
  const panneau = h('div', {});

  function afficheSection(cle) {
    section = cle;
    mount(
      nav,
      SECTIONS.map(([k, lib]) =>
        h('button', { class: k === cle ? 'actif' : '', onclick: () => afficheSection(k) }, lib)
      )
    );
    mount(panneau, SECTIONS.find(([k]) => k === cle)[2]());
  }
  afficheSection(section);

  return h(
    'div',
    {},
    h('h1', { class: 'titre-page' }, 'Paramètres'),
    h('div', { class: 'param' }, nav, panneau)
  );
}

function apercu(nom) {
  const img = h('img', {
    src: `/assets/logos/${nom}.png`,
    alt: nom,
    style: { height: '54px', maxWidth: '150px', objectFit: 'contain' },
    onerror: (e) => {
      const svg = `/assets/logos/${nom}.svg`;
      if (!e.target.dataset.retry) {
        e.target.dataset.retry = '1';
        e.target.src = svg;
      } else e.target.replaceWith(h('span', { class: 'small muted' }, `${nom} : absent`));
    },
  });
  return h(
    'div',
    { style: { border: '1px solid #d9dfe6', borderRadius: '8px', padding: '8px', minWidth: '130px', textAlign: 'center' } },
    img,
    h('div', { class: 'small muted' }, nom)
  );
}
