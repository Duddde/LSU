import {
  h, mount, clear, modale, toast, confirme, normalise, surligne, frDate, frDateHeure,
  age, initiales, taille, debounce,
} from './dom.js';
import { api, essaie, etat, chargeReferentiel, chargeEleves } from './api.js';
import { navigue } from './app.js';
import { formulaireEleve, formulaireRattachement, supprimeEleve } from './vue-eleves.js';

const NIVEAUX = [
  { cle: 'vert', classe: 'v', libelle: 'Réalisé seul', court: 'Seul' },
  { cle: 'orange', classe: 'o', libelle: 'Réalisé avec aide', court: 'Avec aide' },
  { cle: 'rouge', classe: 'r', libelle: "Réalisé avec beaucoup d'aide", court: "Beaucoup d'aide" },
  { cle: null, classe: 'x', libelle: 'Non évalué', court: 'Non évalué' },
];

/** Libellé d'un niveau : celui des paramètres s'il a été personnalisé. */
const libelleNiveau = (n) => (n.cle && etat.settings?.[`legende_${n.cle}`]) || n.libelle;

/** Mémorise l'onglet et le chemin d'arborescence entre deux rendus. */
const vuePrefs = { onglet: 'evaluation', chemin: {}, cible: null };

export default async function vueEleve(idStr) {
  const id = Number(idStr);
  const [eleve, ref, data] = await Promise.all([
    api.get(`/api/students/${id}`),
    chargeReferentiel(),
    api.get(`/api/students/${id}/evaluations?year=${etat.year.id}`),
  ]);

  const ctx = {
    eleve,
    ref,
    evaluations: data.evaluations,
    evolution: data.evolution,
    year: data.year,
  };

  const contenu = h('div', {});
  const onglets = h('div', { class: 'onglets' });

  const TABS = [
    ['evaluation', 'Évaluation des compétences'],
    ['recap', 'Récapitulatif & progression'],
    ['dossier', 'Dossier de l’élève'],
    ['identite', 'Identité & commentaires'],
  ];

  function afficheOnglet(cle) {
    vuePrefs.onglet = cle;
    mount(
      onglets,
      TABS.map(([k, lib]) =>
        h('button', { class: k === cle ? 'actif' : '', onclick: () => afficheOnglet(k) }, lib)
      )
    );
    const rendus = {
      evaluation: () => ongletEvaluation(ctx),
      recap: () => ongletRecap(ctx),
      dossier: () => ongletDossier(ctx),
      identite: () => ongletIdentite(ctx),
    };
    mount(contenu, rendus[cle]());
  }

  afficheOnglet(vuePrefs.onglet);

  return h('div', {}, enteteFiche(ctx), onglets, h('div', { style: { marginTop: '16px' } }, contenu));
}

/* ----------------------------- En-tête ------------------------------- */

function enteteFiche({ eleve, year }) {
  const a = age(eleve.date_naissance);
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'fil' },
      h('button', { onclick: () => navigue('/eleves') }, 'Élèves'),
      h('span', { class: 'sep' }, '/'),
      h('span', { class: 'courant' }, `${eleve.prenom} ${eleve.nom}`)
    ),
    h(
      'div',
      { class: 'fiche-entete' },
      h('span', { class: 'avatar' }, initiales(eleve.prenom, eleve.nom)),
      h(
        'div',
        { class: 'grow' },
        h('h1', {}, `${eleve.prenom} ${eleve.nom}`),
        h(
          'div',
          { class: 'small muted' },
          [
            eleve.date_naissance ? `Né(e) le ${frDate(eleve.date_naissance)}${a != null ? ` · ${a} ans` : ''}` : 'Date de naissance non renseignée',
            eleve.classe ? `Groupe ${eleve.classe}` : null,
            `Année ${year.libelle}`,
          ]
            .filter(Boolean)
            .join(' · ')
        ),
        h(
          'div',
          { style: { marginTop: '6px' } },
          eleve.enseignantes.length
            ? eleve.enseignantes.map((t) =>
                h('span', { class: `pastille ${t.id === etat.user?.id ? 'moi' : ''}` }, `${t.prenom} ${t.nom}`)
              )
            : h('span', { class: 'muted small' }, 'Aucune enseignante rattachée'),
          eleve.archive ? h('span', { class: 'pastille' }, 'archivé') : null
        )
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onclick: () => formulaireEleve(eleve, recharge) }, 'Modifier'),
        h('button', { class: 'btn primaire', onclick: () => dialogueImpression(eleve) }, 'Générer le PDF')
      )
    )
  );
}

