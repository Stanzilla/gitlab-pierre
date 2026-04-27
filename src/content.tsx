import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  | { diffUrl: string; key: string; kind: 'merge-request' }
  | { diffUrl: string; key: string; kind: 'commit' }
  | { diffUrl: string; key: string; kind: 'compare' };

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

interface FileStats {
  additions: number;
  deletions: number;
}

interface NativeChangesChrome {
  commitHref: string | null;
  commitShortSha: string | null;
  latestHref: string | null;
  latestText: string | null;
}

interface MountTargets {
  diffContainer: HTMLElement;
  treeContainer: HTMLElement | null;
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
const FILE_TREE_WIDTH_PX = 320;

const PIERRE_DIFF_BASE_UNSAFE_CSS = `
pre, code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

[data-diffs-header] {
  display: none !important;
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
:host {
  --trees-border-color-override: transparent;
  --trees-fg-override: var(--gl-text-color-default, #1f1e24);
  --trees-selected-bg-override: var(--gl-background-color-strong, #ececef);
  --trees-selected-fg-override: var(--gl-text-color-default, #1f1e24);
}

[data-file-tree-search-input] {
  display: none !important;
}

[data-type='item'] {
  margin-inline: 0 !important;
  padding-inline: 0.5rem !important;
  width: 100% !important;
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
type FileBrowserView = 'tree' | 'list';

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

function findMountTargets(): MountTargets | null {
  const diffContainer = queryFirstHTMLElement([
    '[data-testid="diffs"]',
    '#diffs',
    '.diffs',
    '.diff-files-holder',
    '.files',
  ]);

  if (diffContainer == null || diffContainer.closest(`[${EXTENSION_ATTR}]`) != null) {
    return null;
  }

  const treeContainer = queryFirstHTMLElement([
    '[data-testid="file-browser"]',
    '[data-testid="file-tree-container"]',
    '.diff-tree-list',
    '.tree-list-holder',
    '.file-tree-holder',
    '.diff-file-browser',
  ]);

  return { diffContainer, treeContainer };
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
      const fileStats = getFileStats(file);
      stats.additions += fileStats.additions;
      stats.deletions += fileStats.deletions;
      return stats;
    },
    { additions: 0, deletions: 0, files: files.length }
  );
}

function getFileStats(file: FileDiffMetadata): FileStats {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
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
  document.querySelector(`[${RETURN_BUTTON_ATTR}]`)?.remove();
}

function revealNativeGitLabView(targets: MountTargets): void {
  targets.diffContainer.classList.remove(HIDDEN_CLASS);
  targets.diffContainer.removeAttribute('aria-hidden');
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

const IconSpriteContext = createContext<string>('');

function getIconSpriteUrl(): string {
  const useEl = document.querySelector('use[href*="/assets/icons-"]');
  if (useEl != null) {
    const href = useEl.getAttribute('href') ?? '';
    const hashIdx = href.indexOf('#');
    return hashIdx === -1 ? href : href.slice(0, hashIdx);
  }
  return '';
}

function GlIcon({
  name,
  size = 16,
  className = '',
  testid,
}: {
  className?: string;
  name: string;
  size?: 12 | 16 | 24;
  testid?: string;
}): React.JSX.Element {
  const sprite = useContext(IconSpriteContext);
  return (
    <svg
      aria-hidden="true"
      className={`gl-icon s${size} gl-fill-current${className ? ` ${className}` : ''}`}
      data-testid={testid}
      height={size}
      width={size}
    >
      {sprite !== '' ? <use href={`${sprite}#${name}`} /> : null}
    </svg>
  );
}

