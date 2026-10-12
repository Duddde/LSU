/**
 * Authentification : désactivée par défaut (phase de mise en route).
 * Les comptes enseignantes existent déjà en base ; seul le contrôle d'accès
 * est neutralisé. Pour l'activer, démarrer le serveur avec LSU_AUTH=1 :
 *
 *   LSU_AUTH=1 npm start           (bash)
 *   $env:LSU_AUTH=1; npm start     (PowerShell)
 *
 * En mode sans authentification, l'identité courante est choisie dans l'en-tête
 * de l'application (cookie « lsu_teacher ») et tout le monde a les droits admin.
 */
export const AUTH_ENABLED = process.env.LSU_AUTH === '1' || process.env.LSU_AUTH === 'true';