/* ------------------------- Onglet évaluation ------------------------- */

function ongletEvaluation(ctx) {
  const { ref, eleve } = ctx;
  const racine = { id: 0, label: 'Matières', children: ref.matieres, depth: -1 };
  const index = new Map();
  (function indexe(node, parents) {
    index.set(node.id, { node, parents });
    node.children.forEach((c) => indexe(c, [...parents, node]));
  })(racine, []);

  const stats = calculeStats(racine, ctx.evaluations);

  const zone = h('div', {});
  let chemin = (vuePrefs.chemin[eleve.id] || []).filter((idn) => index.has(idn));

  function ouvre(ids, cible = null) {
    chemin = ids;
    vuePrefs.chemin[eleve.id] = ids;
    vuePrefs.cible = cible;
    dessine();
  }

  function dessine() {
    const courantId = chemin.length ? chemin[chemin.length - 1] : 0;
    const { node } = index.get(courantId) || { node: racine };
    const categories = node.children.filter((c) => c.children.length);
    const feuilles = node.children.filter((c) => !c.children.length);

    mount(
      zone,
      filAriane(),
      node.hors_pdf
        ? h('div', { class: 'bandeau-info' }, 'Cette rubrique est suivie en interne mais ne figure pas dans le PDF transmis à la famille.')
        : null,
      categories.length
        ? h(
            'div',
            { class: 'cat-liste' },
            categories.map((c) => carteCategorie(c, stats.get(c.id), () => ouvre([...chemin, c.id])))
          )
        : null,
      feuilles.length
        ? h(
            'div',
            { style: { marginTop: categories.length ? '18px' : '0' } },
            h(
              'div',
              { class: 'comp-tete row' },
              h('span', { class: 'grow' }, categories.length ? 'Compétences de cette catégorie' : node.label),
              h('span', { class: 'mono muted' }, `${compteEvaluees(feuilles, ctx.evaluations)} / ${feuilles.length} évaluées`)
            ),
            feuilles.map((f) => ligneCompetence(f, ctx, node))
          )
        : null,
      !categories.length && !feuilles.length ? h('div', { class: 'vide' }, 'Cette catégorie est vide. Ajoutez des compétences depuis l’onglet Référentiel.') : null
    );

    if (vuePrefs.cible) {
      const el = zone.querySelector(`[data-comp="${vuePrefs.cible}"]`);
      if (el) {
        el.classList.add('cible');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(() => el.classList.remove('cible'), 2600);
      }
      vuePrefs.cible = null;
    }
  }

  function filAriane() {
    const el = h('div', { class: 'fil' });
    const etapes = [racine, ...chemin.map((idn) => index.get(idn).node)];
    etapes.forEach((n, i) => {
      const dernier = i === etapes.length - 1;
      el.append(
        dernier
          ? h('span', { class: 'courant' }, n.label)
          : h('button', { onclick: () => ouvre(chemin.slice(0, i)) }, n.label)
      );
      if (!dernier) el.append(h('span', { class: 'sep' }, '›'));
    });
    return el;
  }

  const barre = h(
    'header',
    {},
    rechercheCompetences(ref, (comp) => {
      ouvre(comp.path_ids.slice(0, -1).filter((x) => index.has(x)), comp.id);
    }),
    h('div', { class: 'spacer grow' }),
    legende()
  );

  dessine();
  return h('div', { class: 'carte' }, barre, h('div', { class: 'corps' }, zone));
}

function calculeStats(racine, evaluations) {
  const stats = new Map();
  (function compte(node) {
    const s = { feuilles: 0, vert: 0, orange: 0, rouge: 0, evaluees: 0 };
    if (!node.children.length) {
      s.feuilles = 1;
      const niv = evaluations[node.id]?.niveau;
      if (niv) {
        s[niv]++;
        s.evaluees++;
      }
    } else
      for (const c of node.children) {
        const sc = compte(c);
        s.feuilles += sc.feuilles;
        s.vert += sc.vert;
        s.orange += sc.orange;
        s.rouge += sc.rouge;
        s.evaluees += sc.evaluees;
      }
    stats.set(node.id, s);
    return s;
  })(racine);
  return stats;
}

