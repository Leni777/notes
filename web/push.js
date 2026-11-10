// Upozornění: přihlášení zařízení k Web Push (service worker sw.js je zobrazí i při zavřené appce).
import { api, state } from './lib.js';

const b64uToBytes = (s) => {
  const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const bytesToB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Stav upozornění na tomto zařízení: 'on' | 'off' | 'denied' | 'unsupported' | 'ios-install' */
export async function pushState() {
  if (!pushSupported()) return isIos() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function subscription(reg) {
  const key = b64uToBytes(state.push.key);
  let sub = await reg.pushManager.getSubscription();
  // jiný klíč serveru (např. nová databáze) → přihlásit znovu
  const cur = sub?.options?.applicationServerKey;
  if (sub && cur && bytesToB64u(cur) !== state.push.key) {
    await sub.unsubscribe();
    sub = null;
  }
  return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error(isIos() ? 'Na iPhonu je potřeba appku nejdřív přidat na plochu (Sdílet → Přidat na plochu).' : 'Tento prohlížeč upozornění neumí.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Upozornění nejsou povolená. Povol je v nastavení prohlížeče pro tuto stránku.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await subscription(reg);
  const r = await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  state.push.devices = r.devices;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) {
    const r = await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
    state.push.devices = r.devices;
    await sub.unsubscribe();
  }
}

/** Při startu: když je zařízení přihlášené, připomenout se serveru (kdyby ho mezitím zapomněl). */
export async function refreshPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    if (!await reg.pushManager.getSubscription()) return;
    const sub = await subscription(reg);
    const r = await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
    state.push.devices = r.devices;
  } catch { /* nevadí, zkusí se příště */ }
}
