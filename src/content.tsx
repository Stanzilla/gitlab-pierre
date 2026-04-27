import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  processPatch,
  type DiffsThemeNames,
  type FileDiffMetadata,
  type GetHoveredLineResult,
  type ThemeTypes,
} from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { FileTree } from '@pierre/trees/react';
import { FileTree as FileTreeModel } from '@pierre/trees';
import diffCoreStyles from '@pierre-diffs-core-style';

import './styles.css';

type GitLabChangesPage =
  | {
      diffUrl: string;
      key: string;
      kind: 'merge-request';
    }
  | {
      diffUrl: string;
      key: string;
      kind: 'commit';
    }
  | {
      diffUrl: string;
      key: string;
      kind: 'compare';
    };

interface ParsedDiff {
  files: FileDiffMetadata[];
  paths: string[];
  stats: DiffStats;
}

interface DiffStats {
  additions: number;
  deletions: number;
  files: number;
}

interface NativeChangesChrome {
  commitHref: string | null;
  commitShortSha: string | null;
  latestHref: string | null;
  latestText: string | null;
}

interface MountState {
  key: string;
  roots: Root[];
  targets: MountTargets;
}

const EXTENSION_ATTR = 'data-gitlab-pierre';
const HIDDEN_CLASS = 'gitlab-pierre-native-hidden';
const COMMENT_MODE_ATTR = 'data-gitlab-pierre-comment-mode';
const DIFF_CORE_STYLE_ATTR = 'data-gitlab-pierre-diff-core-style';
const TOAST_ATTR = 'data-gitlab-pierre-toast';
const RETURN_BUTTON_ATTR = 'data-gitlab-pierre-return-button';
const SETTINGS_STORAGE_KEY = 'gitlabPierre.themeSettings';
const SETTINGS_PANEL_ID = 'gitlab-pierre-settings-panel';
const THEME_MODE_OPTIONS = ['system', 'light', 'dark'] as const satisfies readonly ThemeTypes[];
const DIFF_BACKGROUND_OPTIONS = ['theme', 'gitlab'] as const;
const PIERRE_DIFF_BASE_UNSAFE_CSS = `
pre, code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

[data-diffs-header] {
  min-height: 3rem;
  padding-inline: 1rem !important;
}

[data-header-content],
[data-title] {
  min-width: 0;
}

[data-title] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-code] {
  display: grid !important;
  grid-auto-flow: dense !important;
  grid-template-columns: max-content minmax(0, 1fr) !important;
  overflow: auto clip !important;
  tab-size: 2;
}

[data-gutter] {
  grid-column: 1 !important;
  width: max-content !important;
}

[data-content] {
  grid-column: 2 !important;
  min-width: 0 !important;
}

[data-gutter] [data-separator] {
  visibility: hidden;
}

[data-line],
[data-no-newline],
[data-line-annotation] {
  min-width: 0 !important;
  white-space: pre-wrap !important;
  overflow-wrap: anywhere !important;
}

[data-column-number],
[data-gutter-buffer] {
  box-sizing: content-box;
  min-width: var(--diffs-min-number-column-width, var(--diffs-min-number-column-width-default, 3ch));
  padding-left: 2ch;
  padding-right: 1ch;
  text-align: right;
  user-select: none;
}
`;
const PIERRE_DIFF_GITLAB_BACKGROUND_CSS = `
:host {
  --diffs-light-bg: var(--gl-background-color-default, #fff);
  --diffs-dark-bg: var(--gl-background-color-default, #fff);
  --diffs-bg-buffer-override: var(--gl-background-color-subtle, #f7f7f8);
  --diffs-bg-context-override: var(--gl-background-color-default, #fff);
  --diffs-bg-separator-override: var(--gl-background-color-subtle, #f7f7f8);
  --diffs-bg-hover-override: var(--gl-background-color-strong, #ececef);
}
`;
const PIERRE_TREE_UNSAFE_CSS = `
[data-file-tree-search-input] {
  height: 2.25rem !important;
  margin: 0.625rem 1rem 0.75rem !important;
  width: calc(100% - 2rem) !important;
}

[data-type='item'] {
  margin-inline: 0.875rem !important;
  width: calc(100% - 1.75rem) !important;
}
`;

interface ThemePreset {
  id: string;
  label: string;
  themes: Record<'dark' | 'light', DiffsThemeNames>;
}