function carteCategorie(node, s = { feuilles: 0, evaluees: 0 }, onclick) {
  const pct = (v) => (s.evaluees ? (v / s.evaluees) * 100 : 0);
  return h(
    'button',
    { class: `cat n${Math.min(node.depth, 3)}`, onclick },
    h('span', { class: 'lab' }, node.label, node.hors_pdf ? h('span', { class: 'tag-horspdf', style: { marginLeft: '8px' } }, 'hors PDF') : null),
    s.evaluees
      ? h(
          'span',
          { class: 'jauge', title: `${s.vert} acquis, ${s.orange} en cours, ${s.rouge} non acquis` },
          h('span', { class: 'v', style: { width: pct(s.vert) + '%' } }),
          h('span', { class: 'o', style: { width: pct(s.orange) + '%' } }),
          h('span', { class: 'r', style: { width: pct(s.rouge) + '%' } })
        )
      : null,
    h('span', { class: 'compteur' }, `${s.evaluees}/${s.feuilles}`),
    h('span', { class: 'muted' }, '›')
  );
}

function ligneCompetence(node, ctx, parent) {
  const courant = ctx.evaluations[node.id] || { niveau: null, commentaire: '' };
  const meta = h('div', { class: 'meta' });
  const commentaire = h('textarea', {
    class: 'commentaire-competence',
    placeholder: 'Commentaire (facultatif)…',
    'aria-label': `Commentaire pour ${node.label}`,
    rows: 1,
    value: courant.commentaire || '',
  });

  const SEGMENTS = NIVEAUX.filter((n) => n.cle);
  const boutons = SEGMENTS.map((n) =>
    h(
      'button',
      {
        class: `${n.classe} ${courant.niveau === n.cle ? 'on' : ''}`,
        title: `${libelleNiveau(n)} — recliquer pour revenir à « non évalué »`,
        'aria-label': libelleNiveau(n),
        onclick: () => choisir(n.cle),
      },
      h('i'),
      n.court
    )
  );

  function majMeta() {
    mount(
      meta,
      courant.updated_at
        ? `Saisi le ${frDateHeure(courant.updated_at)}${courant.par ? ` par ${courant.par}` : ''}`
        : h('span', { class: 'muted' }, 'Pas encore évaluée cette année')
    );
  }

  async function enregistre() {
    const r = await essaie(
      api.put(`/api/students/${ctx.eleve.id}/evaluations/${node.id}`, {
        year_id: ctx.year.id,
        niveau: courant.niveau,
        commentaire: commentaire.value,
      })
    );
    courant.commentaire = commentaire.value;
    courant.updated_at = new Date().toISOString();
    courant.par = etat.user ? `${etat.user.prenom} ${etat.user.nom}` : null;
    ctx.evaluations[node.id] = courant;
    if (courant.niveau) {
      const serie = (ctx.evolution[node.id] ||= []);
      const dejaLa = serie.find((x) => x.annee === ctx.year.libelle);
      if (dejaLa) dejaLa.niveau = courant.niveau;
      else serie.push({ annee: ctx.year.libelle, niveau: courant.niveau });
    } else ctx.evolution[node.id] = (ctx.evolution[node.id] || []).filter((x) => x.annee !== ctx.year.libelle);
    majMeta();
    return r;
  }

  function choisir(cle) {
    courant.niveau = courant.niveau === cle ? null : cle;
    boutons.forEach((b, i) => b.classList.toggle('on', SEGMENTS[i].cle === courant.niveau));
    enregistre();
  }

  const sauveTexte = debounce(() => enregistre(), 800);
  commentaire.addEventListener('input', sauveTexte);
  commentaire.addEventListener('blur', () => sauveTexte.flush());

  majMeta();

  return h(
    'div',
    { class: 'comp', dataset: { comp: node.id } },
    h(
      'div',
      { class: 'haut' },
      h(
        'div',
        { class: 'intitule' },
        h('span', {}, node.label),
        h(
          'div',
          { class: 'bas' },
          node.cycle ? h('span', { class: 'cycle' }, node.cycle) : null,
          evolutionBadge(ctx.evolution[node.id], ctx.year.libelle)
        )
      ),
      commentaire,
      h('div', { class: 'niveaux' }, boutons)
    ),
    meta
  );
}