function ChevronToggleIcon({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="gl-button-icon"
      fill="none"
      height={16}
      viewBox="0 0 16 16"
      width={16}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={collapsed ? 'M6.75 4.75L10 8L6.75 11.25' : 'M4.75 6.75L8 10L11.25 6.75'}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function SidebarToggleIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="gl-button-icon"
      fill="none"
      height={16}
      viewBox="0 0 16 16"
      width={16}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        height={12.5}
        rx={1.25}
        stroke="currentColor"
        strokeWidth={1.5}
        width={12.5}
        x={1.75}
        y={1.75}
      />
      <path d="M5.25 2V14" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
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
  const [fileBrowserView, setFileBrowserView] = useState<FileBrowserView>('tree');
  const [isFileBrowserVisible, setIsFileBrowserVisible] = useState(true);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const spriteUrl = useMemo(() => getIconSpriteUrl(), []);
  const diffThemeOptions = useMemo(() => getDiffThemeOptions(themeSettings), [themeSettings]);
  const unsafeCSS = useMemo(() => getPierreDiffUnsafeCSS(themeSettings), [themeSettings]);
  const isPierreView = viewMode === 'pierre';

  const toggleFile = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);
  const expandAll = useCallback(() => setCollapsedPaths(new Set()), []);
  const collapseAll = useCallback(
    () => setCollapsedPaths(new Set(parsed.paths)),
    [parsed.paths]
  );

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
    <IconSpriteContext.Provider value={spriteUrl}>
      <div className="mr-version-controls" data-gitlab-pierre="toolbar">
        <div className="mr-version-menus-container gl-px-5 gl-pb-2 gl-pt-3 gitlab-pierre-toolbar">
          <button
            aria-label={isFileBrowserVisible ? 'Hide file browser' : 'Show file browser'}
            aria-pressed={isFileBrowserVisible}
            className={`btn-icon gl-mr-3 btn gl-button btn-default btn-md${isFileBrowserVisible ? ' selected' : ''}`}
            onClick={() => setIsFileBrowserVisible((visible) => !visible)}
            type="button"
          >
            <span className="gl-button-text">
              <SidebarToggleIcon />
            </span>
          </button>

          <PierreVersionContext nativeChrome={nativeChrome} />

          <div className="diff-stats inline-parallel-buttons !gl-ml-auto gl-p-0 is-compare-versions-header gl-hidden @md/panel:gl-inline-flex">
            <div className="diff-stats-contents">
              <div className="diff-stats-group">
                <GlIcon
                  className="diff-stats-icon gl-fill-icon-subtle"
                  name="doc-code"
                  testid="doc-code-icon"
                />
                <span className="gl-font-bold gl-text-subtle">
                  {parsed.stats.files} {parsed.stats.files === 1 ? 'file' : 'files'}
                </span>
              </div>
              <div
                aria-label={`Added ${parsed.stats.additions} lines. Removed ${parsed.stats.deletions} lines.`}
                className="gl-flex"
              >
                <div className="diff-stats-group gl-flex gl-items-center gl-text-success gl-font-bold">
                  <span>+</span> <span>{parsed.stats.additions}</span>
                </div>
                <div className="diff-stats-group gl-flex gl-items-center gl-text-danger gl-font-bold">
                  <span>−</span> <span>{parsed.stats.deletions}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="gitlab-pierre-toolbar-actions gl-flex gl-items-center gl-gap-2">
            <div className="btn-group gl-button-group" role="group">
              <button
                aria-label="Expand all files"
                className="btn gl-button btn-default btn-md btn-icon"
                disabled={collapsedPaths.size === 0}
                onClick={expandAll}
                type="button"
                title="Expand all files"
              >
                <ChevronToggleIcon collapsed={false} />
              </button>
              <button
                aria-label="Collapse all files"
                className="btn gl-button btn-default btn-md btn-icon"
                disabled={collapsedPaths.size === parsed.paths.length}
                onClick={collapseAll}
                type="button"
                title="Collapse all files"
              >
                <ChevronToggleIcon collapsed />
              </button>
            </div>
            <button
              aria-pressed={!isPierreView}
              className="btn gl-button btn-default btn-md"
              onClick={() => setViewMode((mode) => (mode === 'pierre' ? 'gitlab' : 'pierre'))}
              type="button"
            >
              <span className="gl-button-text">
                Show {isPierreView ? 'GitLab diffs' : 'Pierre diffs'}
              </span>
            </button>
            <PierreSettingsMenu onChange={setThemeSettings} settings={themeSettings} />
          </div>
        </div>
      </div>

      <div
        className={`gl-flex gl-flex-wrap gitlab-pierre-layout${isFileBrowserVisible ? '' : ' gitlab-pierre-layout-no-sidebar'}`}
        hidden={!isPierreView}
      >
        <PierreFileBrowser
          fileCount={parsed.stats.files}
          hidden={!isFileBrowserVisible}
          onViewChange={setFileBrowserView}
          paths={parsed.paths}
          view={fileBrowserView}
        />
        <div className="diffs-batch gitlab-pierre-diffs-area" data-gitlab-pierre="diffs-area">
          {parsed.files.map((file, index) => {
            const path = normalizeDiffPath(file.name) ?? file.name;
            return (
              <PierreDiffFile
                areDiffsCollapsed={collapsedPaths.has(path)}
                file={file}
                key={`${path}:${file.prevName ?? ''}:${index}`}
                onToggle={() => toggleFile(path)}
                path={path}
                themeOptions={diffThemeOptions}
                themeSettingsKey={`${themeSettings.presetId}:${themeSettings.themeType}:${themeSettings.backgroundMode}`}
                unsafeCSS={unsafeCSS}
              />
            );
          })}
        </div>
      </div>
    </IconSpriteContext.Provider>
  );
}

