import { h, mount, modale, toast, confirme, normalise } from './dom.js';
import { api, essaie, etat, chargeReferentiel } from './api.js';
import { rechercheCompetences } from './vue-eleve.js';

const ouverts = new Set();
let filtre = '';
// Glisser-déposer : entrée en cours de déplacement, et minuterie d'ouverture
// automatique d'une catégorie repliée que l'on survole.
let drag = null;
let minuterie = null;

export default async function vueReferentiel() {
  const ref = await chargeReferentiel(true);
  const zone = h('div', {});

  const index = new Map();
  (function indexe(node, parents) {
    index.set(node.id, { node, parents });
    node.children.forEach((c) => indexe(c, [...parents, node]));
  })({ id: 0, label: '', children: ref.matieres, depth: -1 }, []);

  const ctx = { index, dessine: () => dessine() };

  function dessine() {
    const nq = normalise(filtre);
    mount(
      zone,
      ref.matieres.length
        ? ref.matieres.map((m) => noeud(m, ctx, nq))
        : h('div', { class: 'vide' }, 'Référentiel vide : ajoutez une matière ou importez un fichier ODT.')
    );
  }

  const champFiltre = h('input', {
    type: 'search',
    placeholder: 'Filtrer l’arborescence…',
    value: filtre,
    oninput: (e) => {
      filtre = e.target.value;
      if (normalise(filtre).length >= 2) {
        // Ouvre les branches contenant une correspondance.
        for (const { node, parents } of index.values())
          if (normalise(node.label).includes(normalise(filtre))) parents.forEach((p) => ouverts.add(p.id));
      }
      dessine();
    },
  });

  dessine();

  const stats = compteStats(ref.matieres);

  return h(
    'div',
    {},
    h('h1', { class: 'titre-page' }, 'Référentiel de compétences'),
    h(
      'div',
      { class: 'carte' },
      h(
        'header',
        {},
        h('div', { class: 'grow', style: { maxWidth: '320px' } }, champFiltre),
        rechercheCompetences(ref, (c) => {
          const chaine = c.path_ids.slice(0, -1);
          chaine.forEach((idn) => ouverts.add(idn));
          dessine();
          setTimeout(() => {
            const el = zone.querySelector(`[data-noeud="${c.id}"]`);
            el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            el?.querySelector('input')?.focus();
          }, 50);
        }, 'Aller à une compétence…'),
        h('div', { class: 'spacer grow' }),
        h('span', { class: 'small muted' }, `${stats.matieres} matières • ${stats.categories} catégories • ${stats.competences} compétences`),
        h('button', { class: 'btn', onclick: () => dialogueImport() }, 'Importer un ODT'),
        h(
          'button',
          {
            class: 'btn primaire',
            onclick: () => dialogueNoeud({ parent_id: null, titre: 'Nouvelle matière' }),
          },
          '+ Matière'
        )
      ),
      h(
        'div',
        { class: 'corps' },
        h(
          'p',
          { class: 'small muted', style: { marginTop: 0 } },
          'Niveaux : matière › catégorie orange › catégorie jaune › catégorie grise › compétence évaluable. ',
          'Attrapez une ligne par sa poignée ⠿ pour la déplacer : déposée sur le haut ou le bas ',
          'd’une ligne, elle se place avant ou après ; déposée au centre d’une catégorie, elle entre dedans. ',
          'Une suppression est transformée en archivage si des évaluations existent déjà.'
        ),
        zone
      )
    )
  );
}

function compteStats(matieres) {
  const s = { matieres: matieres.length, categories: 0, competences: 0 };
  const walk = (n, racine) => {
    if (!n.children.length) s.competences++;
    else {
      if (!racine) s.categories++;
      n.children.forEach((c) => walk(c, false));
    }
  };
  matieres.forEach((m) => walk(m, true));
  return s;
}

/* -------------------------- Glisser-déposer -------------------------- */

/** Efface les repères de dépôt affichés dans l'arborescence. */
function demarque() {
  document.querySelectorAll('.arbre-ligne[data-drop]').forEach((el) => delete el.dataset.drop);
}

/** La cible fait-elle partie de la branche déplacée ? */
const dansLaBranche = (source, cible) =>
  (function cherche(n) {
    return n.id === cible.id || n.children.some(cherche);
  })(source.node);

