import { h, mount, modale, toast, confirme, initiales } from './dom.js';
import { api, essaie, etat, chargeContexte } from './api.js';

export default async function vueEnseignantes() {
  const teachers = await api.get('/api/teachers');
  const corps = h('tbody');

  function dessine() {
    mount(
      corps,
      teachers.map((t) =>
        h(
          'tr',
          { style: t.actif ? {} : { opacity: '.55' } },
          h(
            'td',
            {},
            h(
              'div',
              { class: 'row', style: { gap: '12px', flexWrap: 'nowrap' } },
              h('span', { class: 'avatar', style: { background: 'var(--line-2)', color: 'var(--ink-2)' } }, initiales(t.prenom, t.nom)),
              h('span', { style: { fontWeight: '500' } }, `${t.civilite} ${t.prenom} ${t.nom}`)
            )
          ),
          h('td', {}, h('span', { class: 'mono muted' }, t.email)),
          h('td', {}, t.role === 'admin' ? h('span', { class: 'pastille moi' }, 'administratrice') : h('span', { class: 'pastille' }, 'enseignante')),
          h('td', { class: 'small' }, `${t.nb_eleves} élève${t.nb_eleves > 1 ? 's' : ''}`),
          h('td', {}, t.actif ? '' : h('span', { class: 'pastille' }, 'compte désactivé')),
          h(
            'td',
            { style: { textAlign: 'right' } },
            h('button', { class: 'btn mini', onclick: () => formulaire(t) }, 'Modifier'),
            t.actif
              ? h(
                  'button',
                  {
                    class: 'btn mini danger',
                    onclick: async () => {
                      if (!(await confirme(`Désactiver le compte de ${t.prenom} ${t.nom} ?\nSes élèves et ses saisies sont conservés.`, { libelle: 'Désactiver' })))
                        return;
                      await essaie(api.del(`/api/teachers/${t.id}`), 'Compte désactivé');
                      recharge();
                    },
                  },
                  'Désactiver'
                )
              : h(
                  'button',
                  {
                    class: 'btn mini',
                    onclick: async () => {
                      await essaie(api.patch(`/api/teachers/${t.id}`, { actif: true }), 'Compte réactivé');
                      recharge();
                    },
                  },
                  'Réactiver'
                )
          )
        )
      )
    );
  }
  dessine();

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-tete' },
      h('div', { class: 'titres' }, h('h1', {}, 'Enseignantes')),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primaire', onclick: () => formulaire() }, '+ Ajouter une enseignante')
      )
    ),
    !etat.authActive
      ? h(
          'div',
          { class: 'bandeau-info' },
          h('b', {}, 'Authentification désactivée'),
          ' Chacune choisit son identité dans l’en-tête et tout le monde a tous les droits. ',
          'Les comptes créés ici seront prêts quand l’authentification sera activée (LSU_AUTH=1).'
        )
      : null,
    h(
      'div',
      { class: 'carte' },
      h(
        'div',
        { class: 'corps', style: { padding: '4px 0 0' } },
        h(
          'table',
          { class: 'liste' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Nom'), h('th', {}, 'Identifiant'), h('th', {}, 'Rôle'), h('th', {}, 'Élèves'), h('th', {}, ''), h('th', {}, ''))),
          corps
        )
      )
    )
  );
}

function formulaire(t = null) {
  const civilite = h('select', {}, ['Mme', 'M.'].map((c) => h('option', { value: c, selected: t?.civilite === c }, c)));
  const prenom = h('input', { type: 'text', value: t?.prenom || '' });
  const nom = h('input', { type: 'text', value: t?.nom || '' });
  const email = h('input', { type: 'text', value: t?.email || '', placeholder: 'prenom.nom@local' });
  const role = h(
    'select',
    {},
    h('option', { value: 'enseignant', selected: t?.role !== 'admin' }, 'Enseignante'),
    h('option', { value: 'admin', selected: t?.role === 'admin' }, 'Administratrice (gère les comptes et les paramètres)')
  );
  const mdp = h('input', { type: 'password', placeholder: t ? 'Laisser vide pour ne pas changer' : '8 caractères minimum' });

  const { fermer } = modale({
    titre: t ? `Modifier ${t.prenom} ${t.nom}` : 'Nouvelle enseignante',
    corps: h(
      'div',
      {},
      h(
        'div',
        { class: 'grille' },
        h('label', { class: 'champ' }, h('span', {}, 'Civilité'), civilite),
        h('label', { class: 'champ' }, h('span', {}, 'Prénom *'), prenom),
        h('label', { class: 'champ' }, h('span', {}, 'Nom *'), nom),
        h('label', { class: 'champ' }, h('span', {}, 'Identifiant de connexion'), email),
        h('label', { class: 'champ' }, h('span', {}, 'Rôle'), role),
        h('label', { class: 'champ' }, h('span', {}, 'Mot de passe'), mdp)
      ),
      !etat.authActive
        ? h('p', { class: 'small muted' }, 'Identifiant et mot de passe sont facultatifs tant que l’authentification n’est pas activée.')
        : null
    ),
    actions: [
      h('button', { class: 'btn', onclick: () => fermer() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primaire',
          onclick: async () => {
            if (!prenom.value.trim() || !nom.value.trim()) return toast('Nom et prénom obligatoires', 'err');
            const corps = {
              civilite: civilite.value,
              prenom: prenom.value,
              nom: nom.value,
              email: email.value,
              role: role.value,
            };
            if (mdp.value) corps.password = mdp.value;
            if (t) await essaie(api.patch(`/api/teachers/${t.id}`, corps), 'Compte mis à jour');
            else await essaie(api.post('/api/teachers', corps), 'Enseignante ajoutée');
            fermer();
            recharge();
          },
        },
        'Enregistrer'
      ),
    ],
  });
}

async function recharge() {
  await chargeContexte();
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