function PierreVersionContext({
  nativeChrome,
}: {
  nativeChrome: NativeChangesChrome;
}): React.JSX.Element | null {
  if (nativeChrome.commitShortSha == null && nativeChrome.latestHref == null) {
    return null;
  }

  return (
    <div className="gl-flex gl-items-center gl-gap-3 gl-text-subtle">
      {nativeChrome.commitShortSha != null ? (
        <span className="gl-flex gl-items-center gl-gap-2">
          <span>Viewing commit</span>
          {nativeChrome.commitHref != null ? (
            <a className="monospace gl-link" href={nativeChrome.commitHref}>
              {nativeChrome.commitShortSha}
            </a>
          ) : (
            <span className="monospace">{nativeChrome.commitShortSha}</span>
          )}
        </span>
      ) : null}
      {nativeChrome.latestHref != null && nativeChrome.latestText != null ? (
        <a className="btn gl-button btn-default btn-sm" href={nativeChrome.latestHref}>
          <span className="gl-button-text">{nativeChrome.latestText}</span>
        </a>
      ) : null}
    </div>
  );
}

function PierreFileBrowser({
  fileCount,
  hidden,
  onViewChange,
  paths,
  view,
}: {
  fileCount: number;
  hidden: boolean;
  onViewChange: (view: FileBrowserView) => void;
  paths: string[];
  view: FileBrowserView;
}): React.JSX.Element {
  return (
    <div
      className="rd-app-sidebar diff-tree-list gl-px-5"
      data-gitlab-pierre="file-browser"
      hidden={hidden}
      style={{ width: `${FILE_TREE_WIDTH_PX}px` }}
    >
      <div className="diff-tree-list-floating-wrapper">
        <section
          aria-labelledby="gitlab-pierre-tree-list-title"
          className="tree-list-holder gl-flex gl-flex-col"
          data-testid="file-tree-container"
        >
          <div className="gl-mb-3 gl-flex gl-items-center">
            <h2
              aria-label="File browser"
              className="gl-my-0 gl-inline-block gl-text-base"
              id="gitlab-pierre-tree-list-title"
            >
              Files
            </h2>
            <span
              aria-hidden="true"
              className="gl-ml-2 gl-badge badge badge-pill badge-neutral"
            >
              <span className="gl-badge-content">{fileCount}</span>
            </span>
            <div className="gl-ml-auto gl-button-group btn-group" role="group">
              <button
                aria-label="List view"
                aria-pressed={view === 'list'}
                className={`btn gl-button btn-default btn-md btn-icon${view === 'list' ? ' selected' : ''}`}
                onClick={() => onViewChange('list')}
                title="List view"
                type="button"
              >
                <GlIcon name="list-bulleted" testid="list-bulleted-icon" />
              </button>
              <button
                aria-label="Tree view"
                aria-pressed={view === 'tree'}
                className={`btn gl-button btn-default btn-md btn-icon${view === 'tree' ? ' selected' : ''}`}
                onClick={() => onViewChange('tree')}
                title="Tree view"
                type="button"
              >
                <GlIcon name="file-tree" testid="file-tree-icon" />
              </button>
            </div>
          </div>
          <nav aria-label="File tree" className="mr-tree-list">
            {view === 'tree' ? (
              <PierreFileTree paths={paths} />
            ) : (
              <PierreFileList paths={paths} />
            )}
          </nav>
        </section>
      </div>
    </div>
  );
}