/**
 * Dépôt autorisé ? Une matière ne se dépose qu'entre deux matières ; une
 * catégorie ou une compétence uniquement à l'intérieur d'une matière.
 */
function depotAutorise(source, cible, mode) {
  if (!source || source.id === cible.id) return false;
  if (dansLaBranche(source, cible)) return false;
  const parent = mode === 'dedans' ? cible.id : cible.parent_id ?? null;
  return (parent === null) === (source.node.parent_id == null);
}

function noeud(node, ctx, nq) {
  const feuille = !node.children.length;
  const ouvert = ouverts.has(node.id);
  const correspond = !nq || normalise(node.label).includes(nq);
  const contient =
    !nq ||
    (function cherche(n) {
      return normalise(n.label).includes(nq) || n.children.some(cherche);
    })(node);
  if (!contient) return null;

  const fratrie = ctx.index.get(node.id)?.parents.at(-1)?.children || [];

  const champ = h('input', {
    type: 'text',
    value: node.label,
    class: correspond && nq ? 'surligne' : '',
    style: { background: correspond && nq ? '#fff8e1' : '' },
    onchange: async (e) => {
      const label = e.target.value.trim();
      if (!label || label === node.label) return (e.target.value = node.label);
      await essaie(api.patch(`/api/nodes/${node.id}`, { label }), 'Intitulé modifié');
      node.label = label;
    },
  });

  const cycle = feuille
    ? h('input', {
        type: 'text',
        value: node.cycle || '',
        placeholder: 'C2 - CP',
        style: { width: '92px', flex: '0 0 auto' },
        onchange: async (e) => {
          await essaie(api.patch(`/api/nodes/${node.id}`, { cycle: e.target.value }), 'Niveau modifié');
          node.cycle = e.target.value;
        },
      })
    : null;

  // Zone de dépôt : le haut insère avant, le bas après, le centre fait entrer
  // dans la ligne survolée. Une ligne sans enfant peut être une catégorie encore
  // vide : elle accepte donc aussi le dépôt à l'intérieur, mais sur une bande
  // centrale plus étroite pour ne pas imbriquer une compétence par accident.
  const modeDepot = (e) => {
    const r = ligne.getBoundingClientRect();
    const p = (e.clientY - r.top) / Math.max(r.height, 1);
    const bande = feuille ? 0.42 : 0.3;
    return p < bande ? 'avant' : p > 1 - bande ? 'apres' : 'dedans';
  };

  const annuleOuverture = () => {
    clearTimeout(minuterie);
    minuterie = null;
  };

  const poignee = h(
    'button',
    {
      class: 'poignee',
      type: 'button',
      draggable: true,
      title: 'Glisser-déposer pour déplacer — ou Alt + ↑ / Alt + ↓ au clavier',
      'aria-label': `Déplacer « ${node.label} »`,
      ondragstart: (e) => {
        drag = { id: node.id, node };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', node.label);
        try {
          e.dataTransfer.setDragImage(ligne, 16, 14);
        } catch {}
        document.body.classList.add('glisse');
        ligne.classList.add('source');
      },
      ondragend: () => {
        drag = null;
        annuleOuverture();
        document.body.classList.remove('glisse');
        ligne.classList.remove('source');
        demarque();
      },
      onkeydown: (e) => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          deplace(node, e.key === 'ArrowUp' ? 'up' : 'down');
        }
      },
    },
    '⠿'
  );

  const ligne = h(
    'div',
    {
      class: 'arbre-ligne',
      dataset: { noeud: node.id },
      ondragover: (e) => {
        if (!drag) return;
        const mode = modeDepot(e);
        if (!depotAutorise(drag, node, mode)) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (ligne.dataset.drop !== mode) {
          demarque();
          ligne.dataset.drop = mode;
        }
        // Survol prolongé d'une catégorie repliée : on la déplie.
        if (mode === 'dedans' && !ouverts.has(node.id)) {
          if (!minuterie)
            minuterie = setTimeout(() => {
              minuterie = null;
              ouverts.add(node.id);
              ctx.dessine();
            }, 650);
        } else annuleOuverture();
      },
      ondragleave: () => {
        delete ligne.dataset.drop;
        annuleOuverture();
      },
      ondrop: async (e) => {
        e.preventDefault();
        annuleOuverture();
        const source = drag;
        const mode = modeDepot(e);
        const autorise = depotAutorise(source, node, mode);
        drag = null;
        demarque();
        document.body.classList.remove('glisse');
        if (!autorise) return;

        let parent_id = null;
        let before_id = null;
        if (mode === 'dedans') parent_id = node.id;
        else {
          parent_id = node.parent_id ?? null;
          // Rang visé dans la fratrie de la cible, en sautant l'entrée déplacée
          // si elle s'y trouve déjà.
          let j = fratrie.indexOf(node) + (mode === 'apres' ? 1 : 0);
          while (fratrie[j] && fratrie[j].id === source.id) j++;
          before_id = fratrie[j]?.id ?? null;
        }
        try {
          await essaie(
            api.post(`/api/nodes/${source.id}/move`, { parent_id, before_id }),
            `« ${source.node.label} » déplacé`
          );
        } catch {
          return;
        }
        if (parent_id) ouverts.add(parent_id);
        await recharge();
      },
    },
    poignee,
    feuille
      ? h('span', { style: { width: '18px', textAlign: 'center', color: '#9aa2ab' } }, '•')
      : h(
          'button',
          {
            class: 'chevron',
            title: ouvert ? 'Replier' : 'Déplier',
            onclick: () => {
              ouvert ? ouverts.delete(node.id) : ouverts.add(node.id);
              ctx.dessine();
            },
          },
          ouvert ? '▾' : '▸'
        ),
    h('span', { class: 'bandeau-niveau', style: { background: ['#1c2127', '#f0a24a', '#ddc64f', '#b6bcc4'][Math.min(node.depth, 3)] } }),
    h('span', { class: 'lab grow' }, champ),
    cycle,
    !feuille ? h('span', { class: 'small muted', style: { whiteSpace: 'nowrap' } }, `${node.children.length} entrée(s)`) : null,
    node.hors_pdf ? h('span', { class: 'tag-horspdf' }, 'hors PDF') : null,
    h(
      'div',
      { class: 'row', style: { gap: '4px' } },
      h(
        'button',
        {
          class: 'btn mini',
          title: 'Ajouter une sous-entrée',
          onclick: () => dialogueNoeud({ parent_id: node.id, titre: `Ajouter sous « ${node.label} »` }),
        },
        '+'
      ),
      h('button', { class: 'btn mini', title: 'Options', onclick: () => dialogueOptions(node) }, '⋯'),
      h('button', { class: 'btn mini danger', title: 'Supprimer', onclick: () => supprime(node) }, '×')
    )
  );

  return h(
    'div',
    { class: 'pliable' },
    ligne,
    !feuille && (ouvert || nq)
      ? h('div', { class: 'arbre-enfants' }, node.children.map((c) => noeud(c, ctx, nq)))
      : null
  );
}

