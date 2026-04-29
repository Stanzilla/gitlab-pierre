(() => {
  if (window.__gitlabPierrePageBridgeInstalled === true) return;
  window.__gitlabPierrePageBridgeInstalled = true;

  const REQUEST_EVENT = 'gitlab-pierre:native-file-request';
  const RESPONSE_EVENT = 'gitlab-pierre:native-file-response';

  const normalizeDiffPath = (path) => {
    if (typeof path !== 'string') return null;
    const trimmed = path.trim();
    if (trimmed.length === 0) return null;
    return trimmed.replace(/^a\//, '').replace(/^b\//, '');
  };

  const isDiffsAppLike = (value) =>
    value != null &&
    typeof value === 'object' &&
    Array.isArray(value.diffFiles) &&
    typeof value.loadCollapsedDiff === 'function';

  const traverseVueChildrenForDiffsApp = (node) => {
    if (node == null) return null;
    if (isDiffsAppLike(node)) return node;
    if (Array.isArray(node.$children)) {
      for (const child of node.$children) {
        const found = traverseVueChildrenForDiffsApp(child);
        if (found != null) return found;
      }
    }
    return null;
  };

  const findDiffsAppInstance = (diffContainer) => {
    const seed = diffContainer?.querySelector?.('.diff-file') ?? diffContainer;
    let walker = seed instanceof Element ? seed : null;
    let firstVueInstance = null;

    while (walker != null) {
      const inst = walker.__vue__;
      if (inst != null) {
        if (firstVueInstance == null) firstVueInstance = inst;
        if (isDiffsAppLike(inst)) return inst;
      }
      walker = walker.parentElement;
    }

    const stack = diffContainer instanceof Element ? [diffContainer] : [];
    while (stack.length > 0) {
      const node = stack.pop();
      const inst = node.__vue__;
      if (inst != null) {
        if (firstVueInstance == null) firstVueInstance = inst;
        if (isDiffsAppLike(inst)) return inst;
      }
      stack.push(...node.children);
    }

    return traverseVueChildrenForDiffsApp(firstVueInstance?.$root ?? firstVueInstance);
  };

  const findNativeDiffEntry = (app, paths) => {
    for (const entry of app.diffFiles) {
      const candidates = [entry.file_path, entry.new_path, entry.old_path]
        .map((path) => normalizeDiffPath(path))
        .filter((path) => path != null);
      if (paths.some((path) => candidates.some((candidate) => candidate === path || candidate.endsWith(`/${path}`)))) {
        return entry;
      }
    }
    return null;
  };

  const dispatchResponse = (requestId, detail) => {
    document.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: JSON.stringify({ requestId, ...detail }),
      })
    );
  };

  document.addEventListener(
    REQUEST_EVENT,
    (event) => {
      void (async () => {
        let requestId = null;
        try {
          const request = JSON.parse(typeof event.detail === 'string' ? event.detail : '{}');
          requestId = request.requestId;
          const paths = Array.isArray(request.paths)
            ? request.paths.map((path) => normalizeDiffPath(path)).filter((path) => path != null)
            : [];
          const diffContainer =
            event.target instanceof Element
              ? event.target
              : document.querySelector('.diffs, [data-testid="diffs"]');

          if (typeof requestId !== 'string' || paths.length === 0) return;

          const app = findDiffsAppInstance(diffContainer);
          if (app == null) {
            dispatchResponse(requestId, { ok: false, step: 'no-DiffsApp' });
            return;
          }

          const entry = findNativeDiffEntry(app, paths);
          if (entry == null) {
            dispatchResponse(requestId, {
              ok: false,
              step: 'no-entry-in-diffFiles',
              diffFilesCount: app.diffFiles.length,
            });
            return;
          }

          if (entry.viewer?.collapsed === true) {
            await Promise.resolve(app.loadCollapsedDiff(entry));
          }

          const path = entry.file_path ?? entry.new_path ?? entry.old_path ?? '';
          if (typeof app.goToFile === 'function' && path.length > 0) {
            app.goToFile({ path });
          }

          dispatchResponse(requestId, {
            ok: true,
            step: 'mount-requested',
            path,
            collapsed: entry.viewer?.collapsed === true,
          });
        } catch (error) {
          console.warn('[GitLab Pierre] Page bridge failed to process native file request.', error);
          if (typeof requestId === 'string') {
            dispatchResponse(requestId, {
              ok: false,
              step: 'threw',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })();
    },
    true
  );
})();
