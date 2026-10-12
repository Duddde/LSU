# Livret scolaire unique — Institut Pierre Chanay

Application web de suivi des compétences par matière et par sous-compétence,
destinée aux enseignantes. Chaque élève dispose d'un livret, d'un dossier
documentaire et de documents imprimables (bilan annuel, synthèse de progression).

Tout fonctionne en local : un serveur Node.js, une base SQLite dans `data/`,
aucune dépendance externe ni service en ligne.

---

## Démarrer

```bash
npm install
npm start
```

Puis ouvrir **http://localhost:4321**. Sous Windows, un double-clic sur
`demarrer.cmd` fait les deux (installation si besoin, lancement, ouverture du
navigateur).

Pour que les autres postes de l'établissement accèdent à l'application, elles
utilisent l'adresse IP du poste serveur : `http://192.168.x.x:4321`.

---

## Ce que l'application fait

### Élèves
- Liste de tous les élèves, triée par ordre alphabétique (tri sur chaque colonne).
- Recherche par nom et prénom (insensible aux accents et à la casse).
- Filtre **« mes élèves uniquement »** selon l'enseignante courante.
- Ajout manuel d'un élève : nom, prénom, date de naissance, classe/groupe,
  date d'entrée. L'âge et la tranche de référence (6 → 11, 11 → 15, 15 → 18 ans)
  sont calculés automatiquement.
- Rattachement d'un élève à une ou plusieurs enseignantes ; toutes voient tous
  les élèves, le rattachement sert au filtre et au livret.
- Archivage d'un élève sorti de l'établissement (ses données sont conservées).

### Évaluation des compétences
Navigation en arborescence, exactement comme le document papier :

```
élève → matière → catégorie orange → catégorie jaune → catégorie grise → compétence
```

- Fil d'Ariane pour remonter d'un niveau, compteur et jauge de répartition sur
  chaque catégorie (combien de compétences évaluées, et dans quelles couleurs).
- **Recherche avec autocomplétion** sur toutes les compétences : la saisie
  affiche les intitulés correspondants avec leur chemin complet, et le clic
  ouvre directement la bonne catégorie en mettant la compétence en évidence.
