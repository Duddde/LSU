import { h, mount, toast } from './dom.js';
import { api } from './api.js';

/** Écran de connexion — utilisé uniquement si le serveur tourne avec LSU_AUTH=1. */
export default function vueConnexion() {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const mdp = h('input', { type: 'password', autocomplete: 'current-password', required: true });

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api.post('/api/login', { email: email.value, password: mdp.value });
          location.reload();
        } catch (err) {
          toast(err.message, 'err');
          mdp.value = '';
          mdp.focus();
        }
      },
    },
    h('label', { class: 'champ' }, h('span', {}, 'Identifiant'), email),
    h('label', { class: 'champ' }, h('span', {}, 'Mot de passe'), mdp),
    h('button', { class: 'btn primaire', type: 'submit', style: { width: '100%' } }, 'Se connecter')
  );

  mount(
    document.getElementById('entete'),
    h('div', { class: 'brand' }, 'Livret scolaire unique')
  );

  return h(
    'div',
    { class: 'carte', style: { maxWidth: '400px', margin: '8vh auto' } },
    h('header', {}, h('h2', {}, 'Connexion')),
    h('div', { class: 'corps' }, form)
  );
}
