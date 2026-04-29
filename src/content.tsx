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
  type AnnotationSide,
  type DiffLineAnnotation,
  type DiffsThemeNames,
  type FileDiffMetadata,
  type GetHoveredLineResult,
  type SelectedLineRange,
  type ThemeTypes,
} from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { FileTree } from '@pierre/trees/react';
import {
  FileTree as FileTreeModel,
  type FileTreeRowDecorationContext,
  type GitStatus,
  type GitStatusEntry,
} from '@pierre/trees';
import diffCoreStyles from '@pierre-diffs-core-style';

import './styles.css';

type GitLabChangesPage =
  | { diffUrl: string; key: string; kind: 'merge-request' }
  | { diffUrl: string; key: string; kind: 'commit' }
  | { diffUrl: string; key: string; kind: 'compare' };

interface ParsedDiff {
  fileInfoByPath: Map<string, FileBrowserFileInfo>;
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

interface FileBrowserFileInfo {
  stats: FileStats;
  status: GitStatus;
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
const FILE_TREE_WIDTH_PX = 288;

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

[data-gutter] [data-separator]:not([data-separator='line-info']) {
  visibility: hidden;
}

[data-gutter] [data-separator='line-info'] {
  visibility: visible !important;
  overflow: hidden;
}

[data-gutter] [data-separator='line-info'] [data-separator-wrapper] {
  display: grid !important;
  visibility: visible !important;
  inset-inline: 0 !important;
  grid-template-columns: minmax(0, 1fr) !important;
  box-sizing: border-box;
  max-width: 100% !important;
  width: 100%;
  padding-inline: 0 !important;
  height: 32px;
  align-items: stretch;
  background: var(--gl-background-color-subtle, var(--diffs-bg-separator));
  border-bottom: 1px solid var(--gl-border-color-default, color-mix(in srgb, currentColor 18%, transparent));
}

[data-gutter] [data-separator='line-info'] [data-separator-wrapper][data-separator-multi-button] {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
}

[data-gutter] [data-separator='line-info'][data-separator-first] [data-separator-wrapper][data-separator-multi-button],
[data-gutter] [data-separator='line-info'][data-separator-last] [data-separator-wrapper][data-separator-multi-button] {
  grid-template-columns: minmax(0, 1fr) !important;
}

[data-content] [data-separator='line-info'] [data-separator-wrapper] {
  display: flex !important;
  visibility: visible !important;
  inset-inline: 0 !important;
  box-sizing: border-box;
  max-width: 100% !important;
  width: 100% !important;
  padding-inline: 0 !important;
  height: 32px;
  align-items: stretch;
  background: var(--gl-background-color-subtle, var(--diffs-bg-separator));
  border-bottom: 1px solid var(--gl-border-color-default, color-mix(in srgb, currentColor 18%, transparent));
  color: var(--gl-text-color-subtle, var(--diffs-fg-number));
}

[data-gutter] [data-expand-button] {
  display: grid !important;
  inline-size: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  width: 100% !important;
  height: 32px !important;
  overflow: hidden;
  place-items: center;
  border: 0 !important;
  border-right: 1px solid var(--gl-border-color-default, color-mix(in srgb, currentColor 18%, transparent)) !important;
  background: var(--gl-background-color-subtle, var(--diffs-bg-separator));
  color: var(--gl-link-color-default, var(--diffs-fg-number)) !important;
}

[data-gutter] [data-expand-all-button],
[data-gutter] [data-separator-content],
[data-content] [data-expand-button] {
  display: none !important;
}

[data-gutter] [data-expand-button]:hover,
[data-gutter] [data-expand-button]:focus-visible {
  background: var(--gl-background-color-strong, var(--diffs-bg-hover)) !important;
  color: var(--gl-link-color-hover, var(--diffs-fg)) !important;
  outline: none;
}

[data-gutter] [data-expand-button]:focus-visible {
  box-shadow: inset 0 0 0 2px var(--gl-focus-ring-inner-color, var(--gl-link-color-default, currentColor));
}

[data-gutter] [data-expand-button] [data-icon] {
  display: none;
  width: 16px;
  height: 16px;
}

[data-gutter] [data-expand-button]::before,
[data-gutter] [data-expand-button]::after {
  width: 7px;
  height: 7px;
  border: solid currentColor;
  border-width: 0 2px 2px 0;
  content: "";
}

[data-gutter] [data-expand-up]::before {
  transform: translateY(2px) rotate(-135deg);
}

[data-gutter] [data-expand-down]::before {
  transform: translateY(-2px) rotate(45deg);
}

[data-gutter] [data-expand-both] {
  gap: 6px;
}

[data-gutter] [data-expand-both]::before {
  transform: translateY(2px) rotate(-135deg);
}

[data-gutter] [data-expand-both]::after {
  transform: translateY(-2px) rotate(45deg);
}

[data-content] [data-separator-content] {
  display: flex !important;
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
  background: var(--gl-background-color-subtle, var(--diffs-bg-separator)) !important;
  color: var(--gl-text-color-subtle, var(--diffs-fg-number)) !important;
  font: 12px/18px var(--default-regular-font, system-ui, sans-serif);
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
  --trees-bg-override: transparent;
  --trees-bg-muted-override: var(--gl-background-color-strong, rgba(115, 117, 127, 0.16));
  --trees-border-color-override: var(--gl-border-color-default, #dcdcde);
  --trees-fg-override: var(--gl-text-color-default, #1f1e24);
  --trees-fg-muted-override: var(--gl-text-color-subtle, #626168);
  --trees-font-family-override: var(--default-regular-font, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  --trees-font-size-override: 13px;
  --trees-font-weight-regular-override: 400;
  --trees-font-weight-semibold-override: 600;
  --trees-item-height: 28px;
  --trees-item-padding-x-override: 6px;
  --trees-item-margin-x-override: 0;
  --trees-item-row-gap-override: 6px;
  --trees-level-gap-override: 6px;
  --trees-icon-width-override: 18px;
  --trees-border-radius-override: 0;
  --trees-padding-inline-override: 0;
  --trees-git-lane-width-override: 22px;
  --trees-search-bg-override: var(--gl-background-color-default, #fff);
  --trees-search-fg-override: var(--gl-text-color-default, #1f1e24);
  --trees-selected-bg-override: var(--gl-background-color-strong, #ececef);
  --trees-selected-fg-override: var(--gl-text-color-default, #1f1e24);
  --trees-git-added-color-override: var(--gl-text-color-success, #108548);
  --trees-git-deleted-color-override: var(--gl-text-color-danger, #dd2b0e);
  --trees-git-modified-color-override: var(--gl-text-color-info, #1f75cb);
  --trees-git-renamed-color-override: var(--gl-text-color-warning, #ab6100);
  --trees-git-untracked-color-override: var(--gl-text-color-success, #108548);
}

[data-file-tree-search-container] {
  position: relative;
  margin-block: 0 12px !important;
}

[data-file-tree-search-container]::before,
[data-file-tree-search-container]::after {
  position: absolute;
  pointer-events: none;
  content: "";
}

[data-file-tree-search-container]::before {
  left: 15px;
  top: 50%;
  width: 13px;
  height: 13px;
  border: 2px solid var(--gl-text-color-subtle, #626168);
  border-radius: 50%;
  transform: translateY(-58%);
}

[data-file-tree-search-container]::after {
  left: 27px;
  top: calc(50% + 6px);
  width: 8px;
  height: 2px;
  border-radius: 999px;
  background: var(--gl-text-color-subtle, #626168);
  transform: rotate(45deg);
  transform-origin: left center;
}

[data-file-tree-search-input] {
  height: 32px !important;
  margin-block: 0 !important;
  padding-inline: 38px 12px !important;
  border-color: var(--gl-border-color-strong, #89888d) !important;
  border-radius: 8px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  line-height: 30px !important;
}

[role='tree'] {
  gap: 2px !important;
}

[data-type='item'] {
  margin-inline: 0 !important;
  padding-inline: 6px 8px !important;
  width: 100% !important;
  transition: background-color 120ms ease;
}

[data-type='item'][data-item-selected='true'] {
  border-radius: 0 !important;
}

[data-item-section='content'] {
  color: var(--gl-text-color-default, #1f1e24) !important;
  font-weight: 400;
  letter-spacing: 0;
}

[data-item-git-status] > [data-item-section='content'] {
  color: var(--gl-text-color-default, #1f1e24) !important;
}

[data-item-section='decoration'] {
  color: var(--gl-text-color-subtle, #626168) !important;
  font-variant-numeric: tabular-nums;
  font-weight: 400;
  letter-spacing: 0;
}

[data-item-section='git'] {
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}

[data-item-section='spacing-item'] {
  border-color: color-mix(in srgb, var(--gl-border-color-default, #dcdcde) 70%, transparent) !important;
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

  const mergeRequestMatch = path.match(/^(.*\/-\/merge_requests\/\d+)\/diffs\/?$/);
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
  const fileInfoByPath = new Map<string, FileBrowserFileInfo>();
  const paths = Array.from(
    new Set(
      files
        .map((file) => {
          const path = normalizeDiffPath(file.name);
          if (path != null && path.length > 0) {
            fileInfoByPath.set(path, {
              stats: getFileStats(file),
              status: getFileGitStatus(file),
            });
          }
          return path;
        })
        .filter((path): path is string => path != null && path.length > 0)
    )
  );

  return { fileInfoByPath, files, paths, stats: getDiffStats(files) };
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

function getFileGitStatus(file: FileDiffMetadata): GitStatus {
  if (file.type === 'new') return 'added';
  if (file.type === 'deleted') return 'deleted';
  if (file.type === 'rename-pure' || file.type === 'rename-changed') return 'renamed';
  return 'modified';
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

const NATIVE_BAR_MOVED_ATTR = 'data-gitlab-pierre-bar-moved';
const nativeBarPlaceholders = new WeakMap<HTMLElement, Comment>();

function detachNativeCompareBar(targets: MountTargets): void {
  const bar = targets.diffContainer.querySelector<HTMLElement>(
    '.mr-version-controls, .compare-versions-header'
  );
  if (bar == null || bar.hasAttribute(NATIVE_BAR_MOVED_ATTR)) return;
  const placeholder = document.createComment('gitlab-pierre-bar-placeholder');
  bar.parentNode?.insertBefore(placeholder, bar);
  nativeBarPlaceholders.set(bar, placeholder);
  bar.setAttribute(NATIVE_BAR_MOVED_ATTR, 'true');
  const shell = document.querySelector<HTMLElement>(`[${EXTENSION_ATTR}="shell"]`);
  const anchor = shell ?? targets.diffContainer;
  anchor.parentNode?.insertBefore(bar, anchor);
}

function restoreNativeCompareBar(): void {
  for (const bar of document.querySelectorAll<HTMLElement>(`[${NATIVE_BAR_MOVED_ATTR}]`)) {
    const placeholder = nativeBarPlaceholders.get(bar);
    bar.removeAttribute(NATIVE_BAR_MOVED_ATTR);
    if (placeholder?.parentNode == null) continue;
    placeholder.parentNode.replaceChild(bar, placeholder);
    nativeBarPlaceholders.delete(bar);
  }
}

function hideNativeGitLabView(targets: MountTargets): void {
  targets.diffContainer.removeAttribute(COMMENT_MODE_ATTR);
  detachNativeCompareBar(targets);
  targets.diffContainer.classList.add(HIDDEN_CLASS);
  targets.diffContainer.setAttribute('aria-hidden', 'true');
  document.querySelector(`[${RETURN_BUTTON_ATTR}]`)?.remove();
}

function revealNativeGitLabView(targets: MountTargets): void {
  restoreNativeCompareBar();
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

  restoreNativeCompareBar();

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
          <PierreVersionContext nativeChrome={nativeChrome} />

          <div className="gitlab-pierre-toolbar-actions gl-flex gl-items-center gl-gap-2 gl-ml-auto">
            <button
              aria-label={isFileBrowserVisible ? 'Hide file browser' : 'Show file browser'}
              aria-pressed={isFileBrowserVisible}
              className={`btn-icon btn gl-button btn-default btn-md${isFileBrowserVisible ? ' selected' : ''}`}
              onClick={() => setIsFileBrowserVisible((visible) => !visible)}
              title={isFileBrowserVisible ? 'Hide file browser' : 'Show file browser'}
              type="button"
            >
              <span className="gl-button-text">
                <SidebarToggleIcon />
              </span>
            </button>
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
          fileInfoByPath={parsed.fileInfoByPath}
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
  fileInfoByPath,
  fileCount,
  hidden,
  onViewChange,
  paths,
  view,
}: {
  fileInfoByPath: Map<string, FileBrowserFileInfo>;
  fileCount: number;
  hidden: boolean;
  onViewChange: (view: FileBrowserView) => void;
  paths: string[];
  view: FileBrowserView;
}): React.JSX.Element {
  return (
    <div
      className="rd-app-sidebar diff-tree-list gl-px-3 gitlab-pierre-file-browser"
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
          <div className="gl-flex gl-items-center gitlab-pierre-file-browser-header">
            <h2
              aria-label="File browser"
              className="gl-my-0 gl-inline-block gl-text-base gitlab-pierre-file-browser-title"
              id="gitlab-pierre-tree-list-title"
            >
              Files
            </h2>
            <span
              aria-hidden="true"
              className="gl-ml-2 gl-badge badge badge-pill badge-neutral gitlab-pierre-file-count-badge"
            >
              <span className="gl-badge-content">{fileCount}</span>
            </span>
            <div className="gl-ml-auto gl-button-group btn-group gitlab-pierre-file-view-toggle" role="group">
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
              <PierreFileTree fileInfoByPath={fileInfoByPath} paths={paths} />
            ) : (
              <PierreFileList fileInfoByPath={fileInfoByPath} paths={paths} />
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

  const [activeCommentLine, setActiveCommentLine] = useState<ActiveCommentLine | null>(null);
  const [commentHost, setCommentHost] = useState<HTMLElement | null>(null);
  const selectedRangeRef = useRef<SelectedLineRange | null>(null);
  const lastMultiLineRangeRef = useRef<{ range: SelectedLineRange; at: number } | null>(null);

  const lineAnnotations = useMemo<DiffLineAnnotation[] | undefined>(
    () =>
      activeCommentLine == null
        ? undefined
        : [{ side: activeCommentLine.side, lineNumber: activeCommentLine.lineNumber }],
    [activeCommentLine]
  );

  const renderAnnotation = useCallback(
    () => <InlineCommentSlot setHost={setCommentHost} />,
    []
  );

  const handleLineSelected = useCallback((range: SelectedLineRange | null) => {
    console.info('[GitLab Pierre] handleLineSelected', { range });
    selectedRangeRef.current = range;
    if (range == null) {
      lastMultiLineRangeRef.current = null;
    } else if (range.start !== range.end) {
      lastMultiLineRangeRef.current = { range, at: Date.now() };
    }
  }, []);

  const handleAddComment = useCallback(
    (line: GetHoveredLineResult<'diff'>) => {
      const liveRange = selectedRangeRef.current;
      const last = lastMultiLineRangeRef.current;
      let range = liveRange;
      let fallbackUsed = false;
      if (range == null || range.start === range.end) {
        if (last != null) {
          const lo = Math.min(last.range.start, last.range.end);
          const hi = Math.max(last.range.start, last.range.end);
          if (line.lineNumber >= lo && line.lineNumber <= hi) {
            range = last.range;
            fallbackUsed = true;
          }
        }
      }
      const multiLine = resolveMultiLineRange(range, line);
      console.info('[GitLab Pierre] handleAddComment v0.4.25', {
        clickLine: line.lineNumber,
        clickSide: line.side,
        liveRange,
        last,
        fallbackUsed,
        rangeUsed: range,
        multiLine,
      });

      if (multiLine == null) {
        setActiveCommentLine({
          side: line.side,
          lineNumber: line.lineNumber,
          multiLine: null,
        });
        return;
      }

      setActiveCommentLine({
        side: multiLine.anchorSide,
        lineNumber: multiLine.anchorLine,
        multiLine,
      });
    },
    []
  );

  useEffect(() => {
    if (activeCommentLine == null || commentHost == null) return;

    const hijack = startNativeCommentHijack({
      file,
      line: activeCommentLine,
      host: commentHost,
      onTeardown: () => setActiveCommentLine(null),
    });

    return () => {
      hijack.cancel();
    };
  }, [activeCommentLine, commentHost, file]);

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
          lineAnnotations={lineAnnotations}
          options={{
            collapsedContextThreshold: 12,
            collapsed: false,
            diffStyle: 'unified',
            enableGutterUtility: true,
            enableLineSelection: true,
            expansionLineCount: 20,
            hunkSeparators: 'line-info',
            onLineSelected: handleLineSelected,
            onPostRender: ensurePierreDiffCoreStyles,
            overflow: 'wrap',
            theme: themeOptions.theme,
            themeType: themeOptions.themeType,
            unsafeCSS,
          }}
          renderAnnotation={renderAnnotation}
          renderGutterUtility={(getHoveredLine) => (
            <LineCommentButton getHoveredLine={getHoveredLine} onAddComment={handleAddComment} />
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

  enhancePierreExpandButtons(shadowRoot);
}

function enhancePierreExpandButtons(shadowRoot: ShadowRoot): void {
  shadowRoot.querySelectorAll<HTMLElement>('[data-expand-button]').forEach((button) => {
    if (button.hasAttribute('data-gitlab-pierre-expand-enhanced')) return;

  const label = getPierreExpandButtonLabel(button);
  button.setAttribute('aria-label', label);
  button.removeAttribute('title');
    button.setAttribute('tabindex', '0');
    button.setAttribute('data-gitlab-pierre-expand-enhanced', '');
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      button.click();
    });
  });
}

function getPierreExpandButtonLabel(button: HTMLElement): string {
  if (button.hasAttribute('data-expand-up')) return 'Previous 20 lines';
  if (button.hasAttribute('data-expand-down')) return 'Next 20 lines';
  if (button.hasAttribute('data-expand-both')) return 'Expand surrounding context';
  if (button.hasAttribute('data-expand-all-button')) return 'Expand all hidden lines';
  return 'Expand hidden lines';
}

interface MultiLineCommentRange {
  startLine: number;
  endLine: number;
  anchorLine: number;
  anchorSide: AnnotationSide;
  startSide: AnnotationSide;
}

interface ActiveCommentLine {
  side: AnnotationSide;
  lineNumber: number;
  multiLine: MultiLineCommentRange | null;
}

function resolveMultiLineRange(
  range: SelectedLineRange | null,
  hovered: GetHoveredLineResult<'diff'>
): MultiLineCommentRange | null {
  if (range == null || range.start === range.end) return null;

  const startBeforeEnd = range.start <= range.end;
  const lowLine = startBeforeEnd ? range.start : range.end;
  const highLine = startBeforeEnd ? range.end : range.start;
  const lowSide = ((startBeforeEnd ? range.side : range.endSide) ?? hovered.side) as AnnotationSide;
  const highSide = ((startBeforeEnd ? range.endSide : range.side) ?? hovered.side) as AnnotationSide;

  return {
    startLine: lowLine,
    endLine: highLine,
    anchorLine: highLine,
    anchorSide: highSide,
    startSide: lowSide,
  };
}

function LineCommentButton({
  getHoveredLine,
  onAddComment,
}: {
  getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined;
  onAddComment: (line: GetHoveredLineResult<'diff'>) => void;
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

        onAddComment(hoveredLine);
      }}
      title="Comment on this line"
      type="button"
    >
      +
    </button>
  );
}

function InlineCommentSlot({
  setHost,
}: {
  setHost: (el: HTMLElement | null) => void;
}): React.JSX.Element {
  return (
    <div
      className="gitlab-pierre-comment-slot"
      data-gitlab-pierre="comment-slot"
      ref={setHost}
    />
  );
}

const NATIVE_FORM_SELECTOR = [
  '.js-temp-notes-holder',
  '.diff-comment-form',
  '.discussion-form',
  '.notes-form',
  '[data-testid="comment-form"]',
].join(', ');

interface NativeCommentHijackOptions {
  file: FileDiffMetadata;
  line: ActiveCommentLine;
  host: HTMLElement;
  onTeardown: () => void;
}

interface NativeCommentHijackHandle {
  cancel: () => void;
}

const NATIVE_OFFSCREEN_STYLE = [
  'position: fixed',
  'top: 0',
  'left: 0',
  'width: 100vw',
  'height: 100vh',
  'overflow: auto',
  'visibility: hidden',
  'pointer-events: none',
  'z-index: -1',
  'opacity: 0',
  'display: block',
].map((rule) => `${rule} !important`).join('; ');

function revealNativeForRender(targets: MountTargets): void {
  const c = targets.diffContainer;
  c.setAttribute(COMMENT_MODE_ATTR, 'true');
  c.classList.remove(HIDDEN_CLASS);
  c.style.cssText = NATIVE_OFFSCREEN_STYLE;
}

function restoreNativeAfterHijack(targets: MountTargets): void {
  const c = targets.diffContainer;
  c.removeAttribute(COMMENT_MODE_ATTR);
  c.classList.add(HIDDEN_CLASS);
  c.style.cssText = '';
}

interface NativeDiffFileEntry {
  file_path?: string;
  new_path?: string;
  old_path?: string;
  viewer?: { collapsed?: boolean | null; name?: string } | null;
}

interface DiffsAppLike {
  $options?: { name?: string };
  diffFiles: NativeDiffFileEntry[];
  loadCollapsedDiff: (file: NativeDiffFileEntry) => unknown;
  goToFile: (arg: { path: string }) => unknown;
}

interface VueInstanceLike {
  $root?: VueInstanceLike;
  $children?: VueInstanceLike[];
  $options?: { name?: string };
  diffFiles?: unknown;
  loadCollapsedDiff?: unknown;
  goToFile?: unknown;
}

function isDiffsAppLike(inst: unknown): inst is DiffsAppLike {
  if (inst == null || typeof inst !== 'object') return false;
  const candidate = inst as VueInstanceLike;
  return (
    Array.isArray(candidate.diffFiles) &&
    typeof candidate.loadCollapsedDiff === 'function'
  );
}

function traverseVueChildrenForDiffsApp(node: VueInstanceLike | undefined): DiffsAppLike | null {
  if (node == null) return null;
  if (isDiffsAppLike(node)) return node;
  const children = node.$children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = traverseVueChildrenForDiffsApp(child);
      if (found != null) return found;
    }
  }
  return null;
}

function findDiffsAppInstance(targets: MountTargets): DiffsAppLike | null {
  const seed = targets.diffContainer.querySelector('.diff-file') ?? targets.diffContainer;

  // 1) Walk up the ancestor chain from the seed.
  let walker: Element | null = seed as Element;
  let firstVueInstance: VueInstanceLike | null = null;
  while (walker != null) {
    const inst = (walker as Element & { __vue__?: VueInstanceLike }).__vue__;
    if (inst != null) {
      if (firstVueInstance == null) firstVueInstance = inst;
      if (isDiffsAppLike(inst)) return inst;
      if (inst.$options?.name === 'DiffsApp' && isDiffsAppLike(inst)) return inst;
    }
    walker = walker.parentElement;
  }

  // 2) Walk down through the diff container's descendants.
  const stack: Element[] = [targets.diffContainer];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const inst = (node as Element & { __vue__?: VueInstanceLike }).__vue__;
    if (inst != null) {
      if (firstVueInstance == null) firstVueInstance = inst;
      if (isDiffsAppLike(inst)) return inst;
    }
    for (const child of Array.from(node.children)) stack.push(child);
  }

  // 3) From any Vue instance we found, traverse the full $root tree.
  if (firstVueInstance != null) {
    const root = firstVueInstance.$root ?? firstVueInstance;
    const found = traverseVueChildrenForDiffsApp(root);
    if (found != null) return found;
  }

  return null;
}

function findNativeDiffEntry(
  app: DiffsAppLike,
  paths: string[]
): NativeDiffFileEntry | null {
  for (const entry of app.diffFiles) {
    const candidates = [entry.file_path, entry.new_path, entry.old_path]
      .map((p) => normalizeDiffPath(p ?? undefined))
      .filter((p): p is string => p != null);
    if (paths.some((p) => candidates.some((c) => c === p || c.endsWith(`/${p}`)))) {
      return entry;
    }
  }
  return null;
}

function waitForCondition(
  predicate: () => boolean,
  scope: Node,
  timeoutMs: number
): Promise<boolean> {
  if (predicate()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      observer.disconnect();
      clearTimeout(timeoutId);
      resolve(ok);
    };
    const observer = new MutationObserver(() => {
      if (predicate()) finish(true);
    });
    observer.observe(scope, { childList: true, subtree: true });
    const timeoutId = setTimeout(() => finish(false), timeoutMs);
  });
}

async function ensureNativeFileMounted(
  file: FileDiffMetadata,
  targets: MountTargets
): Promise<boolean> {
  const paths = getDiffFilePaths(file);
  const log = (step: string, extra: Record<string, unknown> = {}): void => {
    console.info('[GitLab Pierre] ensureNativeFileMounted', step, { paths, ...extra });
  };

  const app = findDiffsAppInstance(targets);
  if (app == null) {
    const ok = findNativeDiffFiles(paths).length > 0;
    const seedEl = targets.diffContainer.querySelector('.diff-file') ?? targets.diffContainer;
    const ancestorVueNames: string[] = [];
    let probe: Element | null = seedEl as Element;
    while (probe != null && ancestorVueNames.length < 12) {
      const inst = (probe as Element & { __vue__?: VueInstanceLike }).__vue__;
      if (inst != null) {
        ancestorVueNames.push(
          `${inst.$options?.name ?? '<anon>'}${
            Array.isArray(inst.diffFiles) ? '[diffFiles]' : ''
          }`
        );
      }
      probe = probe.parentElement;
    }
    log('no-DiffsApp', { ok, ancestorVueNames });
    return ok;
  }

  const entry = findNativeDiffEntry(app, paths);
  if (entry == null) {
    const ok = findNativeDiffFiles(paths).length > 0;
    log('no-entry-in-diffFiles', {
      ok,
      diffFilesCount: app.diffFiles.length,
      sampleEntries: app.diffFiles.slice(0, 3).map((e) => e.file_path),
    });
    return ok;
  }

  log('entry-found', {
    collapsed: entry.viewer?.collapsed,
    viewerName: entry.viewer?.name,
    inDom: findNativeDiffFiles(paths).length > 0,
  });

  if (entry.viewer?.collapsed === true) {
    try {
      app.loadCollapsedDiff(entry);
      log('called-loadCollapsedDiff');
    } catch (e) {
      log('loadCollapsedDiff-threw', { error: String(e) });
      return false;
    }
    const uncollapsed = await waitForCondition(
      () => entry.viewer?.collapsed !== true,
      targets.diffContainer,
      5000
    );
    log('after-uncollapse-wait', { uncollapsed });
    if (!uncollapsed) return false;
  }

  if (findNativeDiffFiles(paths).length === 0) {
    const path = entry.file_path ?? entry.new_path ?? entry.old_path ?? '';
    if (path.length > 0) {
      try {
        app.goToFile({ path });
        log('called-goToFile', { path });
      } catch (e) {
        log('goToFile-threw', { error: String(e), path });
      }
    }
  } else {
    log('already-in-dom');
  }

  const mounted = await waitForCondition(
    () => findNativeDiffFiles(paths).length > 0,
    targets.diffContainer,
    5000
  );
  log('after-mount-wait', { mounted });
  return mounted;
}

function scrollNativeContainerToLine(
  targets: MountTargets,
  file: FileDiffMetadata,
  side: AnnotationSide,
  lineNumber: number,
  attempt: number
): HTMLElement | null {
  const [nativeFile] = findNativeDiffFiles(getDiffFilePaths(file));
  if (nativeFile == null) return null;
  const container = targets.diffContainer;
  const containerRect = container.getBoundingClientRect();
  const fileRect = nativeFile.getBoundingClientRect();
  const fileTop = fileRect.top - containerRect.top + container.scrollTop;
  const fileHeight = fileRect.height;
  const headerHeight = 50;
  const sideLines = side === 'additions' ? file.additionLines.length : file.deletionLines.length;
  const totalLines = Math.max(1, sideLines, file.unifiedLineCount, file.splitLineCount);
  const safeLine = Math.max(1, Math.min(lineNumber, totalLines));
  const baseOffset =
    fileTop + headerHeight + ((safeLine - 1) / totalLines) * Math.max(0, fileHeight - headerHeight);
  const viewport = container.clientHeight || window.innerHeight;
  const advance = attempt * viewport * 0.7;
  const target = Math.max(0, baseOffset + advance - viewport / 2);
  container.scrollTop = target;
  return nativeFile;
}

function startNativeCommentHijack(
  options: NativeCommentHijackOptions
): NativeCommentHijackHandle {
  const { file, line, host, onTeardown } = options;
  const targets = mountState?.targets ?? null;

  let cancelled = false;
  let nativeRevealed = false;
  let retryIntervalId: ReturnType<typeof setInterval> | null = null;
  let buttonTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let spawnObserver: MutationObserver | null = null;
  let spawnTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let teardownObserver: MutationObserver | null = null;
  let movedForm: HTMLElement | null = null;
  let scrollAttempt = 0;

  const restoreNativeIfNeeded = () => {
    if (!nativeRevealed || targets == null) return;
    nativeRevealed = false;
    restoreNativeAfterHijack(targets);
  };

  const cleanup = () => {
    cancelled = true;
    if (retryIntervalId != null) clearInterval(retryIntervalId);
    spawnObserver?.disconnect();
    teardownObserver?.disconnect();
    if (buttonTimeoutId != null) clearTimeout(buttonTimeoutId);
    if (spawnTimeoutId != null) clearTimeout(spawnTimeoutId);
    restoreNativeIfNeeded();
  };

  const fail = (message: string) => {
    if (cancelled) return;
    console.info('[GitLab Pierre] hijack fail', { message, line });
    cleanup();
    showToast(message, 'error');
    onTeardown();
    fallbackToNativeForLine(file, line);
  };

  const hoveredLine: GetHoveredLineResult<'diff'> = {
    side: line.side,
    lineNumber: line.lineNumber,
  };

  const findNewForm = (root: ParentNode): HTMLElement | null => {
    if (root instanceof HTMLElement && root.matches(NATIVE_FORM_SELECTOR)) {
      return root;
    }
    return root.querySelector<HTMLElement>(NATIVE_FORM_SELECTOR);
  };

  const moveFormIntoSlot = (form: HTMLElement) => {
    if (cancelled) return;
    console.info('[GitLab Pierre] moveFormIntoSlot', {
      formTag: form.tagName,
      formClass: form.className,
      hasMultiLine: line.multiLine != null,
    });
    movedForm = form;
    host.appendChild(form);
    spawnObserver?.disconnect();
    spawnObserver = null;
    if (spawnTimeoutId != null) {
      clearTimeout(spawnTimeoutId);
      spawnTimeoutId = null;
    }

    if (line.multiLine != null) {
      applyMultiLineRangeToForm(host, line.multiLine);
    }

    teardownObserver = new MutationObserver(() => {
      if (cancelled) return;
      if (movedForm == null) return;
      if (movedForm.isConnected && host.contains(movedForm)) return;
      console.info('[GitLab Pierre] teardownObserver fired — form left slot', {
        movedFormConnected: movedForm.isConnected,
        hostContainsForm: host.contains(movedForm),
      });
      teardownObserver?.disconnect();
      teardownObserver = null;
      movedForm = null;
      restoreNativeIfNeeded();
      onTeardown();
    });
    teardownObserver.observe(host, { childList: true });
  };

  const proceedWithButton = (nativeButton: HTMLElement) => {
    if (cancelled) return;
    const nativeFile =
      nativeButton.closest<HTMLElement>('.diff-file') ?? nativeButton.ownerDocument.body;
    console.info('[GitLab Pierre] proceedWithButton', {
      nativeButtonClass: nativeButton.className,
      hasMultiLine: line.multiLine != null,
    });

    const existing = findNewForm(nativeFile);
    if (existing != null) {
      console.info('[GitLab Pierre] proceedWithButton: existing form already present, reusing');
      moveFormIntoSlot(existing);
      return;
    }

    spawnObserver = new MutationObserver((mutations) => {
      if (cancelled) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const form = findNewForm(node);
          if (form != null) {
            moveFormIntoSlot(form);
            return;
          }
        }
      }
    });
    spawnObserver.observe(nativeFile, { childList: true, subtree: true });

    spawnTimeoutId = setTimeout(() => {
      if (cancelled || movedForm != null) return;
      fail('GitLab’s comment editor did not appear in time.');
    }, 5000);

    nativeButton.click();
  };

  const tryFindButton = (): HTMLElement | null =>
    findNativeCommentButton(file, hoveredLine);

  const beginLookup = () => {
    if (cancelled) return;
    if (targets != null) {
      scrollNativeContainerToLine(targets, file, line.side, line.lineNumber, scrollAttempt);
    }

    const initial = tryFindButton();
    console.info('[GitLab Pierre] beginLookup', {
      lineNumber: line.lineNumber,
      side: line.side,
      hasMultiLine: line.multiLine != null,
      initialFound: initial != null,
    });
    if (initial != null) {
      proceedWithButton(initial);
      return;
    }

    retryIntervalId = setInterval(() => {
      if (cancelled) return;
      const button = tryFindButton();
      if (button != null) {
        if (retryIntervalId != null) {
          clearInterval(retryIntervalId);
          retryIntervalId = null;
        }
        if (buttonTimeoutId != null) {
          clearTimeout(buttonTimeoutId);
          buttonTimeoutId = null;
        }
        proceedWithButton(button);
        return;
      }
      if (targets != null) {
        scrollAttempt += 1;
        scrollNativeContainerToLine(targets, file, line.side, line.lineNumber, scrollAttempt);
      }
    }, 200);

    buttonTimeoutId = setTimeout(() => {
      if (cancelled || movedForm != null) return;
      fail('Could not find GitLab’s native comment control for this line.');
    }, 5000);
  };

  if (targets != null) {
    revealNativeForRender(targets);
    nativeRevealed = true;
    void ensureNativeFileMounted(file, targets).then((ok) => {
      if (cancelled) return;
      if (!ok) {
        fail('GitLab could not load this file in the native diff view.');
        return;
      }
      beginLookup();
    });
  } else {
    beginLookup();
  }

  return { cancel: cleanup };
}

function applyMultiLineRangeToForm(host: HTMLElement, range: MultiLineCommentRange): void {
  console.info('[GitLab Pierre] applyMultiLineRangeToForm', {
    startLine: range.startLine,
    endLine: range.endLine,
    startSide: range.startSide,
    anchorLine: range.anchorLine,
    anchorSide: range.anchorSide,
  });
  if (trySetMultiLineRange(host, range)) return;

  let attempts = 0;
  const observer = new MutationObserver(() => {
    attempts += 1;
    if (trySetMultiLineRange(host, range)) {
      console.info('[GitLab Pierre] applyMultiLineRangeToForm applied via observer', { attempts });
      observer.disconnect();
      window.clearTimeout(timeoutId);
    }
  });
  observer.observe(host, { childList: true, subtree: true });

  const timeoutId = window.setTimeout(() => {
    console.info('[GitLab Pierre] applyMultiLineRangeToForm timed out', { attempts });
    observer.disconnect();
  }, 3000);
}

function trySetMultiLineRange(host: HTMLElement, range: MultiLineCommentRange): boolean {
  const select =
    host.querySelector<HTMLSelectElement>('#comment-line-start') ??
    host.querySelector<HTMLSelectElement>('select.gl-form-select');
  if (select == null) {
    console.info('[GitLab Pierre] trySetMultiLineRange: no select element yet');
    return false;
  }
  if (select.options.length === 0) {
    console.info('[GitLab Pierre] trySetMultiLineRange: select has 0 options yet', {
      selectId: select.id,
    });
    return false;
  }

  const optionTexts = Array.from(select.options).map((o) => o.textContent?.trim() ?? '');
  const targetIndex = findOptionIndexForLine(select, range.startLine, range.startSide);
  console.info('[GitLab Pierre] trySetMultiLineRange', {
    selectId: select.id,
    optionsCount: select.options.length,
    optionTextsHead: optionTexts.slice(0, 5),
    optionTextsTail: optionTexts.slice(-5),
    currentIndex: select.selectedIndex,
    currentText: optionTexts[select.selectedIndex],
    targetIndex,
    targetLine: range.startLine,
    targetSide: range.startSide,
  });
  if (targetIndex == null) return false;
  if (select.selectedIndex === targetIndex) return true;

  select.selectedIndex = targetIndex;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  select.dispatchEvent(new Event('input', { bubbles: true }));
  console.info('[GitLab Pierre] trySetMultiLineRange: applied', {
    newIndex: select.selectedIndex,
    newText: select.options[targetIndex]?.textContent?.trim(),
  });
  return true;
}

function findOptionIndexForLine(
  select: HTMLSelectElement,
  lineNumber: number,
  side: AnnotationSide
): number | null {
  const sidePrefix = side === 'deletions' ? '-' : '+';
  const sidedText = `${sidePrefix}${lineNumber}`;
  const plainText = `${lineNumber}`;
  let plainMatch: number | null = null;
  for (let i = 0; i < select.options.length; i += 1) {
    const text = (select.options[i]?.textContent ?? '').trim();
    if (text === sidedText) return i;
    if (text === plainText && plainMatch == null) plainMatch = i;
  }
  return plainMatch;
}

function fallbackToNativeForLine(
  file: FileDiffMetadata,
  line: ActiveCommentLine
): void {
  const targets = mountState?.targets;
  if (targets == null) return;

  const hoveredLine: GetHoveredLineResult<'diff'> = {
    side: line.side,
    lineNumber: line.lineNumber,
  };
  const nativeButton = findNativeCommentButton(file, hoveredLine);
  if (nativeButton == null) return;

  showNativeGitLabViewForCommenting(targets);
  nativeButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
  nativeButton.click();
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
  const container: ParentNode = mountState?.targets.diffContainer ?? document;
  const diffFiles = Array.from(container.querySelectorAll<HTMLElement>('.diff-file'));
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

function PierreFileTree({
  fileInfoByPath,
  paths,
}: {
  fileInfoByPath: Map<string, FileBrowserFileInfo>;
  paths: string[];
}): React.JSX.Element {
  const model = useMemo(
    () =>
      new FileTreeModel({
        flattenEmptyDirectories: true,
        gitStatus: getGitStatusEntries(fileInfoByPath),
        initialExpansion: 'open',
        itemHeight: 28,
        onSelectionChange: ([selectedPath]) => {
          if (selectedPath == null) return;
          scrollToFile(selectedPath);
        },
        paths,
        renderRowDecoration: ({ item }: FileTreeRowDecorationContext) => {
          if (item.kind === 'directory') return null;
          const info = fileInfoByPath.get(item.path);
          if (info == null) return null;
          return {
            text: formatFileStats(info.stats),
            title: `Added ${info.stats.additions} lines. Removed ${info.stats.deletions} lines.`,
          };
        },
        search: true,
        searchBlurBehavior: 'retain',
        unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
      }),
    [fileInfoByPath, paths]
  );

  useEffect(() => {
    return () => {
      model.cleanUp();
    };
  }, [model]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const input = model
        .getFileTreeContainer()
        ?.shadowRoot?.querySelector<HTMLInputElement>('[data-file-tree-search-input]');
      if (input != null) {
        input.placeholder = 'Search (e.g. *.vue) (F)';
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [model]);

  return <FileTree className="gitlab-pierre-tree" model={model} />;
}

function PierreFileList({
  fileInfoByPath,
  paths,
}: {
  fileInfoByPath: Map<string, FileBrowserFileInfo>;
  paths: string[];
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim().toLowerCase();
  const filteredPaths = useMemo(
    () =>
      trimmedQuery === ''
        ? paths
        : paths.filter((path) => path.toLowerCase().includes(trimmedQuery)),
    [paths, trimmedQuery]
  );

  return (
    <div className="gitlab-pierre-file-list-wrapper">
      <div className="gitlab-pierre-file-list-search gl-mb-2">
        <GlIcon
          className="gitlab-pierre-file-list-search-icon"
          name="search"
          testid="search-icon"
        />
        <input
          aria-label="Search files"
          className="gl-form-input form-control"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search (e.g. *.vue) (F)"
          type="search"
          value={query}
        />
      </div>
      <div className="gitlab-pierre-file-list" role="list">
        {filteredPaths.length === 0 ? (
          <p className="gitlab-pierre-file-list-empty gl-text-subtle">No files match.</p>
        ) : (
          filteredPaths.map((path) => {
            const info = fileInfoByPath.get(path);
            return (
              <button
                className="gitlab-pierre-file-list-item"
                key={path}
                onClick={() => scrollToFile(path)}
                role="listitem"
                title={path}
                type="button"
              >
                <span className={`gitlab-pierre-file-status gitlab-pierre-file-status-${info?.status ?? 'modified'}`}>
                  {getGitStatusLabel(info?.status ?? 'modified')}
                </span>
                <GlIcon
                  className="gitlab-pierre-file-list-item-icon gl-fill-icon-subtle"
                  name="doc-text"
                  testid="doc-text-icon"
                />
                <span className="gitlab-pierre-file-list-path">{path}</span>
                {info != null ? (
                  <span
                    aria-label={`Added ${info.stats.additions} lines. Removed ${info.stats.deletions} lines.`}
                    className="gitlab-pierre-file-list-stats"
                  >
                    <span className="gitlab-pierre-file-list-additions">+{info.stats.additions}</span>
                    <span className="gitlab-pierre-file-list-deletions">-{info.stats.deletions}</span>
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function getGitStatusEntries(
  fileInfoByPath: Map<string, FileBrowserFileInfo>
): GitStatusEntry[] {
  return Array.from(fileInfoByPath, ([path, info]) => ({ path, status: info.status }));
}

function getGitStatusLabel(status: GitStatus): string {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  if (status === 'renamed') return 'R';
  if (status === 'untracked') return 'U';
  return 'M';
}

function formatFileStats(stats: FileStats): string {
  return `+${stats.additions} -${stats.deletions}`;
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