/** Recharge le référentiel et redessine la vue. */
async function recharge() {
  await chargeReferentiel(true);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Déplacement au clavier dans la fratrie (Alt + ↑ / ↓ sur la poignée). */
async function deplace(node, direction) {
  try {
    await essaie(api.post(`/api/nodes/${node.id}/move`, { direction }));
  } catch {
    return;
  }
  await recharge();
  setTimeout(() => document.querySelector(`[data-noeud="${node.id}"] .poignee`)?.focus(), 80);
}

function dialogueNoeud({ parent_id, titre }) {
  const label = h('input', { type: 'text', placeholder: 'Intitulé' });
  const cycle = h('input', { type: 'text', placeholder: 'ex. C2 - CE1 (facultatif)' });
  const multi = h('textarea', { placeholder: "Une ligne = une entrée (pour en créer plusieurs d'un coup)" });

  const { fermer } = modale({
    titre,
    corps: h(
      'div',
      {},
      h('label', { class: 'champ' }, h('span', {}, 'Intitulé'), label),
      h('label', { class: 'champ' }, h('span', {}, 'Niveau / cycle'), cycle),
      h('label', { class: 'champ' }, h('span', {}, 'Ou saisie en lot'), multi)
    ),
    actions: [
      h('button', { class: 'btn', onclick: () => fermer() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primaire',
          onclick: async () => {
            const lots = multi.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            const intitules = lots.length ? lots : [label.value.trim()].filter(Boolean);
            if (!intitules.length) return toast('Saisissez au moins un intitulé', 'err');
            for (const l of intitules)
              await essaie(api.post('/api/nodes', { parent_id, label: l, cycle: cycle.value }));
            toast(`${intitules.length} entrée(s) ajoutée(s)`, 'ok');
            fermer();
            if (parent_id) ouverts.add(parent_id);
            await recharge();
          },
        },
        'Ajouter'
      ),
    ],
  });
}

function dialogueOptions(node) {
  const hors = h('input', { type: 'checkbox', checked: node.hors_pdf });
  const archive = h('input', { type: 'checkbox', checked: node.archive });
  const { fermer } = modale({
    titre: `Options — ${node.label}`,
    corps: h(
      'div',
      {},
      h('label', { class: 'inline-check', style: { display: 'flex', marginBottom: '10px' } }, hors, 'Suivi interne : ne pas faire figurer dans le PDF (s’applique à toute la branche)'),
      h('label', { class: 'inline-check', style: { display: 'flex' } }, archive, 'Archivé (masqué de la saisie, conservé dans les livrets déjà remplis)')
    ),
    actions: [
      h('button', { class: 'btn', onclick: () => fermer() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primaire',
          onclick: async () => {
            await essaie(
              api.patch(`/api/nodes/${node.id}`, { hors_pdf: hors.checked, archive: archive.checked }),
              'Options enregistrées'
            );
            fermer();
            await recharge();
          },
        },
        'Enregistrer'
      ),
    ],
  });
}

async function supprime(node) {
  const nb = (function compte(n) {
    return n.children.length ? n.children.reduce((s, c) => s + compte(c), 0) : 1;
  })(node);
  if (
    !(await confirme(
      `Supprimer « ${node.label} » ${node.children.length ? `et ses ${nb} compétence(s)` : ''} ?\n` +
        'Si des évaluations existent, la branche sera archivée au lieu d’être supprimée.',
      { libelle: 'Supprimer' }
    ))
  )
    return;
  const r = await essaie(api.del(`/api/nodes/${node.id}`));
  toast(
    r.archive
      ? `Branche archivée : ${r.evaluations} évaluation(s) la référencent.`
      : 'Entrée supprimée.',
    'ok'
  );
  await recharge();
}

function dialogueImport() {
  const fichier = h('input', { type: 'file', accept: '.odt' });
  const matiere = h('input', { type: 'text', placeholder: 'ex. Français' });
  const hors = h('input', { type: 'checkbox' });

  const { fermer } = modale({
    titre: 'Importer un référentiel (.odt)',
    corps: h(
      'div',
      {},
      h(
        'p',
        { class: 'small muted', style: { marginTop: 0 } },
        'Format attendu : le tableau du document « Récap programmes », où la hiérarchie est portée par les couleurs de fond (orange, jaune, gris) et où chaque compétence est précédée de son niveau (C1 - PS, C2 - CP, C3 - 6ème…).'
      ),
      h('label', { class: 'champ' }, h('span', {}, 'Fichier ODT'), fichier),
      h('label', { class: 'champ' }, h('span', {}, 'Nom de la matière'), matiere),
      h('label', { class: 'inline-check' }, hors, 'Suivi interne (hors PDF)')
    ),
    actions: [
      h('button', { class: 'btn', onclick: () => fermer() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primaire',
          onclick: async () => {
            if (!fichier.files[0]) return toast('Sélectionnez un fichier .odt', 'err');
            const fd = new FormData();
            fd.append('fichier', fichier.files[0]);
            if (matiere.value.trim()) fd.append('matiere', matiere.value.trim());
            if (hors.checked) fd.append('hors_pdf', '1');
            const r = await essaie(api.post('/api/referentiel/import', fd));
            toast(`« ${r.matiere} » importé : ${r.entrees} entrées`, 'ok');
            fermer();
            await recharge();
          },
        },
        'Importer'
      ),
    ],
  });
}
