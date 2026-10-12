// Bloc « Posture d'élève » : suivi interne, volontairement exclu du PDF transmis
// (hors_pdf = 1). Les intitulés restent modifiables depuis l'onglet Référentiel.
export default {
  label: "Posture d'élève",
  depth: 0,
  cycle: null,
  children: [
    {
      label: 'Attitude face aux apprentissages',
      children: [
        {
          label: 'Engagement dans la tâche',
          children: [
            { label: "Entre dans l'activité proposée sans appréhension" },
            { label: 'Maintient son attention sur la durée de la tâche' },
            { label: 'Persévère devant la difficulté' },
            { label: "Accepte l'erreur et la reprise du travail" },
            { label: "Demande de l'aide de façon adaptée" },
          ],
        },
        {
          label: 'Autonomie et organisation',
          children: [
            { label: 'Prépare et range son matériel' },
            { label: 'Comprend et applique une consigne simple' },
            { label: 'Comprend et applique une consigne complexe' },
            { label: 'Planifie les étapes de son travail' },
            { label: 'Contrôle et relit son travail' },
          ],
        },
      ],
    },
    {
      label: 'Relation aux autres',
      children: [
        {
          label: 'Vie du groupe',
          children: [
            { label: 'Respecte les règles collectives' },
            { label: 'Coopère au sein d’un petit groupe' },
            { label: 'Écoute et prend en compte la parole d’autrui' },
            { label: 'Gère les conflits par le langage' },
            { label: 'Accepte le cadre posé par l’adulte' },
          ],
        },
        {
          label: 'Communication',
          children: [
            { label: 'Ose prendre la parole devant le groupe' },
            { label: 'Exprime un besoin, un ressenti' },
            { label: 'Adapte son langage à son interlocuteur' },
          ],
        },
      ],
    },
    {
      label: 'Régulation et bien-être',
      children: [
        {
          label: 'Gestion émotionnelle',
          children: [
            { label: 'Identifie et nomme ses émotions' },
            { label: 'Utilise des stratégies d’apaisement' },
            { label: 'Supporte la frustration et l’attente' },
            { label: 'Gère les transitions et les changements' },
          ],
        },
        {
          label: 'Rythme et présence',
          children: [
            { label: 'Fatigabilité au cours de la journée' },
            { label: 'Besoin de pauses / temps de retrait' },
            { label: 'Participation régulière aux activités' },
          ],
        },
      ],
    },
  ],
};