- Pour chaque compétence : **vert** (réalisé seul, peu d'aide), **orange**
  (réalisé avec aide), **rouge** (réalisé avec beaucoup d'aide), un commentaire libre, et le
  niveau d'origine du programme (C1 - PS, C2 - CP, C3 - 6ème…). Un second clic sur
  la même couleur repasse la compétence en « non évalué ».
- Enregistrement automatique, horodaté et signé (qui a saisi, quand).
- **Évolution** : les pastilles affichées sous chaque compétence rappellent les
  niveaux atteints les années précédentes.
- Légende des couleurs affichée en permanence (libellés modifiables dans
  Paramètres).

### Récapitulatif & progression
- Tableau par année scolaire et par matière : seul / avec aide / avec beaucoup d'aide,
  pourcentages, nombre de compétences évaluées sur le total du référentiel.
- Historique complet des saisies (date, année, compétence, niveau, commentaire,
  autrice).

### Dossier de l'élève (GED)
Dépôt de fichiers par glisser-déposer, avec libellé et catégorie (bilan,
évaluation, projet PPS/PAP/PPRE, courrier, compte rendu de réunion, document
médical, production de l'élève…). Les fichiers sont stockés dans `data/uploads/`.

### Commentaires
- Un **commentaire global de scolarité** (parcours de l'élève).
- Une **appréciation par année scolaire**.

### Référentiel
- Arborescence complète, modifiable : **ajouter, renommer, déplacer, supprimer**
  matières, catégories et compétences ; saisie en lot (une ligne = une entrée).
- **Réorganisation par glisser-déposer** : attraper une ligne par sa poignée
  (⠿, à gauche) et la déposer sur le haut ou le bas d'une autre ligne pour la
  placer avant ou après, ou au centre d'une ligne pour la faire entrer dedans.
  Survoler une catégorie repliée l'ouvre au bout d'une seconde. Une matière ne
  peut être déposée qu'entre deux matières, et une branche ne peut pas être
  déposée dans elle-même. Au clavier : **Alt + ↑ / Alt + ↓** sur la poignée.
- Suppression sécurisée : si des évaluations existent déjà sur la branche, elle
  est **archivée** au lieu d'être supprimée (les livrets déjà remplis restent
  lisibles). La suppression définitive reste possible.
- **Import d'un fichier ODT** « Récap programmes » : la hiérarchie est déduite
  des couleurs de fond du tableau (orange, jaune, gris) et le niveau de chaque
  compétence de la colonne de gauche (C1 - PS, C2 - CP…).
  Le référentiel **Mathématiques** fourni est importé automatiquement au premier
  démarrage (334 compétences). Pour les autres matières : déposer le `.odt` à la
  racine du projet avant le premier démarrage, ou utiliser le bouton
  « Importer un ODT » de l'onglet Référentiel.
- **Posture d'élève** : bloc d'observation livré avec l'application, suivi dans
  l'outil mais **volontairement absent des PDF**. N'importe quelle branche peut
  être passée « hors PDF » depuis le menu `⋯`.

### Documents imprimables (PDF)
Depuis la fiche élève, bouton **« Générer le PDF »** :

- **Bilan annuel** — identité, légende, compétences par matière avec niveau et
  commentaire, appréciation de l'année, cases de signature, mentions légales.
  Options : année scolaire, choix des matières, inclusion ou non des compétences
  non évaluées.
- **Synthèse de progression** — récapitulatif chiffré par année et par matière,
  tableau d'évolution d'une année sur l'autre, commentaire global de scolarité
  et appréciations annuelles.

Le document s'ouvre dans un onglet et la boîte d'impression s'affiche :
choisir **« Enregistrer au format PDF »** comme imprimante.

### Logos et mentions légales
Déposer les fichiers dans `public/assets/logos/` (png, jpg ou svg) :

| Fichier | Contenu |
|---|---|
| `education-nationale.png` | Bloc-marque République française / Éducation nationale |
| `pierre-chanay.png` | Institut Pierre Chanay |
| `fol58.png` | FOL 58 (utilisé si le logo de l'institut est absent) |

Le logo de l'Éducation nationale est une marque de l'État : il n'est pas fourni
avec l'application, il faut le récupérer auprès de la direction. Tant qu'un
fichier manque, un emplacement en pointillés apparaît sur le document.

Le nom de l'établissement, l'organisme gestionnaire, la légende des couleurs et
le texte des mentions légales se modifient dans **Paramètres**.

---

## Comptes et authentification

L'authentification est **désactivée** pour l'instant, comme demandé : chacune
choisit son identité dans le menu « Je suis : » de l'en-tête (cela détermine le
filtre « mes élèves » et la signature des saisies), et toutes les fonctions sont
accessibles.

Les comptes existent déjà en base et se créent dans l'onglet **Enseignantes**
(nom, prénom, rôle enseignante ou administratrice, identifiant et mot de passe
facultatifs pour l'instant). Le jour où l'établissement veut activer
l'authentification, il suffit de démarrer le serveur ainsi — sans aucune autre
modification :

```powershell
$env:LSU_AUTH=1 ; npm start
```

```bash
LSU_AUTH=1 npm start
```

Un écran de connexion apparaît alors, les droits « administratrice » (gestion des
comptes et des paramètres) deviennent effectifs, et au premier démarrage le mot
de passe du compte `admin@local` est affiché dans la console.

---

## Sauvegarde et maintenance

- Toutes les données tiennent dans le dossier **`data/`** : `lsu.sqlite`
  (base) et `uploads/` (documents du dossier élève). Sauvegarder ce dossier
  suffit à tout sauvegarder.
- **Sauvegarde à la demande**, serveur allumé ou éteint — la copie est faite par
  SQLite lui-même, elle est donc toujours cohérente :

  ```bash
  npm run sauvegarde
  ```

  Elle est écrite dans `data/sauvegardes/AAAA-MM-JJ-hh-mm-ss/` (base + documents).
  Pour restaurer : serveur arrêté, recopier `lsu.sqlite` et `uploads/` de la
  sauvegarde par-dessus ceux de `data/`.
- Remise à zéro complète (supprime élèves, évaluations, comptes et documents) :

  ```bash
  npm run reset          # annonce ce qui sera supprimé, ne supprime rien
  npm run reset -- --oui # exécute, après une sauvegarde automatique
  ```

- **Base de travail séparée** (essais, démonstration, tests) : la variable
  `LSU_DATA` déplace la totalité des données ailleurs, sans jamais toucher à
  celles de l'établissement.

  ```powershell
  $env:LSU_DATA="A:\Sources\LSU-essais" ; $env:PORT=4399 ; npm start
  ```

- Port d'écoute : variable `PORT` (`4321` par défaut).

---

## Organisation du code

```
server/
  index.js              serveur Express, identité de la requête, routage
  config.js             interrupteur d'authentification (LSU_AUTH)
  db.js                 schéma SQLite, amorçage, import initial des référentiels
  auth.js               hachage scrypt des mots de passe, cookies
  middleware.js         contrôles d'accès et gestion d'erreurs
  odt.js                lecture des référentiels ODT (hiérarchie par couleurs)
  referentiel-posture.js bloc « Posture d'élève » (hors PDF)
  routes/
    core.js             session, enseignantes, élèves, années, paramètres
    referentiel.js      arborescence, CRUD, import ODT
    dossier.js          évaluations, historique, synthèse, documents (GED)
    print.js            pages imprimables (bilan annuel, synthèse)
  scripts/
    reset.js            remise à zéro (sauvegarde automatique au préalable)
    sauvegarde.js       copie datée de la base et des documents
public/
  index.html, css/app.css
  js/   app.js (routage) · api.js (état + appels) · dom.js (helpers)
        vue-eleves.js · vue-eleve.js · vue-referentiel.js
        vue-enseignantes.js · vue-parametres.js · vue-connexion.js
  assets/logos/         logos du livret
data/                   base SQLite + documents déposés
```

Aucune étape de compilation : le navigateur charge directement les modules ES.
