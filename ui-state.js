function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch (_) {
    return null;
  }
}

export function createUiState(storage = browserStorage()) {
  const sessions = new Map();

  const readPreference = key => {
    try {
      return storage?.getItem(key) ?? null;
    } catch (_) {
      return null;
    }
  };

  const writePreference = (key, value) => {
    try {
      storage?.setItem(key, value);
    } catch (_) {}
  };

  const valuesFor = characterId => {
    const id = String(characterId);
    let values = sessions.get(id);
    if (!values) {
      values = new Map();
      sessions.set(id, values);
    }
    return values;
  };

  const readSession = (characterId, key, fallback = null) => {
    const values = sessions.get(String(characterId));
    return values?.has(key) ? values.get(key) : fallback;
  };

  const writeSession = (characterId, key, value) => {
    valuesFor(characterId).set(key, value);
    return value;
  };

  const getRenderer = characterId => {
    const stored = readPreference(`dse-ui:renderer:${characterId}`);
    if (stored) return stored;
    const legacy = readPreference(`dse-ui:layout:${characterId}`)
      || readPreference('dse-ui:layout');
    return legacy === 'classic' ? 'builtin:classic' : 'builtin:compact';
  };

  const setRenderer = (characterId, identity) => {
    const value = String(identity || '');
    if (!/^[a-z0-9][a-z0-9-]{0,63}:[a-z0-9][a-z0-9-]{0,63}$/.test(value)) return false;
    writePreference(`dse-ui:renderer:${characterId}`, value);
    return true;
  };

  return Object.freeze({
    getTab(characterId, tabs) {
      const stored = readPreference(`dse-tab:${characterId}`);
      return tabs.some(tab => tab.id === stored) ? stored : tabs[0]?.id;
    },

    setTab(characterId, tabId) {
      writePreference(`dse-tab:${characterId}`, String(tabId));
    },

    getRenderer,
    setRenderer,

    getLayout(characterId) {
      return getRenderer(characterId) === 'builtin:classic' ? 'classic' : 'compact';
    },

    setLayout(characterId, layout) {
      return setRenderer(characterId, layout === 'classic' ? 'builtin:classic' : 'builtin:compact');
    },

    get: readSession,
    set: writeSession,

    update(characterId, key, update, fallback = null) {
      return writeSession(
        characterId,
        key,
        update(readSession(characterId, key, fallback)),
      );
    },

    remove(characterId, key) {
      const id = String(characterId);
      const values = sessions.get(id);
      if (!values) return;
      values.delete(key);
      if (!values.size) sessions.delete(id);
    },

    clear(characterId) {
      if (characterId === undefined) sessions.clear();
      else sessions.delete(String(characterId));
    },
  });
}
