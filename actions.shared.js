export function registerActionMap(host, actions) {
  for (const [name, fn] of Object.entries(actions)) host.registerAction(name, fn);
}