const THEME_PRESETS = [
  {
    id: 'pierre',
    label: 'Pierre',
    themes: { dark: 'pierre-dark', light: 'pierre-light' },
  },
  {
    id: 'github',
    label: 'GitHub',
    themes: { dark: 'github-dark', light: 'github-light' },
  },
  {
    id: 'github-high-contrast',
    label: 'GitHub high contrast',
    themes: { dark: 'github-dark-high-contrast', light: 'github-light-high-contrast' },
  },
  {
    id: 'vs-code',
    label: 'VS Code',
    themes: { dark: 'dark-plus', light: 'light-plus' },
  },
  {
    id: 'solarized',
    label: 'Solarized',
    themes: { dark: 'solarized-dark', light: 'solarized-light' },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    themes: { dark: 'gruvbox-dark-medium', light: 'gruvbox-light-medium' },
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    themes: { dark: 'catppuccin-mocha', light: 'catppuccin-latte' },
  },
  {
    id: 'material',
    label: 'Material',
    themes: { dark: 'material-theme-ocean', light: 'material-theme-lighter' },
  },
] as const satisfies readonly ThemePreset[];

type ThemePresetId = (typeof THEME_PRESETS)[number]['id'];
type DiffBackgroundMode = (typeof DIFF_BACKGROUND_OPTIONS)[number];
type DiffViewMode = 'pierre' | 'gitlab';

interface PierreThemeSettings {
  backgroundMode: DiffBackgroundMode;
  presetId: ThemePresetId;
  themeType: ThemeTypes;
}

const THEME_PRESET_IDS = new Set<string>(THEME_PRESETS.map((preset) => preset.id));
const DEFAULT_THEME_SETTINGS: PierreThemeSettings = {
  backgroundMode: 'theme',
  presetId: 'pierre',
  themeType: 'system',
};

let mountState: MountState | null = null;
let scheduled = false;

function scheduleRun(): void {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => {
    scheduled = false;
    void run();
  }, 100);
}

async function run(): Promise<void> {
  const page = getChangesPage(window.location);
  if (page == null) {
    cleanUp();
    return;
  }

  if (mountState?.key === page.key) {
    return;
  }

  cleanUp();

  const targets = findMountTargets();
  if (targets == null) {
    return;
  }

  const shell = createShell(targets);
  const shellRoot = createRoot(shell);
  mountState = { key: page.key, roots: [shellRoot], targets };
  shellRoot.render(<LoadingState />);

  try {
    const patch = await fetchPatch(page.diffUrl);
    const parsed = parseGitPatch(patch, page.key);
    const nativeChrome = getNativeChangesChrome();

    if (parsed.files.length === 0) {
      throw new Error('The raw GitLab diff did not contain any changed files.');
    }

    hideNativeGitLabView(targets);
    shellRoot.render(<PierreChangesView nativeChrome={nativeChrome} parsed={parsed} />);
  } catch (error) {
    shellRoot.render(<ErrorState error={error} diffUrl={page.diffUrl} />);
  }
}

function getChangesPage(location: Location): GitLabChangesPage | null {
  const path = location.pathname;

  const mergeRequestMatch = path.match(/^(.*\/-\/merge_requests\/\d+)(?:\/diffs)?\/?$/);
  if (mergeRequestMatch?.[1] != null) {
    return {
      diffUrl: `${mergeRequestMatch[1]}.diff`,
      key: `${mergeRequestMatch[1]}${location.search}`,
      kind: 'merge-request',
    };
  }

  const commitMatch = path.match(/^(.*\/-\/commit\/[0-9a-f]{7,40})\/?$/i);
  if (commitMatch?.[1] != null) {
    return {
      diffUrl: `${commitMatch[1]}.diff`,
      key: `${commitMatch[1]}${location.search}`,
      kind: 'commit',
    };
  }

  const compareMatch = path.match(/^(.*\/-\/compare\/[^/]+)\/?$/);
  if (compareMatch?.[1] != null) {
    return {
      diffUrl: `${compareMatch[1]}.diff${location.search}`,
      key: `${compareMatch[1]}${location.search}`,
      kind: 'compare',
    };
  }

  return null;
}

function findMountTargets():
  | MountTargets
  | null {
  const diffContainer = queryFirstHTMLElement([
    '[data-testid="diffs"]',
    '.diffs',
    '.diff-files-holder',
    '.files',
  ]);

  if (diffContainer == null || diffContainer.closest(`[${EXTENSION_ATTR}]`) != null) {
    return null;
  }

  const treeContainer = queryFirstHTMLElement([
    '[data-testid="file-browser"]',
    '[data-testid="file-tree"]',
    '.file-tree-holder',
    '.diff-file-browser',
    '.tree-list-holder',
  ]);

  return { diffContainer, treeContainer };
}

interface MountTargets {
  diffContainer: HTMLElement;
  treeContainer: HTMLElement | null;
}

