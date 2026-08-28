const DEFAULT_STORAGE_KEY = "apuestas-auto-sync-deportes";

export function createSyncManager({
  isPageVisible = () => true,
  isPageRecentlyReactivated = () => false,
  runWhenFree = callback => setTimeout(callback, 0),
  storageKey = DEFAULT_STORAGE_KEY
} = {}) {
  const configs = new Map();
  const activeSports = new Set();
  const pendingTimers = new Map();
  const intervals = new Map();
  let listenersRegistered = false;

  function loadActiveSports() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(stored)) stored.forEach(sport => activeSports.add(sport));
    } catch (error) {
      console.warn("No se pudo restaurar auto-sync:", error);
    }
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...activeSports]));
    } catch (error) {
      console.warn("No se pudo guardar auto-sync:", error);
    }
  }

  function register(sport, config) {
    configs.set(sport, config);
  }

  function isActive(sport) {
    return activeSports.has(sport);
  }

  function schedule(sport, delay = 0, force = false) {
    const config = configs.get(sport);
    if (!config || !isActive(sport) || !isPageVisible()) return;
    if (pendingTimers.has(sport)) {
      if (!force) return;
      clearTimeout(pendingTimers.get(sport));
      pendingTimers.delete(sport);
    }

    const resumeDelay = config.resumeDelay ?? 0;
    const finalDelay = force || !isPageRecentlyReactivated()
      ? delay
      : Math.max(delay, resumeDelay);
    const timer = setTimeout(() => {
      pendingTimers.delete(sport);
      if (!isPageVisible() || !isActive(sport)) return;
      runWhenFree(() => config.run(force));
    }, finalDelay);
    pendingTimers.set(sport, timer);
  }

  function activate(sport) {
    const config = configs.get(sport);
    if (!config) throw new Error(`Auto-sync no registrado: ${sport}`);
    activeSports.add(sport);
    persist();
    if (!intervals.has(sport)) {
      intervals.set(sport, setInterval(() => schedule(sport), config.intervalMs));
    }
    schedule(sport, 0, true);
  }

  function restore() {
    configs.forEach((_, sport) => {
      if (isActive(sport)) activate(sport);
    });
  }

  function cancelPending() {
    pendingTimers.forEach(timer => clearTimeout(timer));
    pendingTimers.clear();
  }

  function registerLifecycle() {
    if (listenersRegistered) return;
    listenersRegistered = true;
    document.addEventListener("visibilitychange", () => {
      if (!isPageVisible()) {
        cancelPending();
        return;
      }
      activeSports.forEach(sport => schedule(sport, 1000, true));
    });
    window.addEventListener("focus", () => {
      activeSports.forEach(sport => schedule(sport, 1000, true));
    });
  }

  loadActiveSports();
  return { register, activate, isActive, schedule, restore, cancelPending, registerLifecycle };
}