/** Nombre de compétences déjà évaluées parmi une liste de feuilles. */
function compteEvaluees(feuilles, evaluations) {
  return feuilles.filter((f) => evaluations[f.id]?.niveau).length;
}

function evolutionBadge(serie, anneeCourante) {
  if (!serie?.length) return null;
  return h(
    'span',
    { class: 'evolution', title: serie.map((s) => `${s.annee} : ${s.niveau}`).join('  |  ') },
    h('b', {}, 'évolution :'),
    serie.map((s) =>
      h('i', { class: s.niveau, style: s.annee === anneeCourante ? { outline: '2px solid #1c2127' } : {} })
    )
  );
}

function legende() {
  return h(
    'div',
    { class: 'legende' },
    NIVEAUX.filter((n) => n.cle).map((n) => h('span', {}, h('i', { class: n.cle }), libelleNiveau(n))),
    h('span', {}, h('i', { class: 'nc' }), 'Non évalué')
  );
}

/* --------------------- Recherche + autocomplétion -------------------- */

export function rechercheCompetences(ref, onChoix, placeholder = 'Rechercher une compétence…') {
  const input = h('input', { type: 'search', placeholder, autocomplete: 'off' });
  const liste = h('div', { class: 'suggestions', hidden: true });
  let resultats = [];
  let actif = -1;

  const ferme = () => {
    liste.hidden = true;
    actif = -1;
  };

  function cherche() {
    const q = input.value.trim();
    if (q.length < 2) return ferme();
    const mots = normalise(q).split(/\s+/).filter(Boolean);
    resultats = ref.competences
      .filter((c) => {
        const champ = normalise(`${c.matiere} ${c.chemin.join(' ')} ${c.label} ${c.cycle || ''}`);
        return mots.every((m) => champ.includes(m));
      })
      .slice(0, 40);
    if (!resultats.length) {
      mount(liste, h('div', { style: { padding: '10px 12px', color: '#78828d' } }, 'Aucune compétence trouvée'));
      liste.hidden = false;
      return;
    }
    mount(
      liste,
      resultats.map((c, i) =>
        h(
          'button',
          {
            type: 'button',
            class: i === actif ? 'actif' : '',
            onclick: () => {
              ferme();
              input.value = '';
              onChoix(c);
            },
          },
          h('div', {}, surligne(c.label, q), c.cycle ? h('span', { class: 'cycle' }, c.cycle) : null),
          h('div', { class: 'chemin' }, [c.matiere, ...c.chemin].join(' › '))
        )
      )
    );
    liste.hidden = false;
  }

  input.addEventListener('input', cherche);
  input.addEventListener('focus', () => input.value.length >= 2 && cherche());
  input.addEventListener('keydown', (e) => {
    const boutons = [...liste.querySelectorAll('button')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      actif = Math.max(0, Math.min(boutons.length - 1, actif + (e.key === 'ArrowDown' ? 1 : -1)));
      boutons.forEach((b, i) => b.classList.toggle('actif', i === actif));
      boutons[actif]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && actif >= 0) {
      e.preventDefault();
      boutons[actif].click();
    } else if (e.key === 'Escape') ferme();
  });
  document.addEventListener('mousedown', (e) => {
    if (!liste.contains(e.target) && e.target !== input) ferme();
  });

  return h('div', { class: 'recherche grow', style: { maxWidth: '460px' } }, input, liste);
}

/* ------------------------- Onglet récapitulatif ---------------------- */

