export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  if (window.Notification.permission !== 'default') {
    return window.Notification.permission;
  }
  try {
    return await window.Notification.requestPermission();
  } catch {
    return window.Notification.permission;
  }
}

export function showBrowserNotification(options: {
  title: string;
  body: string;
  tag?: string;
  onClick?: () => void;
}): Notification | null {
  if (!isBrowserNotificationSupported() || window.Notification.permission !== 'granted') {
    return null;
  }
  try {
    const notification = new window.Notification(options.title, {
      body: options.body,
      tag: options.tag,
    });
    notification.onclick = () => {
      if (typeof window !== 'undefined') window.focus();
      options.onClick?.();
      notification.close();
    };
    return notification;
  } catch {
    return null;
  }
}

function alertStorageKey(userId: string): string {
  return `campusconnect_alerted_matches_${userId}`;
}

export function getAlertedMatchKeys(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(alertStorageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

export function markMatchKeyAlerted(userId: string, key: string): void {
  try {
    const current = [...getAlertedMatchKeys(userId)];
    if (!current.includes(key)) {
      current.push(key);
      localStorage.setItem(alertStorageKey(userId), JSON.stringify(current.slice(-100)));
    }
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}
