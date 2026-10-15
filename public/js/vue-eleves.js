import { h, mount, modale, toast, normalise, frDate, age, initiales, confirme } from './dom.js';
import { api, essaie, etat, chargeEleves } from './api.js';
import { navigue } from './app.js';

const prefs = {
  q: '',
  mine: false,
  tri: 'nom',
  sens: 1,
  archives: false,
};

export default async function vueEleves() {
  const eleves = await chargeEleves();

  const recherche = h('input', {
    type: 'search',
    placeholder: 'Rechercher un élève (nom, prénom)…',
    value: prefs.q,
    oninput: (e) => {
      prefs.q = e.target.value;
      rafraichis();
    },
  });

  const corps = h('tbody');
  const compteur = h('span', { class: 'muted small' });

  const checkMine = h('input', {
    type: 'checkbox',
    checked: prefs.mine,
    onchange: (e) => {
      prefs.mine = e.target.checked;
      rafraichis();
    },
  });
  const checkArchives = h('input', {
    type: 'checkbox',
    checked: prefs.archives,
    onchange: (e) => {
      prefs.archives = e.target.checked;
      rafraichis();
    },
  });

  const entete = (cle, libelle) =>
    h(
      'th',
      {
        class: 'tri',
        onclick: () => {
          prefs.sens = prefs.tri === cle ? -prefs.sens : 1;
          prefs.tri = cle;
          rafraichis();
        },
      },
      libelle,
      prefs.tri === cle ? (prefs.sens > 0 ? ' ▲' : ' ▼') : ''
    );

  function rafraichis() {
    const nq = normalise(prefs.q).split(/\s+/).filter(Boolean);
    let liste = eleves.filter((e) => {
      if (!prefs.archives && e.archive) return false;
      if (prefs.mine && !e.enseignantes.some((t) => t.id === etat.user?.id)) return false;
      if (!nq.length) return true;
      const champ = normalise(`${e.nom} ${e.prenom}`);
      return nq.every((mot) => champ.includes(mot));
    });
    const cmp = {
      nom: (a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr'),
      prenom: (a, b) => `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, 'fr'),
      naissance: (a, b) => String(a.date_naissance || '').localeCompare(String(b.date_naissance || '')),
      classe: (a, b) => String(a.classe || '').localeCompare(String(b.classe || ''), 'fr'),
    }[prefs.tri];
    liste = liste.sort((a, b) => cmp(a, b) * prefs.sens);

    mount(compteur, `${liste.length} élève${liste.length > 1 ? 's' : ''} sur ${eleves.length}`);
    mount(
      corps,
      liste.length
        ? liste.map((e) => ligneEleve(e))
        : h('tr', {}, h('td', { colspan: 6, class: 'vide' }, 'Aucun élève ne correspond à cette recherche.'))
    );
  }

  rafraichis();

  return h(
    'div',
    {},
    h('h1', { class: 'titre-page' }, 'Élèves'),
    h(
      'div',
      { class: 'carte' },
      h(
        'header',
        {},
        h('div', { class: 'grow', style: { maxWidth: '420px' } }, recherche),
        h('label', { class: 'inline-check' }, checkMine, 'Mes élèves uniquement'),
        h('label', { class: 'inline-check' }, checkArchives, 'Inclure les élèves archivés'),
        h('div', { class: 'spacer grow' }),
        compteur,
        h('button', { class: 'btn primaire', onclick: () => formulaireEleve() }, '+ Ajouter un élève')
      ),
      h(
        'div',
        { class: 'corps', style: { paddingTop: '4px' } },
        h(
          'table',
          { class: 'liste' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, ''),
              entete('nom', 'Nom'),
              entete('prenom', 'Prénom'),
              entete('naissance', 'Naissance'),
              entete('classe', 'Groupe'),
              h('th', {}, 'Enseignante(s)'),
              h('th', {}, 'Suivi'),
              h('th', {}, '')
            )
          ),
          corps
        )
      )
    )
  );
}

function ligneEleve(e) {
  const a = age(e.date_naissance);
  return h(
    'tr',
    { class: 'clic', onclick: () => navigue(`/eleve/${e.id}`) },
    h('td', {}, h('span', { class: 'avatar' }, initiales(e.prenom, e.nom))),
    h('td', {}, h('b', {}, e.nom), e.archive ? h('span', { class: 'pastille' }, 'archivé') : null),
    h('td', {}, e.prenom),
    h('td', { class: 'small' }, frDate(e.date_naissance) || '—', a != null ? h('span', { class: 'muted' }, ` (${a} ans)`) : null),
    h('td', { class: 'small' }, e.classe || '—'),
    h(
      'td',
      {},
      e.enseignantes.length
        ? e.enseignantes.map((t) =>
            h('span', { class: `pastille ${t.id === etat.user?.id ? 'moi' : ''}` }, `${t.prenom} ${t.nom}`)
          )
        : h('span', { class: 'muted small' }, 'non rattaché')
    ),
    h('td', { class: 'small muted' }, `${e.nb_evals} éval.`),
    h(
      'td',
      {},
      h(
        'button',
        {
          class: 'btn mini',
          title: 'Rattacher à une ou plusieurs enseignantes',
          onclick: (ev) => {
            ev.stopPropagation();
            formulaireRattachement(e);
          },
        },
        'Rattacher'
      )
    )
  );
}

/* ----------------------- Ajout / modification ------------------------ */

export function formulaireEleve(eleve = null, apres) {
  const prenom = h('input', { type: 'text', value: eleve?.prenom || '', required: true });
  const nom = h('input', { type: 'text', value: eleve?.nom || '', required: true });
  const naissance = h('input', { type: 'date', value: eleve?.date_naissance || '' });
  const classe = h('input', { type: 'text', value: eleve?.classe || '', placeholder: 'ex. Groupe 2' });
  const entree = h('input', { type: 'date', value: eleve?.date_entree || '' });
  const rattacher = h('input', { type: 'checkbox', checked: true });
  const archive = h('input', { type: 'checkbox', checked: !!eleve?.archive });

  const { fermer } = modale({
    titre: eleve ? `Modifier ${eleve.prenom} ${eleve.nom}` : 'Nouvel élève',
    corps: h(
      'div',
      {},
      h(
        'div',
        { class: 'grille' },
        h('label', { class: 'champ' }, h('span', {}, 'Prénom *'), prenom),
        h('label', { class: 'champ' }, h('span', {}, 'Nom *'), nom),
        h('label', { class: 'champ' }, h('span', {}, 'Date de naissance'), naissance),
        h('label', { class: 'champ' }, h('span', {}, 'Groupe'), classe),
        h('label', { class: 'champ' }, h('span', {}, "Date d'entrée dans l'établissement"), entree)
      ),
      eleve
        ? h('label', { class: 'inline-check' }, archive, 'Élève archivé (sorti de l’établissement)')
        : h('label', { class: 'inline-check' }, rattacher, 'Me rattacher à cet élève')
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
              prenom: prenom.value,
              nom: nom.value,
              date_naissance: naissance.value || null,
              classe: classe.value,
              date_entree: entree.value || null,
            };
            if (eleve) {
              corps.archive = archive.checked;
              await essaie(api.patch(`/api/students/${eleve.id}`, corps), 'Élève mis à jour');
            } else {
              corps.rattacher = rattacher.checked;
              await essaie(api.post('/api/students', corps), 'Élève ajouté');
            }
            fermer();
            await chargeEleves(true);
            apres ? apres() : location.hash === '#/eleves' ? recharge() : navigue('/eleves');
          },
        },
        'Enregistrer'
      ),
    ],
  });
}

export function formulaireRattachement(eleve, apres) {
  const cases = etat.teachers
    .filter((t) => t.actif)
    .map((t) => {
      const input = h('input', {
        type: 'checkbox',
        value: t.id,
        checked: eleve.enseignantes.some((x) => x.id === t.id),
      });
      return { t, input, el: h('label', { class: 'inline-check', style: { display: 'flex', padding: '4px 0' } }, input, `${t.civilite} ${t.prenom} ${t.nom}`) };
    });

  const { fermer } = modale({
    titre: `Rattacher ${eleve.prenom} ${eleve.nom}`,
    corps: h(
      'div',
      {},
      h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Toutes les enseignantes voient tous les élèves ; le rattachement alimente le filtre « mes élèves » et le livret imprimé.'),
      cases.map((c) => c.el)
    ),
    actions: [
      h('button', { class: 'btn', onclick: () => fermer() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primaire',
          onclick: async () => {
            const ids = cases.filter((c) => c.input.checked).map((c) => c.t.id);
            await essaie(api.put(`/api/students/${eleve.id}/teachers`, { teacher_ids: ids }), 'Rattachement enregistré');
            fermer();
            await chargeEleves(true);
            apres ? apres() : recharge();
          },
        },
        'Enregistrer'
      ),
    ],
  });
}

export async function supprimeEleve(eleve) {
  if (!(await confirme(`Supprimer définitivement ${eleve.prenom} ${eleve.nom} ?\nToutes ses évaluations et ses documents seront perdus.`, { libelle: 'Supprimer' })))
    return false;
  await essaie(api.del(`/api/students/${eleve.id}`), 'Élève supprimé');
  await chargeEleves(true);
  return true;
}

function recharge() {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