function ongletRecap(ctx) {
  const zone = h('div', {});
  const histo = h('div', {});

  (async () => {
    const [{ annees }, historique] = await Promise.all([
      api.get(`/api/students/${ctx.eleve.id}/synthese`),
      api.get(`/api/students/${ctx.eleve.id}/historique`),
    ]);
    const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0);

    mount(
      zone,
      annees.length
        ? annees
            .slice()
            .reverse()
            .map((a) =>
              h(
                'div',
                { class: 'carte' },
                h('header', {}, h('h2', {}, `Année scolaire ${a.libelle}`)),
                h(
                  'div',
                  { class: 'corps', style: { paddingTop: '6px' } },
                  h(
                    'table',
                    { class: 'liste' },
                    h(
                      'thead',
                      {},
                      h(
                        'tr',
                        {},
                        h('th', {}, 'Matière'),
                        NIVEAUX.filter((n) => n.cle).map((n) => h('th', { title: libelleNiveau(n) }, n.court)),
                        h('th', {}, 'Évaluées'),
                        h('th', {}, 'Répartition')
                      )
                    ),
                    h(
                      'tbody',
                      {},
                      a.matieres.map((m) =>
                        h(
                          'tr',
                          {},
                          h('td', {}, m.label, m.hors_pdf ? h('span', { class: 'tag-horspdf', style: { marginLeft: '6px' } }, 'hors PDF') : null),
                          h('td', {}, `${m.vert} (${pct(m.vert, m.total)} %)`),
                          h('td', {}, m.orange),
                          h('td', {}, m.rouge),
                          h('td', { class: 'small muted' }, `${m.total} / ${m.total_referentiel}`),
                          h(
                            'td',
                            {},
                            h(
                              'span',
                              { class: 'jauge', style: { width: '140px' } },
                              h('span', { class: 'v', style: { width: pct(m.vert, m.total) + '%' } }),
                              h('span', { class: 'o', style: { width: pct(m.orange, m.total) + '%' } }),
                              h('span', { class: 'r', style: { width: pct(m.rouge, m.total) + '%' } })
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
        : h('div', { class: 'carte' }, h('div', { class: 'vide' }, 'Aucune évaluation enregistrée pour cet élève.'))
    );

    mount(
      histo,
      h(
        'div',
        { class: 'carte' },
        h('header', {}, h('h2', {}, 'Historique des saisies'), h('span', { class: 'muted small' }, '300 dernières modifications')),
        h(
          'div',
          { class: 'corps', style: { maxHeight: '420px', overflow: 'auto' } },
          historique.length
            ? h(
                'table',
                { class: 'liste' },
                h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Année'), h('th', {}, 'Compétence'), h('th', {}, 'Niveau'), h('th', {}, 'Commentaire'), h('th', {}, 'Par'))),
                h(
                  'tbody',
                  {},
                  historique.map((l) =>
                    h(
                      'tr',
                      {},
                      h('td', { class: 'small' }, frDateHeure(l.date)),
                      h('td', { class: 'small' }, l.annee),
                      h('td', { class: 'small' }, l.competence || '—'),
                      h('td', {}, l.niveau ? h('span', { class: 'legende' }, h('i', { class: l.niveau })) : h('span', { class: 'muted small' }, 'effacé')),
                      h('td', { class: 'small muted' }, l.commentaire || ''),
                      h('td', { class: 'small muted' }, l.par || '')
                    )
                  )
                )
              )
            : h('div', { class: 'vide' }, 'Aucune modification enregistrée.')
        )
      )
    );
  })();

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'cartes-action', style: { marginBottom: '20px' } },
      h(
        'div',
        { class: 'carte-action' },
        h(
          'div',
          { class: 'lib' },
          h('b', {}, 'Bilan annuel'),
          h('span', {}, 'Compétences, appréciation, signatures')
        ),
        h('button', { class: 'btn primaire', onclick: () => dialogueImpression(ctx.eleve) }, 'PDF')
      ),
      h(
        'div',
        { class: 'carte-action' },
        h(
          'div',
          { class: 'lib' },
          h('b', {}, 'Synthèse de progression'),
          h('span', {}, "Évolution d'une année sur l'autre")
        ),
        h(
          'button',
          { class: 'btn', onclick: () => window.open(`/print/synthese/${ctx.eleve.id}?periode=${encodeURIComponent(etat.periode)}&auto=1`, '_blank') },
          'PDF'
        )
      )
    ),
    h(
      'p',
      { class: 'small muted', style: { margin: '0 0 20px' } },
      'Le document s’ouvre dans un nouvel onglet : choisissez « Enregistrer au format PDF » dans la boîte d’impression.'
    ),
    zone,
    histo
  );
}

/* ------------------------- Dialogue impression ----------------------- */

function dialogueImpression(eleve) {
  const annee = h(
    'select',
    {},
    etat.years.map((y) => h('option', { value: y.id, selected: y.id === etat.year?.id }, y.libelle))
  );
  const periode = h(
    'select',
    {},
    ['1', '2'].map((p) => h('option', { value: p, selected: p === etat.periode }, `Semestre ${p}`))
  );
  const vides = h('input', { type: 'checkbox' });
  const cases = etat.referentiel.matieres
    .filter((m) => !m.hors_pdf)
    .map((m) => {
      const input = h('input', { type: 'checkbox', checked: true, value: m.id });
      return { m, input, el: h('label', { class: 'inline-check', style: { display: 'flex', padding: '3px 0' } }, input, m.label) };
    });
  const horsPdf = etat.referentiel.matieres.filter((m) => m.hors_pdf);

  const { fermer } = modale({
    titre: `Générer le livret — ${eleve.prenom} ${eleve.nom}`,
    corps: h(
      'div',
      {},
      h('label', { class: 'champ' }, h('span', {}, 'Année scolaire'), annee),
      h('label', { class: 'champ' }, h('span', {}, 'Période'), periode),
      h('div', { class: 'champ' }, h('span', { style: { fontWeight: '500' } }, 'Matières à inclure'), cases.map((c) => c.el)),
      h('label', { class: 'inline-check' }, vides, 'Inclure les compétences non évaluées'),
      horsPdf.length
        ? h(
            'p',
            { class: 'small muted' },
            `Non imprimé (suivi interne) : ${horsPdf.map((m) => m.label).join(', ')}.`
          )
        : null
    ),
    actions: [
      h('button', { class: 'btn', onclick: () => fermer() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primaire',
          onclick: () => {
            const ids = cases.filter((c) => c.input.checked).map((c) => c.m.id);
            if (!ids.length) return toast('Sélectionnez au moins une matière', 'err');
            const p = new URLSearchParams({ year: annee.value, periode: periode.value, auto: '1' });
            if (vides.checked) p.set('vides', '1');
            if (ids.length !== cases.length) p.set('matieres', ids.join(','));
            window.open(`/print/eleve/${eleve.id}?${p}`, '_blank');
            fermer();
          },
        },
        'Générer'
      ),
    ],
  });
}

/* --------------------------- Onglet dossier -------------------------- */

function ongletDossier(ctx) {
  const liste = h('div', {});
  const chips = h('div', { class: 'chips' });
  const zone = h(
    'div',
    { class: 'zone-depot' },
    h(
      'div',
      { class: 'depot-tete' },
      h(
        'div',
        { class: 'lib' },
        h('b', {}, 'Déposez des fichiers ici'),
        h('span', {}, 'PDF, images, documents · un libellé et une catégorie vous seront demandés')
      ),
      h('span', { class: 'btn' }, 'Parcourir…')
    )
  );
  const input = h('input', { type: 'file', hidden: true });
  let categories = [];
  let documents = [];
  let filtre = 'Tous';

  function dessine() {
    const visibles = filtre === 'Tous' ? documents : documents.filter((d) => d.categorie === filtre);

    const compte = (c) => (c === 'Tous' ? documents.length : documents.filter((d) => d.categorie === c).length);
    // Comme sur la maquette, seules les catégories qui contiennent au moins un
    // document sont proposées — plus celle filtrée, pour pouvoir en sortir.
    const utiles = categories.filter((c) => compte(c) || c === filtre);
    mount(
      chips,
      ['Tous', ...utiles].map((c) =>
        h(
          'button',
          {
            class: `chip ${filtre === c ? 'on' : ''}`,
            onclick: () => {
              filtre = c;
              dessine();
            },
          },
          c,
          h('span', { class: 'n' }, compte(c))
        )
      )
    );

    mount(
      liste,
      visibles.length
        ? [
            h(
              'div',
              { class: 'doc-ligne tete' },
              h('span', { style: { width: '34px' } }),
              h('span', { class: 'nom' }, 'Document'),
              h('span', { style: { width: '170px' } }, 'Catégorie'),
              h('span', { style: { width: '80px' } }, 'Taille'),
              h('span', { style: { width: '130px' } }, 'Déposé le'),
              h('span', { style: { width: '260px' } })
            ),
            ...visibles.map((d) =>
              h(
                'div',
                { class: 'doc-ligne' },
                h('span', { class: 'vignette' }, extension(d.nom_origine)),
                h(
                  'div',
                  { class: 'nom' },
                  h('a', { href: `/api/documents/${d.id}/fichier`, target: '_blank' }, d.libelle),
                  h('div', { class: 'mono muted' }, d.nom_origine)
                ),
                h('span', { style: { width: '170px' } }, h('span', { class: 'pastille' }, d.categorie)),
                h('span', { class: 'mono muted', style: { width: '80px' } }, taille(d.taille || 0)),
                h(
                  'span',
                  { class: 'small muted', style: { width: '130px' }, title: d.par ? `par ${d.par}` : '' },
                  frDateHeure(d.date)
                ),
                h(
                  'span',
                  { class: 'row', style: { width: '260px', justifyContent: 'flex-end', flexWrap: 'nowrap' } },
                  h('a', { class: 'btn mini', href: `/api/documents/${d.id}/fichier?download=1` }, 'Télécharger'),
                  h('button', { class: 'btn mini', onclick: () => renomme(d) }, 'Renommer'),
                  h(
                    'button',
                    {
                      class: 'btn mini danger',
                      onclick: async () => {
                        if (!(await confirme(`Supprimer « ${d.libelle} » du dossier ?`, { libelle: 'Supprimer' }))) return;
                        await essaie(api.del(`/api/documents/${d.id}`), 'Document supprimé');
                        recharge();
                      },
                    },
                    'Supprimer'
                  )
                )
              )
            ),
          ]
        : h('div', { class: 'vide' }, documents.length ? 'Aucun document dans cette catégorie.' : "Aucun document dans le dossier de cet élève.")
    );
  }

  async function recharge() {
    const r = await api.get(`/api/students/${ctx.eleve.id}/documents`);
    categories = r.categories;
    documents = r.documents;
    if (filtre !== 'Tous' && !categories.includes(filtre)) filtre = 'Tous';
    dessine();
  }

  function renomme(d) {
    const libelle = h('input', { type: 'text', value: d.libelle });
    const cat = h('select', {}, categories.map((c) => h('option', { value: c, selected: c === d.categorie }, c)));
    const { fermer } = modale({
      titre: 'Modifier le document',
      corps: h('div', {}, h('label', { class: 'champ' }, h('span', {}, 'Libellé'), libelle), h('label', { class: 'champ' }, h('span', {}, 'Catégorie'), cat)),
      actions: [
        h('button', { class: 'btn', onclick: () => fermer() }, 'Annuler'),
        h(
          'button',
          {
            class: 'btn primaire',
            onclick: async () => {
              await essaie(api.patch(`/api/documents/${d.id}`, { libelle: libelle.value, categorie: cat.value }), 'Document modifié');
              fermer();
              recharge();
            },
          },
          'Enregistrer'
        ),
      ],
    });
  }

  function televerse(fichier) {
    const libelle = h('input', { type: 'text', value: fichier.name });
    const cat = h('select', {}, categories.map((c) => h('option', { value: c }, c)));
    const { fermer } = modale({
      titre: 'Ajouter au dossier',
      corps: h(
        'div',
        {},
        h('p', { class: 'small muted', style: { marginTop: 0 } }, `${fichier.name} — ${taille(fichier.size)}`),
        h('label', { class: 'champ' }, h('span', {}, 'Libellé'), libelle),
        h('label', { class: 'champ' }, h('span', {}, 'Catégorie'), cat)
      ),
      actions: [
        h('button', { class: 'btn', onclick: () => fermer() }, 'Annuler'),
        h(
          'button',
          {
            class: 'btn primaire',
            onclick: async () => {
              const fd = new FormData();
              fd.append('fichier', fichier);
              fd.append('libelle', libelle.value);
              fd.append('categorie', cat.value);
              await essaie(api.post(`/api/students/${ctx.eleve.id}/documents`, fd), 'Document ajouté');
              fermer();
              recharge();
            },
          },
          'Ajouter'
        ),
      ],
    });
  }

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => input.files[0] && televerse(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('survol');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('survol');
    })
  );
  zone.addEventListener('drop', (e) => e.dataTransfer.files[0] && televerse(e.dataTransfer.files[0]));

  recharge();

  return h(
    'div',
    {},
    zone,
    input,
    h('div', { style: { margin: '20px 0' } }, chips),
    h('div', { class: 'carte' }, h('div', { class: 'corps' }, liste))
  );
}

/** Extension affichée dans la vignette (4 caractères au plus). */
function extension(nom = '') {
  const m = /\.([a-z0-9]{1,4})$/i.exec(nom);
  return m ? m[1].slice(0, 4) : '?';
}

/* -------------------------- Onglet identité -------------------------- */

function ongletIdentite(ctx) {
  const { eleve } = ctx;

  const global = h('textarea', { value: eleve.commentaire_scolarite || '', style: { minHeight: '110px' } });
  const sauveGlobal = debounce(async () => {
    await essaie(api.put(`/api/students/${eleve.id}/commentaire-scolarite`, { commentaire: global.value }));
    etatSauvegarde(infoGlobal);
  }, 900);
  global.addEventListener('input', sauveGlobal);
  global.addEventListener('blur', () => sauveGlobal.flush());
  const infoGlobal = h('span', { class: 'small muted' });

  const lignesAnnees = eleve.commentaires_annuels.map((c) => {
    const ta = h('textarea', { value: c.commentaire || '' });
    const info = h('span', { class: 'small muted' });
    const sauve = debounce(async () => {
      await essaie(
        api.put(`/api/students/${eleve.id}/commentaire-annuel`, { year_id: c.year_id, commentaire: ta.value })
      );
      etatSauvegarde(info);
    }, 900);
    ta.addEventListener('input', sauve);
    ta.addEventListener('blur', () => sauve.flush());
    return h(
      'label',
      { class: 'champ' },
      h('span', {}, `Appréciation ${c.libelle} `, info),
      ta
    );
  });

  const a = age(eleve.date_naissance);
  const fiche = [
    ['Nom', eleve.nom],
    ['Prénom', eleve.prenom],
    ['Date de naissance', frDate(eleve.date_naissance) || '—'],
    ['Âge', a != null ? `${a} ans` : '—'],
    ['Groupe', eleve.classe || '—'],
    ["Date d'entrée", frDate(eleve.date_entree) || '—'],
  ];

  return h(
    'div',
    { class: 'identite-grille' },
    h(
      'div',
      { class: 'carte' },
      h(
        'header',
        {},
        h('h2', { class: 'grow' }, 'Identité'),
        h('button', { class: 'btn mini', onclick: () => formulaireEleve(eleve, recharge) }, 'Modifier')
      ),
      h(
        'div',
        { class: 'corps' },
        h(
          'dl',
          { class: 'fiche-identite' },
          fiche.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])
        ),
        h(
          'div',
          { class: 'row', style: { marginTop: '18px' } },
          h('button', { class: 'btn mini', onclick: () => formulaireRattachement(eleve, recharge) }, 'Rattacher à une enseignante'),
          h(
            'button',
            {
              class: 'btn mini danger',
              onclick: async () => {
                if (await supprimeEleve(eleve)) navigue('/eleves');
              },
            },
            'Supprimer l’élève'
          )
        )
      )
    ),
    h(
      'div',
      { class: 'pile', style: { gap: '20px' } },
      h(
        'div',
        { class: 'carte' },
        h(
          'header',
          {},
          h(
            'div',
            { class: 'titres grow' },
            h('h2', {}, 'Commentaire global de scolarité'),
            h('div', { class: 'descr' }, 'Parcours de l’élève, repris dans la synthèse de progression.')
          ),
          infoGlobal
        ),
        h('div', { class: 'corps' }, global)
      ),
      h(
        'div',
        { class: 'carte' },
        h('header', {}, h('h2', {}, 'Appréciations annuelles')),
        h('div', { class: 'corps' }, lignesAnnees.length ? lignesAnnees : h('p', { class: 'muted' }, 'Aucune année scolaire définie.'))
      )
    )
  );
}

function etatSauvegarde(el) {
  mount(el, '✓ enregistré');
  setTimeout(() => clear(el), 2000);
}

function recharge() {
  chargeEleves(true);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
