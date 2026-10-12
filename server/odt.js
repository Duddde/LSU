// Lecture des référentiels fournis au format ODT (LibreOffice Writer).
// La hiérarchie du document est portée par la couleur de fond des cellules :
//   #ffcc99 -> catégorie orange (niveau 1)
//   #ffffcc -> catégorie jaune  (niveau 2)
//   #eeeeee / #dddddd -> catégorie grise (niveau 3)
//   sans couleur -> compétence évaluable (feuille)
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const COLORS = {
  '#ffcc99': 1,
  '#ffcc00': 1,
  '#ffffcc': 2,
  '#ffff99': 2,
  '#eeeeee': 3,
  '#dddddd': 3,
  '#cccccc': 3,
};

const CYCLE_RE = /^C\s*([123])\s*(?:[-–]\s*(PS|MS|GS|CP|CE1|CE2|CM1|CM2|6\s*[eè]me?|6e))?\s*$/i;
const TRANCHE_RE = /^\d{1,2}\s*(?:→|->|–|-)\s*\d{1,2}$/;

/** Extrait un fichier du conteneur ZIP d'un .odt (sans dépendance externe). */
function readZipEntry(buf, wanted) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('Archive ODT illisible (fin de catalogue absente)');
  const count = buf.readUInt16LE(i + 10);
  let p = buf.readUInt32LE(i + 16);
  for (let k = 0; k < count; k++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const localOffset = buf.readUInt32LE(p + 42);
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compressed);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`Entrée ${wanted} absente de l'archive ODT`);
}

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&');

const cellText = (xml) =>
  unescapeXml(
    xml
      .replace(/<text:s\s*\/>/g, ' ')
      .replace(/<text:s [^>]*\/>/g, '  ')
      .replace(/<text:tab\s*\/>/g, ' ')
      .replace(/<text:line-break\s*\/>/g, ' ')
      .replace(/<\/text:p>/g, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();

/** Retourne les lignes du document sous la forme [{ color, text }]. */
export function readOdtRows(file) {
  const xml = readZipEntry(fs.readFileSync(file), 'content.xml').toString('utf8');

  const styles = {};
  const styleRe =
    /<style:style style:name="([^"]+)" style:family="table-cell"[^>]*>([\s\S]*?)<\/style:style>/g;
  let m;
  while ((m = styleRe.exec(xml))) {
    const bg = /fo:background-color="([^"]+)"/.exec(m[2]);
    styles[m[1]] = bg ? bg[1].toLowerCase() : null;
  }

  const rows = [];
  const rowRe = /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g;
  while ((m = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<table:table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g;
    let c;
    while ((c = cellRe.exec(m[1]))) {
      const style = /table:style-name="([^"]+)"/.exec(c[1]);
      const repeat = /table:number-columns-repeated="(\d+)"/.exec(c[1]);
      const cell = {
        color: style ? styles[style[1]] || null : null,
        text: c[2] ? cellText(c[2]) : '',
      };
      for (let t = 0, max = repeat ? Math.min(+repeat[1], 10) : 1; t < max; t++) cells.push(cell);
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/**
 * Convertit un .odt en arbre de compétences.
 * @returns {{ matiere: string, children: Node[] }} où
 *          Node = { label, depth, cycle?, children: Node[] }
 */
export function parseReferentielOdt(file, matiereName) {
  const rows = readOdtRows(file);
  const matiere = matiereName || path.basename(file).replace(/\.odt$/i, '');
  const root = { label: matiere, depth: 0, children: [] };
  const stack = [root]; // stack[d] = conteneur courant de profondeur d
  let lastCycle = null;

  for (const cells of rows) {
    const first = cells[0];
    if (!first) continue;
    const level = first.color ? COLORS[first.color] : null;
    const label = first.text.trim();

    if (level) {
      if (!label || TRANCHE_RE.test(label)) continue;
      const parent = stack[level - 1] || stack[stack.length - 1] || root;
      const node = { label: normalizeTitle(label), depth: level, children: [], cycle: null };
      parent.children.push(node);
      stack.length = level;
      stack[level] = node;
      lastCycle = null;
      continue;
    }

    // Ligne de compétence : [cycle, intitulé, ...colonnes de tranches d'âge]
    // La colonne « cycle » est parfois vide : l'intitulé est alors en 2e cellule.
    let cycle = null;
    let text = label;
    const tag = CYCLE_RE.exec(label);
    if (tag) {
      cycle = formatCycle(tag);
      text = (cells[1]?.text || '').trim();
      lastCycle = cycle;
    } else {
      // Cellule « cycle » vide ou absente : on reprend celui de la ligne précédente.
      if (!label && cells[1]?.text.trim()) text = cells[1].text.trim();
      cycle = lastCycle;
    }
    if (!text || TRANCHE_RE.test(text)) continue;
    const parent = stack[stack.length - 1] || root;
    parent.children.push({ label: text, depth: parent.depth + 1, cycle, children: [] });
  }
  return root;
}

function formatCycle(tag) {
  const cycle = `C${tag[1]}`;
  if (!tag[2]) return cycle;
  let lvl = tag[2].toUpperCase().replace(/\s+/g, '');
  if (/^6/.test(lvl)) lvl = '6ème';
  return `${cycle} - ${lvl}`;
}

// Les titres du document sont en capitales non accentuées : on réaccentue
// les mots courants des programmes (les intitulés restent modifiables dans l'app).
const ACCENTS = {
  resolution: 'résolution',
  problemes: 'problèmes',
  probleme: 'problème',
  operations: 'opérations',
  operation: 'opération',
  decimaux: 'décimaux',
  decimal: 'décimal',
  algebre: 'algèbre',
  durees: 'durées',
  duree: 'durée',
  geometrie: 'géométrie',
  geometrique: 'géométrique',
  reperage: 'repérage',
  deplacements: 'déplacements',
  deplacement: 'déplacement',
  donnees: 'données',
  proportionnalite: 'proportionnalité',
  pensee: 'pensée',
  numeration: 'numération',
  perimetres: 'périmètres',
  perimetre: 'périmètre',
  elementaire: 'élémentaire',
  ecriture: 'écriture',
  ecrit: 'écrit',
  reperes: 'repères',
  mesure: 'mesure',
  a: 'à',
  memorisation: 'mémorisation',
  strategies: 'stratégies',
  representations: 'représentations',
  grandeur: 'grandeur',
  ecole: 'école',
  eleve: 'élève',
  eleves: 'élèves',
  etude: 'étude',
  langue: 'langue',
  litterature: 'littérature',
  activites: 'activités',
  competences: 'compétences',
  numerique: 'numérique',
  numeriques: 'numériques',
  reperer: 'repérer',
  generale: 'générale',
  litteraire: 'littéraire',
  oralite: 'oralité',
};

/** « LES NOMBRES ENTIERS » -> « Les nombres entiers » (on garde les sigles). */
function normalizeTitle(s) {
  if (s !== s.toUpperCase()) return s;
  const out = s
    .toLowerCase()
    .replace(/[a-zà-öø-ÿ']+/g, (w) => ACCENTS[w] || w)
    .replace(/\s+/g, ' ')
    .trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}
