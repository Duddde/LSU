import { h, mount, toast } from './dom.js';
import { api, essaie, etat, chargeContexte } from './api.js';

export default async function vueParametres() {
  const s = etat.settings;

  const champs = {
    etablissement: ['Établissement', 'text'],
    gestionnaire: ['Organisme gestionnaire', 'text'],
    ville: ['Ville / adresse (pied de page)', 'text'],
    legende_vert: ['Légende du vert', 'text'],
    legende_orange: ['Légende de l’orange', 'text'],
    legende_rouge: ['Légende du rouge', 'text'],
  };
  const entrees = {};
  for (const [cle, [libelle, type]] of Object.entries(champs))
    entrees[cle] = h('input', { type, value: s[cle] || '' });
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

  return h(
    'div',
    {},
    h('h1', { class: 'titre-page' }, 'Paramètres'),
    h(
      'div',
      { class: 'carte' },
      h('header', {}, h('h2', {}, 'Établissement, légende et mentions légales')),
      h(
        'div',
        { class: 'corps' },
        h(
          'div',
          { class: 'grille' },
          Object.entries(champs).map(([cle, [libelle]]) =>
            h('label', { class: 'champ' }, h('span', {}, libelle), entrees[cle])
          )
        ),
        h('label', { class: 'champ' }, h('span', {}, 'Mentions légales imprimées en pied de livret'), entrees.mentions_legales),
        h(
          'button',
          {
            class: 'btn primaire',
            onclick: async () => {
              const payload = {};
              for (const cle of Object.keys(entrees)) payload[cle] = entrees[cle].value;
              await essaie(api.put('/api/settings', payload), 'Paramètres enregistrés');
              await chargeContexte();
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            },
          },
          'Enregistrer'
        )
      )
    ),
    h(
      'div',
      { class: 'carte' },
      h('header', {}, h('h2', {}, 'Années scolaires')),
      h(
        'div',
        { class: 'corps' },
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
      )
    ),
    h(
      'div',
      { class: 'carte' },
      h('header', {}, h('h2', {}, 'Logos du livret')),
      h(
        'div',
        { class: 'corps' },
        h(
          'p',
          {},
          'Déposez les fichiers officiels dans ',
          h('code', {}, 'public/assets/logos/'),
          ' avec ces noms exacts (png, jpg ou svg) ; ils sont alors intégrés automatiquement aux PDF :'
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
      )
    ),
    h(
      'div',
      { class: 'carte' },
      h('header', {}, h('h2', {}, 'Authentification')),
      h(
        'div',
        { class: 'corps' },
        etat.authActive
          ? h('p', {}, 'L’authentification est ', h('b', {}, 'active'), ' : chaque enseignante se connecte avec son identifiant et son mot de passe.')
          : h(
              'div',
              {},
              h('p', {}, 'L’authentification est ', h('b', {}, 'désactivée'), ' (phase de mise en route) : l’identité se choisit dans l’en-tête.'),
              h('p', { class: 'small muted' }, 'Pour l’activer, démarrer le serveur avec la variable d’environnement LSU_AUTH=1 : les comptes et les mots de passe déjà saisis sont alors utilisés, sans aucune autre modification.')
            )
      )
    )
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