function queryFirstHTMLElement(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      return element;
    }
  }
  return null;
}

function createShell(targets: MountTargets): HTMLElement {
  const shell = document.createElement('section');
  shell.className = 'gitlab-pierre-shell';
  shell.setAttribute(EXTENSION_ATTR, 'shell');

  targets.diffContainer.insertAdjacentElement('beforebegin', shell);

  return shell;
}

async function fetchPatch(diffUrl: string): Promise<string> {
  const response = await fetch(diffUrl, {
    credentials: 'same-origin',
    headers: {
      Accept: 'text/x-diff,text/plain;q=0.9,*/*;q=0.1',
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab returned ${response.status} for ${diffUrl}`);
  }

  return response.text();
}

function parseGitPatch(patch: string, cacheKey: string): ParsedDiff {
  const files = processPatch(patch, cacheKey, true).files;
  const paths = Array.from(
    new Set(
      files
        .map((file) => normalizeDiffPath(file.name))
        .filter((path): path is string => path != null && path.length > 0)
    )
  );

  return { files, paths, stats: getDiffStats(files) };
}

function normalizeDiffPath(path: string | undefined): string | null {
  if (path == null) return null;
  return path.replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '');
}

function getDiffStats(files: FileDiffMetadata[]): DiffStats {
  return files.reduce<DiffStats>(
    (stats, file) => {
      for (const hunk of file.hunks) {
        stats.additions += hunk.additionLines;
        stats.deletions += hunk.deletionLines;
      }
      return stats;
    },
    { additions: 0, deletions: 0, files: files.length }
  );
}

function getNativeChangesChrome(): NativeChangesChrome {
  const commitLink = document.querySelector<HTMLAnchorElement>(
    '.mr-version-menus-container a.monospace.gl-link, .mr-version-menus-container a.monospace'
  );
  const latestLink = document.querySelector<HTMLAnchorElement>(
    '.mr-version-menus-container .js-latest-version'
  );

  return {
    commitHref: commitLink?.href ?? null,
    commitShortSha: commitLink?.textContent?.trim() ?? null,
    latestHref: latestLink?.href ?? null,
    latestText: latestLink?.textContent?.trim().replace(/\s+/g, ' ') ?? null,
  };
}

function hideNativeGitLabView(targets: MountTargets): void {
  targets.diffContainer.removeAttribute(COMMENT_MODE_ATTR);
  targets.diffContainer.classList.add(HIDDEN_CLASS);
  targets.diffContainer.setAttribute('aria-hidden', 'true');
  targets.treeContainer?.classList.add(HIDDEN_CLASS);
  targets.treeContainer?.setAttribute('aria-hidden', 'true');
  document.querySelector(`[${RETURN_BUTTON_ATTR}]`)?.remove();
}

function revealNativeGitLabView(targets: MountTargets): void {
  targets.diffContainer.classList.remove(HIDDEN_CLASS);
  targets.diffContainer.removeAttribute('aria-hidden');
  targets.treeContainer?.classList.remove(HIDDEN_CLASS);
  targets.treeContainer?.removeAttribute('aria-hidden');
}

function showNativeGitLabViewForCommenting(targets: MountTargets): void {
  revealNativeGitLabView(targets);
  targets.diffContainer.setAttribute(COMMENT_MODE_ATTR, 'true');
  showReturnToPierreButton(targets);
}

function cleanUp(): void {
  if (mountState != null) {
    for (const root of mountState.roots) {
      root.unmount();
    }
    mountState = null;
  }

  document.querySelectorAll(`[${EXTENSION_ATTR}]`).forEach((element) => {
    element.remove();
  });

  document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((element) => {
    element.classList.remove(HIDDEN_CLASS);
    element.removeAttribute('aria-hidden');
  });

  document.querySelectorAll(`[${TOAST_ATTR}], [${RETURN_BUTTON_ATTR}]`).forEach((element) => {
    element.remove();
  });
}

function PierreChangesView({
  nativeChrome,
  parsed,
}: {
  nativeChrome: NativeChangesChrome;
  parsed: ParsedDiff;
}): React.JSX.Element {
  const [themeSettings, setThemeSettings] = usePierreThemeSettings();
  const [viewMode, setViewMode] = useState<DiffViewMode>('pierre');
  const [fileBrowserView, setFileBrowserView] = useState<'tree' | 'list'>('tree');
  const [isFileBrowserVisible, setIsFileBrowserVisible] = useState(true);
  const [areDiffsCollapsed, setAreDiffsCollapsed] = useState(false);
  const diffThemeOptions = useMemo(() => getDiffThemeOptions(themeSettings), [themeSettings]);
  const unsafeCSS = useMemo(() => getPierreDiffUnsafeCSS(themeSettings), [themeSettings]);
  const isPierreView = viewMode === 'pierre';

  useEffect(() => {
    const targets = mountState?.targets;
    if (targets == null) return;

    if (viewMode === 'pierre') {
      hideNativeGitLabView(targets);
    } else {
      targets.diffContainer.removeAttribute(COMMENT_MODE_ATTR);
      document.querySelector(`[${RETURN_BUTTON_ATTR}]`)?.remove();
      revealNativeGitLabView(targets);
    }
  }, [viewMode]);

  return (
    <>
      <NativeLikeChangesToolbar
        areDiffsCollapsed={areDiffsCollapsed}
        isFileBrowserVisible={isFileBrowserVisible}
        isPierreView={isPierreView}
        nativeChrome={nativeChrome}
        onCollapseAll={() => setAreDiffsCollapsed(true)}
        onExpandAll={() => setAreDiffsCollapsed(false)}
        onToggleFileBrowser={() => setIsFileBrowserVisible((visible) => !visible)}
        onToggleView={() => setViewMode((mode) => (mode === 'pierre' ? 'gitlab' : 'pierre'))}
        settings={themeSettings}
        stats={parsed.stats}
        onSettingsChange={setThemeSettings}
      />
      <div
        className={`gitlab-pierre-layout${isFileBrowserVisible ? '' : ' gitlab-pierre-layout-no-sidebar'}`}
        hidden={!isPierreView}
      >
        <aside className="gitlab-pierre-sidebar" aria-label="Changed files" hidden={!isFileBrowserVisible}>
          <PierreFileBrowser
            paths={parsed.paths}
            view={fileBrowserView}
            onViewChange={setFileBrowserView}
          />
        </aside>
        <main className="gitlab-pierre-diffs" aria-label="File diffs">
          {parsed.files.map((file, index) => (
            <section
              className="gitlab-pierre-diff-card"
              data-gitlab-pierre-file={normalizeDiffPath(file.name) ?? file.name}
              key={`${file.name}:${file.prevName ?? ''}:${index}`}
            >
              <FileDiff
                disableWorkerPool
                fileDiff={file}
                key={`${themeSettings.presetId}:${themeSettings.themeType}:${themeSettings.backgroundMode}:${areDiffsCollapsed ? 'collapsed' : 'expanded'}`}
                renderGutterUtility={(getHoveredLine) => (
                  <LineCommentButton file={file} getHoveredLine={getHoveredLine} />
                )}
                options={{
                  collapsedContextThreshold: 12,
                  collapsed: areDiffsCollapsed,
                  diffStyle: 'unified',
                  enableGutterUtility: true,
                  onPostRender: ensurePierreDiffCoreStyles,
                  overflow: 'wrap',
                  theme: diffThemeOptions.theme,
                  themeType: diffThemeOptions.themeType,
                  unsafeCSS,
                }}
              />
            </section>
          ))}
        </main>
      </div>
    </>
  );
}

function NativeLikeChangesToolbar({
  areDiffsCollapsed,
  isFileBrowserVisible,
  isPierreView,
  nativeChrome,
  onCollapseAll,
  onExpandAll,
  onSettingsChange,
  onToggleFileBrowser,
  onToggleView,
  settings,
  stats,
}: {
  areDiffsCollapsed: boolean;
  isFileBrowserVisible: boolean;
  isPierreView: boolean;
  nativeChrome: NativeChangesChrome;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onSettingsChange: (settings: Partial<PierreThemeSettings>) => void;
  onToggleFileBrowser: () => void;
  onToggleView: () => void;
  settings: PierreThemeSettings;
  stats: DiffStats;
}): React.JSX.Element {
  return (
    <div className="gitlab-pierre-native-toolbar">
      <div className="gitlab-pierre-version-controls">
        <button
          aria-label={isFileBrowserVisible ? 'Hide file browser' : 'Show file browser'}
          aria-pressed={isFileBrowserVisible}
          className="gitlab-pierre-icon-button"
          onClick={onToggleFileBrowser}
          type="button"
        >
          <span className="gitlab-pierre-sidebar-icon" aria-hidden="true" />
        </button>
        {nativeChrome.commitShortSha != null ? (
          <div className="gitlab-pierre-commit-context">
            Viewing commit{' '}
            {nativeChrome.commitHref != null ? (
              <a className="monospace gl-link" href={nativeChrome.commitHref}>
                {nativeChrome.commitShortSha}
              </a>
            ) : (
              <span className="monospace">{nativeChrome.commitShortSha}</span>
            )}
          </div>
        ) : null}
        {nativeChrome.latestHref != null && nativeChrome.latestText != null ? (
          <a className="gitlab-pierre-native-button" href={nativeChrome.latestHref}>
            {nativeChrome.latestText}
          </a>
        ) : null}
      </div>

      <div className="gitlab-pierre-toolbar-actions">
        <DiffStatsSummary stats={stats} />
        <div className="gitlab-pierre-button-group" role="group" aria-label="Expand or collapse files">
          <button
            aria-label="Expand all files"
            className="gitlab-pierre-icon-button"
            disabled={!areDiffsCollapsed}
            onClick={onExpandAll}
            type="button"
          >
            <span aria-hidden="true">↧</span>
          </button>
          <button
            aria-label="Collapse all files"
            className="gitlab-pierre-icon-button"
            disabled={areDiffsCollapsed}
            onClick={onCollapseAll}
            type="button"
          >
            <span aria-hidden="true">↥</span>
          </button>
        </div>
        <button
          aria-pressed={!isPierreView}
          className="gitlab-pierre-native-button"
          onClick={onToggleView}
          type="button"
        >
          Show {isPierreView ? 'GitLab diffs' : 'Pierre diffs'}
        </button>
        <PierreSettingsMenu settings={settings} onChange={onSettingsChange} />
      </div>
    </div>
  );
}

function DiffStatsSummary({ stats }: { stats: DiffStats }): React.JSX.Element {
  return (
    <div className="gitlab-pierre-diff-stats" aria-label={`${stats.files} files changed, ${stats.additions} additions, ${stats.deletions} deletions`}>
      <span className="gitlab-pierre-diff-stats-files">{stats.files} {stats.files === 1 ? 'file' : 'files'}</span>
      <span className="gitlab-pierre-diff-stats-added">+ {stats.additions}</span>
      <span className="gitlab-pierre-diff-stats-deleted">− {stats.deletions}</span>
    </div>
  );
}

function PierreSettingsMenu({
  settings,
  onChange,
}: {
  settings: PierreThemeSettings;
  onChange: (settings: Partial<PierreThemeSettings>) => void;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activePreset = getThemePreset(settings.presetId);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node) === true) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="gitlab-pierre-settings" ref={menuRef}>
      <button
        aria-controls={SETTINGS_PANEL_ID}
        aria-expanded={isOpen}
        className="gitlab-pierre-settings-button"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        Theme: {activePreset.label}
      </button>
      {isOpen ? (
        <div
          aria-label="Pierre appearance settings"
          className="gitlab-pierre-settings-panel"
          id={SETTINGS_PANEL_ID}
          role="group"
        >
          <label className="gitlab-pierre-settings-field">
            <span>Theme</span>
            <select
              value={settings.presetId}
              onChange={(event) => {
                onChange({ presetId: event.currentTarget.value as ThemePresetId });
              }}
            >
              {THEME_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="gitlab-pierre-settings-field">
            <span>Mode</span>
            <select
              value={settings.themeType}
              onChange={(event) => {
                onChange({ themeType: event.currentTarget.value as ThemeTypes });
              }}
            >
              {THEME_MODE_OPTIONS.map((themeType) => (
                <option key={themeType} value={themeType}>
                  {formatThemeMode(themeType)}
                </option>
              ))}
            </select>
          </label>
          <label className="gitlab-pierre-settings-field">
            <span>Diff background</span>
            <select
              value={settings.backgroundMode}
              onChange={(event) => {
                onChange({ backgroundMode: event.currentTarget.value as DiffBackgroundMode });
              }}
            >
              <option value="theme">Theme background</option>
              <option value="gitlab">GitLab background</option>
            </select>
          </label>
          <p className="gitlab-pierre-settings-help">Changes apply immediately.</p>
        </div>
      ) : null}
    </div>
  );
}

function usePierreThemeSettings(): [
  PierreThemeSettings,
  (settings: Partial<PierreThemeSettings>) => void,
] {
  const [settings, setSettings] = useState<PierreThemeSettings>(DEFAULT_THEME_SETTINGS);

  useEffect(() => {
    let isMounted = true;
    readStoredThemeSettings()
      .then((storedSettings) => {
        if (isMounted) {
          setSettings(storedSettings);
        }
      })
      .catch((error: unknown) => {
        console.error('[GitLab Pierre] Failed to load theme settings.', error);
        showToast('Could not load Pierre theme settings. Using the default theme.', 'warning');
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const updateSettings = useCallback((partialSettings: Partial<PierreThemeSettings>) => {
    setSettings((currentSettings) => {
      const nextSettings = normalizeThemeSettings({
        ...currentSettings,
        ...partialSettings,
      });

      void writeStoredThemeSettings(nextSettings).catch((error: unknown) => {
        console.error('[GitLab Pierre] Failed to save theme settings.', error);
        showToast('Could not save Pierre theme settings.', 'warning');
      });

      return nextSettings;
    });
  }, []);

  return [settings, updateSettings];
}

function getDiffThemeOptions(settings: PierreThemeSettings): {
  theme: Record<'dark' | 'light', DiffsThemeNames>;
  themeType: ThemeTypes;
} {
  return {
    theme: getThemePreset(settings.presetId).themes,
    themeType: settings.themeType,
  };
}

function getPierreDiffUnsafeCSS(settings: PierreThemeSettings): string {
  if (settings.backgroundMode === 'gitlab') {
    return `${PIERRE_DIFF_BASE_UNSAFE_CSS}\n${PIERRE_DIFF_GITLAB_BACKGROUND_CSS}`;
  }

  return PIERRE_DIFF_BASE_UNSAFE_CSS;
}

function getThemePreset(presetId: ThemePresetId): ThemePreset {
  return THEME_PRESETS.find((preset) => preset.id === presetId) ?? THEME_PRESETS[0];
}

function formatThemeMode(themeType: ThemeTypes): string {
  if (themeType === 'system') return 'System';
  if (themeType === 'light') return 'Light';
  return 'Dark';
}

function readStoredThemeSettings(): Promise<PierreThemeSettings> {
  const storage = getChromeLocalStorage();
  if (storage == null) {
    return Promise.resolve(DEFAULT_THEME_SETTINGS);
  }

  return new Promise((resolve, reject) => {
    storage.get(SETTINGS_STORAGE_KEY, (items) => {
      const lastError = chrome.runtime.lastError;
      if (lastError != null) {
        reject(new Error(lastError.message));
        return;
      }

      resolve(normalizeThemeSettings(items[SETTINGS_STORAGE_KEY]));
    });
  });
}

function writeStoredThemeSettings(settings: PierreThemeSettings): Promise<void> {
  const storage = getChromeLocalStorage();
  if (storage == null) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    storage.set({ [SETTINGS_STORAGE_KEY]: settings }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError != null) {
        reject(new Error(lastError.message));
        return;
      }

      resolve();
    });
  });
}

function getChromeLocalStorage(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome === 'undefined' || chrome.storage?.local == null) {
    console.warn('[GitLab Pierre] chrome.storage.local is unavailable; using default theme settings.');
    return null;
  }

  return chrome.storage.local;
}

function normalizeThemeSettings(value: unknown): PierreThemeSettings {
  if (!isRecord(value)) {
    return DEFAULT_THEME_SETTINGS;
  }

  const presetId = isThemePresetId(value.presetId)
    ? value.presetId
    : DEFAULT_THEME_SETTINGS.presetId;
  const themeType = isThemeType(value.themeType)
    ? value.themeType
    : DEFAULT_THEME_SETTINGS.themeType;
  const backgroundMode = isDiffBackgroundMode(value.backgroundMode)
    ? value.backgroundMode
    : DEFAULT_THEME_SETTINGS.backgroundMode;

  return { backgroundMode, presetId, themeType };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && THEME_PRESET_IDS.has(value);
}

function isThemeType(value: unknown): value is ThemeTypes {
  return (
    typeof value === 'string' &&
    THEME_MODE_OPTIONS.some((themeType) => themeType === value)
  );
}

function isDiffBackgroundMode(value: unknown): value is DiffBackgroundMode {
  return (
    typeof value === 'string' &&
    DIFF_BACKGROUND_OPTIONS.some((backgroundMode) => backgroundMode === value)
  );
}

function ensurePierreDiffCoreStyles(container: HTMLElement): void {
  const shadowRoot = container.shadowRoot;
  if (shadowRoot == null) return;

  let style = shadowRoot.querySelector<HTMLStyleElement>(
    `style[${DIFF_CORE_STYLE_ATTR}]`
  );
  if (style == null) {
    style = document.createElement('style');
    style.setAttribute(DIFF_CORE_STYLE_ATTR, '');
    shadowRoot.prepend(style);
  }

  if (style.textContent !== diffCoreStyles) {
    style.textContent = diffCoreStyles;
  }
}

function LineCommentButton({
  file,
  getHoveredLine,
}: {
  file: FileDiffMetadata;
  getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined;
}): React.JSX.Element {
  return (
    <button
      className="gitlab-pierre-line-comment-button"
      type="button"
      aria-label="Comment on this line"
      title="Comment on this line"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();

        const hoveredLine = getHoveredLine();
        if (hoveredLine == null) {
          showToast('Hover a diff line before adding a comment.', 'warning');
          return;
        }

        openNativeCommentForLine(file, hoveredLine);
      }}
    >
      +
    </button>
  );
}

function openNativeCommentForLine(
  file: FileDiffMetadata,
  hoveredLine: GetHoveredLineResult<'diff'>
): void {
  const targets = mountState?.targets;
  if (targets == null) {
    showToast('GitLab comment controls are not available yet.', 'error');
    return;
  }

  const nativeCommentButton = findNativeCommentButton(file, hoveredLine);
  if (nativeCommentButton == null) {
    showToast('Could not find GitLab’s native comment control for this line.', 'error');
    return;
  }

  showNativeGitLabViewForCommenting(targets);
  nativeCommentButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
  nativeCommentButton.click();
  showToast('Opened GitLab’s native comment editor for this line.', 'success');
}

function findNativeCommentButton(
  file: FileDiffMetadata,
  hoveredLine: GetHoveredLineResult<'diff'>
): HTMLElement | null {
  const side = hoveredLine.side === 'additions' ? 'right' : 'left';
  const filePaths = getDiffFilePaths(file);
  const nativeFiles = findNativeDiffFiles(filePaths);

  for (const nativeFile of nativeFiles) {
    const button = findNativeCommentButtonInFile(nativeFile, hoveredLine.lineNumber, side);
    if (button != null) {
      return button;
    }
  }

  return null;
}

function getDiffFilePaths(file: FileDiffMetadata): string[] {
  return Array.from(
    new Set(
      [file.name, file.prevName]
        .map((path) => normalizeDiffPath(path))
        .filter((path): path is string => path != null && path.length > 0)
    )
  );
}

function findNativeDiffFiles(paths: string[]): HTMLElement[] {
  const diffFiles = Array.from(document.querySelectorAll<HTMLElement>('.diff-file'));
  return diffFiles.filter((diffFile) => nativeDiffFileMatchesPath(diffFile, paths));
}

function nativeDiffFileMatchesPath(diffFile: HTMLElement, paths: string[]): boolean {
  const values = [
    diffFile.dataset.filePath,
    diffFile.dataset.newPath,
    diffFile.dataset.oldPath,
    diffFile.dataset.path,
    diffFile.getAttribute('data-file-path'),
    diffFile.getAttribute('data-new-path'),
    diffFile.getAttribute('data-old-path'),
    diffFile.querySelector<HTMLElement>('[data-file-path]')?.dataset.filePath,
    diffFile.querySelector<HTMLElement>('[data-new-path]')?.dataset.newPath,
    diffFile.querySelector<HTMLElement>('[data-old-path]')?.dataset.oldPath,
  ]
    .map((value) => normalizeDiffPath(value ?? undefined))
    .filter((value): value is string => value != null);

  const titleText = diffFile
    .querySelector('.file-title-name, .diff-file-title, [data-testid="file-title"]')
    ?.textContent?.trim();
  if (titleText != null) {
    values.push(normalizeDiffPath(titleText) ?? titleText);
  }

  return paths.some((path) => values.some((value) => value === path || value.endsWith(`/${path}`)));
}

function findNativeCommentButtonInFile(
  nativeFile: HTMLElement,
  lineNumber: number,
  side: 'left' | 'right'
): HTMLElement | null {
  const escapedLineNumber = CSS.escape(String(lineNumber));
  const sideSelectors =
    side === 'right'
      ? [
          `[data-testid="right-side"] a[data-linenumber="${escapedLineNumber}"]`,
          `.diff-grid-right a[data-linenumber="${escapedLineNumber}"]`,
          `.right-side a[data-linenumber="${escapedLineNumber}"]`,
          `.new_line a[data-linenumber="${escapedLineNumber}"]`,
        ]
      : [
          `[data-testid="left-side"] a[data-linenumber="${escapedLineNumber}"]`,
          `.diff-grid-left a[data-linenumber="${escapedLineNumber}"]`,
          `.left-side a[data-linenumber="${escapedLineNumber}"]`,
          `.old_line a[data-linenumber="${escapedLineNumber}"]`,
        ];

  for (const selector of sideSelectors) {
    for (const lineAnchor of Array.from(nativeFile.querySelectorAll<HTMLElement>(selector))) {
      const button = findCommentButtonNearLineAnchor(lineAnchor, side);
      if (button != null) {
        return button;
      }
    }
  }

  return null;
}

function findCommentButtonNearLineAnchor(
  lineAnchor: HTMLElement,
  side: 'left' | 'right'
): HTMLElement | null {
  const scopes = [
    lineAnchor.closest(side === 'right' ? '.diff-grid-right' : '.diff-grid-left'),
    lineAnchor.closest(side === 'right' ? '[data-testid="right-side"]' : '[data-testid="left-side"]'),
    lineAnchor.closest('.diff-line-num'),
    lineAnchor.closest('.line_holder'),
    lineAnchor.parentElement,
  ];

  for (const scope of scopes) {
    if (!(scope instanceof HTMLElement)) continue;
    const button = scope.querySelector<HTMLElement>('.js-add-diff-note-button');
    if (button != null && !isDisabledButton(button)) {
      return button;
    }
  }

  return null;
}

function isDisabledButton(button: HTMLElement): boolean {
  return (
    button.hasAttribute('disabled') ||
    button.getAttribute('aria-disabled') === 'true' ||
    button.classList.contains('disabled')
  );
}

function showReturnToPierreButton(targets: MountTargets): void {
  if (document.querySelector(`[${RETURN_BUTTON_ATTR}]`) != null) return;

  const button = document.createElement('button');
  button.className = 'gitlab-pierre-return-button';
  button.type = 'button';
  button.setAttribute(RETURN_BUTTON_ATTR, 'true');
  button.textContent = 'Return to Pierre view';
  button.addEventListener('click', () => {
    targets.diffContainer.removeAttribute(COMMENT_MODE_ATTR);
    hideNativeGitLabView(targets);
    document.querySelector(`[${RETURN_BUTTON_ATTR}]`)?.remove();
    document.querySelector(`[${EXTENSION_ATTR}="shell"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  });

  document.body.append(button);
}

function showToast(message: string, kind: 'error' | 'success' | 'warning'): void {
  document.querySelector(`[${TOAST_ATTR}]`)?.remove();

  const toast = document.createElement('div');
  toast.className = `gitlab-pierre-toast gitlab-pierre-toast-${kind}`;
  toast.setAttribute(TOAST_ATTR, 'true');
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  document.body.append(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 4000);
}

function PierreFileBrowser({
  onViewChange,
  paths,
  view,
}: {
  onViewChange: (view: 'tree' | 'list') => void;
  paths: string[];
  view: 'tree' | 'list';
}): React.JSX.Element {
  return (
    <div className="gitlab-pierre-file-browser">
      <div className="gitlab-pierre-file-browser-header">
        <span>Files</span>
        <div className="gitlab-pierre-file-browser-switch" role="group" aria-label="File browser view">
          <button
            aria-pressed={view === 'tree'}
            onClick={() => onViewChange('tree')}
            type="button"
          >
            Tree
          </button>
          <button
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
            type="button"
          >
            List
          </button>
        </div>
      </div>
      {view === 'tree' ? <PierreFileTree paths={paths} /> : <PierreFileList paths={paths} />}
    </div>
  );
}

function PierreFileTree({ paths }: { paths: string[] }): React.JSX.Element {
  const model = useMemo(
    () =>
      new FileTreeModel({
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        onSelectionChange: ([selectedPath]) => {
          if (selectedPath == null) return;
          scrollToFile(selectedPath);
        },
        paths,
        search: true,
        unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
      }),
    [paths]
  );

  useEffect(() => {
    return () => {
      model.cleanUp();
    };
  }, [model]);

  return (
    <FileTree
      className="gitlab-pierre-tree"
      model={model}
    />
  );
}

function PierreFileList({ paths }: { paths: string[] }): React.JSX.Element {
  return (
    <div className="gitlab-pierre-file-list" role="list">
      {paths.map((path) => (
        <button
          className="gitlab-pierre-file-list-item"
          key={path}
          onClick={() => scrollToFile(path)}
          role="listitem"
          title={path}
          type="button"
        >
          <span>{path}</span>
        </button>
      ))}
    </div>
  );
}

function scrollToFile(path: string): void {
  const target = document.querySelector(
    `[data-gitlab-pierre-file="${CSS.escape(path)}"]`
  );
  if (target instanceof HTMLElement) {
    target.scrollIntoView({ block: 'start' });
  }
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="gitlab-pierre-state" role="status">
      Loading Pierre diff view…
    </div>
  );
}

function ErrorState({
  diffUrl,
  error,
}: {
  diffUrl: string;
  error: unknown;
}): React.JSX.Element {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="gitlab-pierre-state gitlab-pierre-state-error" role="alert">
      <strong>Unable to render the Pierre diff view.</strong>
      <span>{message}</span>
      <a href={diffUrl}>Open raw diff</a>
    </div>
  );
}

const observer = new MutationObserver(scheduleRun);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

window.addEventListener('popstate', scheduleRun);
window.addEventListener('hashchange', scheduleRun);
scheduleRun();