function PierreDiffFile({
  areDiffsCollapsed,
  file,
  onToggle,
  path,
  themeOptions,
  themeSettingsKey,
  unsafeCSS,
}: {
  areDiffsCollapsed: boolean;
  file: FileDiffMetadata;
  onToggle: () => void;
  path: string;
  themeOptions: { theme: Record<'dark' | 'light', DiffsThemeNames>; themeType: ThemeTypes };
  themeSettingsKey: string;
  unsafeCSS: string;
}): React.JSX.Element {
  const stats = useMemo(() => getFileStats(file), [file]);
  const fileId = `gitlab-pierre-file-${hashPath(path)}`;
  const contentId = `gitlab-pierre-content-${hashPath(path)}`;

  return (
    <div
      className="diff-file file-holder has-body"
      data-gitlab-pierre-file={path}
      data-path={path}
      id={fileId}
    >
      <div
        className="js-file-title file-title file-title-flex-parent gl-rounded-bl-none gl-rounded-br-none !gl-border-0"
        data-testid="file-title-container"
      >
        <div className="file-header-content">
          <button
            aria-controls={contentId}
            aria-expanded={!areDiffsCollapsed}
            aria-label={areDiffsCollapsed ? 'Show file contents' : 'Hide file contents'}
            className="btn-icon gl-mr-2 btn gl-button btn-default btn-sm btn-default-tertiary"
            onClick={onToggle}
            type="button"
          >
            <span className="gl-button-text">
              <ChevronToggleIcon collapsed={areDiffsCollapsed} />
            </span>
          </button>
          <a
            className="gl-mr-2 gl-break-all !gl-no-underline"
            href={`#${fileId}`}
          >
            <strong className="file-title-name" data-testid="file-name-content" title={path}>
              {path}
            </strong>
          </a>
          <button
            aria-label="Copy file path"
            className="btn gl-button btn-default btn-sm btn-default-tertiary btn-icon"
            data-testid="diff-file-copy-clipboard"
            onClick={() => copyToClipboard(path)}
            title="Copy file path"
            type="button"
          >
            <GlIcon name="copy-to-clipboard" testid="copy-to-clipboard-icon" />
          </button>
        </div>
        <div className="file-actions gl-ml-auto gl-flex gl-items-center gl-self-start">
          <div className="diff-stats gl-hidden @sm/panel:!gl-inline-flex">
            <div className="diff-stats-contents">
              <div
                aria-label={`Added ${stats.additions} lines. Removed ${stats.deletions} lines.`}
                className="gl-flex"
              >
                <div className="diff-stats-group gl-flex gl-items-center gl-text-success gl-font-bold">
                  <span>+</span> <span>{stats.additions}</span>
                </div>
                <div className="diff-stats-group gl-flex gl-items-center gl-text-danger gl-font-bold">
                  <span>−</span> <span>{stats.deletions}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        className="diff-content gl-rounded-none gl-rounded-bl-lg gl-rounded-br-lg gl-border-0"
        data-testid="content-area"
        hidden={areDiffsCollapsed}
        id={contentId}
      >
        <FileDiff
          disableWorkerPool
          fileDiff={file}
          key={`${themeSettingsKey}:${areDiffsCollapsed ? 'c' : 'e'}`}
          options={{
            collapsedContextThreshold: 12,
            collapsed: false,
            diffStyle: 'unified',
            enableGutterUtility: true,
            onPostRender: ensurePierreDiffCoreStyles,
            overflow: 'wrap',
            theme: themeOptions.theme,
            themeType: themeOptions.themeType,
            unsafeCSS,
          }}
          renderGutterUtility={(getHoveredLine) => (
            <LineCommentButton file={file} getHoveredLine={getHoveredLine} />
          )}
        />
      </div>
    </div>
  );
}

function hashPath(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function copyToClipboard(text: string): void {
  navigator.clipboard?.writeText(text).then(
    () => showToast('File path copied.', 'success'),
    () => showToast('Could not copy file path.', 'error')
  );
}

function PierreSettingsMenu({
  onChange,
  settings,
}: {
  onChange: (settings: Partial<PierreThemeSettings>) => void;
  settings: PierreThemeSettings;
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
        className="btn gl-button btn-default btn-md gl-dropdown-toggle"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <span className="gl-button-text gl-flex gl-items-center gl-gap-2">
          <span>Theme: {activePreset.label}</span>
          <GlIcon className="dropdown-chevron" name="chevron-down" testid="chevron-down-icon" />
        </span>
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
              className="gl-form-input form-control"
              onChange={(event) => {
                onChange({ presetId: event.currentTarget.value as ThemePresetId });
              }}
              value={settings.presetId}
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
              className="gl-form-input form-control"
              onChange={(event) => {
                onChange({ themeType: event.currentTarget.value as ThemeTypes });
              }}
              value={settings.themeType}
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
              className="gl-form-input form-control"
              onChange={(event) => {
                onChange({ backgroundMode: event.currentTarget.value as DiffBackgroundMode });
              }}
              value={settings.backgroundMode}
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
      aria-label="Comment on this line"
      className="gitlab-pierre-line-comment-button"
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
      title="Comment on this line"
      type="button"
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
  const diffFiles = Array.from(
    document.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS} .diff-file, .gitlab-pierre-native-hidden .diff-file`)
  );
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
  button.className = 'btn gl-button btn-confirm btn-md gitlab-pierre-return-button';
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

  return <FileTree className="gitlab-pierre-tree" model={model} />;
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
