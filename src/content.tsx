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
  GIT_DIFF_FILE_BREAK_REGEX,
  processFile,
  processPatch,
  type AnnotationSide,
  type CodeViewItem,
  type DiffLineAnnotation,
  type DiffsThemeNames,
  type FileDiffMetadata,
  type GetHoveredLineResult,
  type SelectedLineRange,
  type ThemeTypes,
} from '@pierre/diffs';
import { CodeView, FileDiff, type CodeViewHandle } from '@pierre/diffs/react';
import { FileTree } from '@pierre/trees/react';
import {
  FileTree as FileTreeModel,
  type FileTreeRowDecorationContext,
  type GitStatus,
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

interface CodeViewLineSelection {
  id: string;
  range: SelectedLineRange;
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

[data-code] {
  display: grid !important;
  grid-auto-flow: dense !important;
  grid-template-columns: max-content minmax(0, 1fr) !important;
  overflow: clip !important;
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

[data-gutter] [data-separator]:not([data-separator='line-info']):not([data-separator='metadata']) {
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

[data-code][data-unified] [data-column-number] {
  position: relative;
  min-width: calc((var(--diffs-min-number-column-width, var(--diffs-min-number-column-width-default, 3ch)) * 2) + 1ch);
  padding-left: 1ch;
  padding-right: 1ch;
  border-right: 1px solid var(--gl-border-color-default, color-mix(in srgb, currentColor 18%, transparent)) !important;
}

[data-code][data-unified] [data-column-number][data-line-type='context'] {
  background: var(--gl-background-color-subtle, var(--diffs-bg-buffer)) !important;
}

[data-gitlab-pierre-dual-line-numbers] {
  display: grid;
  grid-template-columns: minmax(3ch, 1fr) minmax(3ch, 1fr);
  column-gap: 1ch;
  width: 100%;
}

[data-gitlab-pierre-old-line],
[data-gitlab-pierre-new-line] {
  min-width: 0;
  text-align: right;
}

[data-code][data-unified] [data-content] [data-line] {
  position: relative;
  padding-left: 2ch !important;
}

[data-code][data-unified] [data-content] [data-line]::before {
  position: absolute;
  left: 0;
  width: 2ch;
  color: var(--gl-text-color-subtle, var(--diffs-fg-number));
  text-align: center;
  content: " ";
  user-select: none;
}

[data-code][data-unified] [data-content] [data-line-type='change-deletion']::before {
  content: "-";
}

[data-code][data-unified] [data-content] [data-line-type='change-addition']::before {
  content: "+";
}

[data-gutter-utility-slot] {
  z-index: 5;
  width: 100%;
  left: 0 !important;
  right: 0 !important;
  display: flex !important;
  align-items: center;
  justify-content: center;
}

[data-gutter-utility-slot] ::slotted(*) {
  opacity: 0;
  transition: opacity 0.1s ease;
  display: flex !important;
  align-items: center;
  justify-content: center;
}

[data-column-number]:hover [data-gutter-utility-slot] ::slotted(*),
[data-column-number][data-hovered] [data-gutter-utility-slot] ::slotted(*) {
  opacity: 1;
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
  --trees-border-radius-override: 0;
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
  backgroundMode: 'gitlab',
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
    '[data-testid="rapid-diffs-app"]',
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

/** Cache of raw per-file patch sections keyed by normalized path */
const rawPatchByPath = new Map<string, string>();

function cacheRawPatches(patch: string): void {
  rawPatchByPath.clear();
  const sections = patch.split(GIT_DIFF_FILE_BREAK_REGEX);
  for (const section of sections) {
    // Extract the file path from "diff --git a/path b/path"
    const headerMatch = section.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    if (headerMatch == null) continue;
    const filePath = headerMatch[2]!.replace(/^"(.*)"$/, '$1');
    rawPatchByPath.set(filePath, section);
  }
}

function getProjectPath(): string | null {
  const match = location.pathname.match(/^\/(.+?)\/-\//);
  return match?.[1] ?? null;
}

async function fetchGitLabBlob(projectPath: string, blobSha: string): Promise<string> {
  const encodedProject = encodeURIComponent(projectPath);
  const url = `/api/v4/projects/${encodedProject}/repository/blobs/${blobSha}/raw`;
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`GitLab returned ${response.status} for blob ${blobSha}`);
  }
  return response.text();
}

const NULL_BLOB_SHA = '0000000000000000000000000000000000000000';

async function fetchFullFileDiff(
  file: FileDiffMetadata
): Promise<FileDiffMetadata | null> {
  const projectPath = getProjectPath();
  if (projectPath == null) return null;
  const rawPatch = rawPatchByPath.get(file.name) ?? rawPatchByPath.get(file.name.replace(/^[ab]\//, ''));
  if (rawPatch == null) return null;

  const oldSha = file.prevObjectId;
  const newSha = file.newObjectId;
  if (oldSha == null && newSha == null) return null;

  const [oldContent, newContent] = await Promise.all([
    oldSha != null && oldSha !== NULL_BLOB_SHA && !oldSha.startsWith('0000000')
      ? fetchGitLabBlob(projectPath, oldSha)
      : Promise.resolve(''),
    newSha != null && newSha !== NULL_BLOB_SHA && !newSha.startsWith('0000000')
      ? fetchGitLabBlob(projectPath, newSha)
      : Promise.resolve(''),
  ]);

  const result = processFile(rawPatch, {
    oldFile: { contents: oldContent, name: file.prevName ?? file.name },
    newFile: { contents: newContent, name: file.name },
    isGitDiff: true,
  });
  return result ?? null;
}

function parseGitPatch(patch: string, cacheKey: string): ParsedDiff {
  cacheRawPatches(patch);
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

function detachNativeCompareBar(targets: MountTargets): HTMLElement | null {
  const bar = targets.diffContainer.querySelector<HTMLElement>(
    '.mr-version-controls, .compare-versions-header'
  );
  if (bar == null) return null;
  if (!bar.hasAttribute(NATIVE_BAR_MOVED_ATTR)) {
    bar.setAttribute(NATIVE_BAR_MOVED_ATTR, 'true');
  }
  return bar;
}

function restoreNativeCompareBar(targets?: MountTargets): void {
  const bar = document.querySelector<HTMLElement>(`[${NATIVE_BAR_MOVED_ATTR}]`);
  if (bar == null) return;
  bar.removeAttribute(NATIVE_BAR_MOVED_ATTR);
  const container = targets?.diffContainer ?? document.querySelector<HTMLElement>(
    '[data-testid="diffs"], #diffs, .diffs, .diff-files-holder, [data-testid="rapid-diffs-app"], .files'
  );
  if (container != null) {
    container.prepend(bar);
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
  restoreNativeCompareBar(targets);
  targets.diffContainer.classList.remove(HIDDEN_CLASS);
  targets.diffContainer.removeAttribute('aria-hidden');
  // Comment hijack may have left inline !important offscreen styles in place
  // (see revealNativeForRender). Wipe them so the native view becomes visible.
  targets.diffContainer.style.cssText = '';
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
      height={16}
      viewBox="0 0 16 16"
      width={16}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1.5.5v9h2v-9h-2zm3.5 0v9h6v-9H7z"
        fill="currentColor"
      />
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
  const [fullFilePaths, setFullFilePaths] = useState<Set<string>>(() => new Set());
  const [fullFileDiffs, setFullFileDiffs] = useState<Map<string, FileDiffMetadata>>(
    () => new Map()
  );
  const [fullFileLoadingPaths, setFullFileLoadingPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [activeComment, setActiveComment] = useState<ActiveCodeViewComment | null>(null);
  const [commentHost, setCommentHost] = useState<HTMLElement | null>(null);
  const [codeViewItemsVersion, setCodeViewItemsVersion] = useState(0);
  const codeViewRef = useRef<CodeViewHandle<AnnotationMeta>>(null);
  const selectedLineSelectionRef = useRef<CodeViewLineSelection | null>(null);
  const lastMultiLineRangeRef = useRef<{
    id: string;
    range: SelectedLineRange;
    at: number;
  } | null>(null);
  const spriteUrl = useMemo(() => getIconSpriteUrl(), []);
  const diffThemeOptions = useMemo(() => getDiffThemeOptions(themeSettings), [themeSettings]);
  const unsafeCSS = useMemo(() => getPierreDiffUnsafeCSS(themeSettings), [themeSettings]);
  const isPierreView = viewMode === 'pierre';
  const isAnyFullFileVisible = fullFilePaths.size > 0;

  const bumpCodeViewItems = useCallback(() => {
    setCodeViewItemsVersion((version) => version + 1);
  }, []);

  // Fetch discussions once for the whole MR
  const [discussions, setDiscussions] = useState<DiscussionThread[] | null>(null);
  const [discussionsFetchKey, setDiscussionsFetchKey] = useState(0);
  useEffect(() => {
    const ctx = getMrContext();
    if (ctx == null) return;
    void fetchMrDiscussions(ctx).then((threads) => {
      setDiscussions(threads);
      bumpCodeViewItems();
    });
  }, [bumpCodeViewItems, discussionsFetchKey]);

  // Expose refetch for use after comment submission
  useEffect(() => {
    (window as any).__pierreRefetchDiscussions = () => {
      const ctx = getMrContext();
      if (ctx != null) discussionsCache.delete(`${ctx.projectPath}!${ctx.mrIid}`);
      setDiscussionsFetchKey((k) => k + 1);
    };
    return () => { delete (window as any).__pierreRefetchDiscussions; };
  }, []);

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
    bumpCodeViewItems();
  }, [bumpCodeViewItems]);
  const expandAll = useCallback(() => {
    setCollapsedPaths(new Set());
    bumpCodeViewItems();
  }, [bumpCodeViewItems]);
  const collapseAll = useCallback(
    () => {
      setCollapsedPaths(new Set(parsed.paths));
      bumpCodeViewItems();
    },
    [bumpCodeViewItems, parsed.paths]
  );

  const handleFileSelected = useCallback((path: string) => {
    codeViewRef.current?.scrollTo({
      type: 'item',
      id: path,
      align: 'start',
      behavior: 'smooth-auto',
    });
  }, []);

  const toggleFullFile = useCallback(
    (path: string, file: FileDiffMetadata) => {
      let shouldLoad = false;
      setFullFilePaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          shouldLoad = !fullFileDiffs.has(path);
        }
        return next;
      });
      bumpCodeViewItems();

      if (!shouldLoad) return;

      setFullFileLoadingPaths((prev) => new Set(prev).add(path));
      void fetchFullFileDiff(file)
        .then((result) => {
          if (result == null) {
            showToast('Could not load the full file.', 'warning');
            setFullFilePaths((prev) => {
              const next = new Set(prev);
              next.delete(path);
              return next;
            });
            return;
          }
          setFullFileDiffs((prev) => {
            const next = new Map(prev);
            next.set(path, result);
            return next;
          });
        })
        .catch((error: unknown) => {
          console.warn('[GitLab Pierre] Failed to fetch full file:', error);
          showToast('Could not load the full file.', 'warning');
          setFullFilePaths((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        })
        .finally(() => {
          setFullFileLoadingPaths((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
          bumpCodeViewItems();
        });
    },
    [bumpCodeViewItems, fullFileDiffs]
  );

  const handleSelectedLinesChange = useCallback((selection: CodeViewLineSelection | null) => {
    selectedLineSelectionRef.current = selection;
    if (selection == null) {
      lastMultiLineRangeRef.current = null;
      return;
    }
    if (selection.range.start !== selection.range.end) {
      lastMultiLineRangeRef.current = {
        id: selection.id,
        range: selection.range,
        at: Date.now(),
      };
    }
  }, []);

  const handleAddComment = useCallback(
    (item: CodeViewItem<AnnotationMeta>, line: GetHoveredLineResult<'diff'>) => {
      if (item.type !== 'diff') return;
      const liveSelection = selectedLineSelectionRef.current;
      const liveRange = liveSelection?.id === item.id ? liveSelection.range : null;
      const last = lastMultiLineRangeRef.current;
      let range = liveRange;
      if (range == null || range.start === range.end) {
        if (last != null && last.id === item.id) {
          const lo = Math.min(last.range.start, last.range.end);
          const hi = Math.max(last.range.start, last.range.end);
          if (line.lineNumber >= lo && line.lineNumber <= hi) {
            range = last.range;
          }
        }
      }
      const multiLine = resolveMultiLineRange(range, line);
      setActiveComment({
        file: item.fileDiff,
        path: item.id,
        line: {
          side: multiLine?.anchorSide ?? line.side,
          lineNumber: multiLine?.anchorLine ?? line.lineNumber,
          multiLine,
        },
      });
      bumpCodeViewItems();
    },
    [bumpCodeViewItems]
  );

  const clearActiveCommentForPath = useCallback(
    (path: string) => {
      setActiveComment((current) => (current?.path === path ? null : current));
      bumpCodeViewItems();
    },
    [bumpCodeViewItems]
  );

  useEffect(() => {
    if (activeComment == null || commentHost == null) return;

    const hijack = startNativeCommentHijack({
      file: activeComment.file,
      line: activeComment.line,
      host: commentHost,
      onTeardown: () => clearActiveCommentForPath(activeComment.path),
    });

    return () => {
      hijack.cancel();
    };
  }, [activeComment, clearActiveCommentForPath, commentHost]);

  const codeViewItems = useMemo<CodeViewItem<AnnotationMeta>[]>(
    () =>
      parsed.files.map((file) => {
        const path = normalizeDiffPath(file.name) ?? file.name;
        const fullFileDiff = fullFileDiffs.get(path);
        const activeLine = activeComment?.path === path ? activeComment.line : null;
        return {
          id: path,
          type: 'diff',
          fileDiff: fullFilePaths.has(path) && fullFileDiff != null ? fullFileDiff : file,
          annotations: getLineAnnotationsForFile(discussions, path, activeLine),
          collapsed: collapsedPaths.has(path),
          version: codeViewItemsVersion,
        };
      }),
    [
      activeComment,
      codeViewItemsVersion,
      collapsedPaths,
      discussions,
      fullFileDiffs,
      fullFilePaths,
      parsed.files,
    ]
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

  const compareBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const targets = mountState?.targets;
    const container = compareBarRef.current;
    if (targets == null || container == null) return;
    if (viewMode !== 'pierre') return;
    const bar = detachNativeCompareBar(targets);
    if (bar != null) {
      container.appendChild(bar);
      bar.style.display = '';
    }
  }, [viewMode]);

  return (
    <IconSpriteContext.Provider value={spriteUrl}>
      <div className="mr-version-controls" data-gitlab-pierre="toolbar">
        <div className="mr-version-menus-container gl-pt-0 gitlab-pierre-toolbar">
          <PierreVersionContext nativeChrome={nativeChrome} />

          <div className="gitlab-pierre-toolbar-actions gl-flex gl-items-center gl-gap-2 gl-ml-auto">
            {isPierreView && (
              <div
                aria-label={`${parsed.stats.files} files changed, ${parsed.stats.additions} additions, ${parsed.stats.deletions} deletions`}
                className="gitlab-pierre-toolbar-stats gl-flex gl-items-center gl-gap-2 gl-mr-2"
              >
                <span className="gitlab-pierre-toolbar-stats-files">
                  {parsed.stats.files} {parsed.stats.files === 1 ? 'file' : 'files'}
                </span>
                <span className="gitlab-pierre-toolbar-stats-add">+{parsed.stats.additions}</span>
                <span className="gitlab-pierre-toolbar-stats-del">-{parsed.stats.deletions}</span>
              </div>
            )}
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

      <div ref={compareBarRef} data-gitlab-pierre="compare-bar" hidden={!isPierreView} />

      <div
        className={`gl-flex gl-flex-wrap gitlab-pierre-layout${isFileBrowserVisible ? '' : ' gitlab-pierre-layout-no-sidebar'}`}
        hidden={!isPierreView}
      >
        <PierreFileBrowser
          fileInfoByPath={parsed.fileInfoByPath}
          fileCount={parsed.stats.files}
          hidden={!isFileBrowserVisible}
          onFileSelected={handleFileSelected}
          onViewChange={setFileBrowserView}
          paths={parsed.paths}
          view={fileBrowserView}
        />
        <div className="diffs-batch gitlab-pierre-diffs-area" data-gitlab-pierre="diffs-area">
          <CodeView<AnnotationMeta>
            className="gitlab-pierre-codeview"
            disableWorkerPool
            items={codeViewItems}
            key={`${themeSettings.presetId}:${themeSettings.themeType}:${themeSettings.backgroundMode}`}
            onSelectedLinesChange={handleSelectedLinesChange}
            options={{
              collapsedContextThreshold: isAnyFullFileVisible ? undefined : 12,
              diffStyle: 'unified',
              enableGutterUtility: true,
              enableLineSelection: true,
              expandUnchanged: isAnyFullFileVisible,
              expansionLineCount: 20,
              hunkSeparators: 'metadata',
              onPostRender: ensurePierreDiffCoreStyles,
              overflow: 'wrap',
              stickyHeaders: true,
              theme: diffThemeOptions.theme,
              themeType: diffThemeOptions.themeType,
              unsafeCSS,
            }}
            ref={codeViewRef}
            renderAnnotation={(annotation, item) => {
              if (annotation.metadata?.kind === 'discussion') {
                return (
                  <DiscussionThreadView
                    thread={{
                      id: annotation.metadata.discussionId,
                      notes: annotation.metadata.notes,
                    }}
                  />
                );
              }
              return (
                <InlineCommentSlot
                  onUnmount={() => clearActiveCommentForPath(item.id)}
                  setHost={setCommentHost}
                />
              );
            }}
            renderCustomHeader={(item) => (
              <PierreCodeViewHeader
                fileLoading={fullFileLoadingPaths.has(item.id)}
                item={item}
                onToggle={() => toggleFile(item.id)}
                onToggleFullFile={() => {
                  if (item.type === 'diff') {
                    toggleFullFile(item.id, item.fileDiff);
                  }
                }}
                showingFullFile={fullFilePaths.has(item.id)}
              />
            )}
            renderGutterUtility={(getHoveredLine, item) =>
              item.type === 'diff' ? (
                <LineCommentButton
                  getHoveredLine={getHoveredLine as () => GetHoveredLineResult<'diff'> | undefined}
                  onAddComment={(line) => handleAddComment(item, line)}
                />
              ) : null
            }
          />
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
  onFileSelected,
  onViewChange,
  paths,
  view,
}: {
  fileInfoByPath: Map<string, FileBrowserFileInfo>;
  fileCount: number;
  hidden: boolean;
  onFileSelected: (path: string) => void;
  onViewChange: (view: FileBrowserView) => void;
  paths: string[];
  view: FileBrowserView;
}): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleFileSelected = useCallback((path: string) => {
    onFileSelected(path);
    setSearchQuery('');
  }, [onFileSelected]);

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
          <FileBrowserSearch
            inputRef={searchInputRef}
            onChange={setSearchQuery}
            query={searchQuery}
          />
          <nav aria-label="File tree" className="mr-tree-list">
            {view === 'tree' ? (
              <PierreFileTree
                fileInfoByPath={fileInfoByPath}
                onFileSelected={handleFileSelected}
                onQueryChange={setSearchQuery}
                paths={paths}
                query={searchQuery}
              />
            ) : (
              <PierreFileList
                fileInfoByPath={fileInfoByPath}
                onFileSelected={handleFileSelected}
                paths={paths}
                query={searchQuery}
              />
            )}
          </nav>
        </section>
      </div>
    </div>
  );
}

function FileBrowserSearch({
  inputRef,
  onChange,
  query,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (query: string) => void;
  query: string;
}): React.JSX.Element {
  return (
    <div className="gitlab-pierre-file-search">
      <input
        aria-label="Search files"
        className="gl-form-input form-control"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Search (e.g. *.vue) (F)"
        ref={inputRef}
        type="search"
        value={query}
      />
    </div>
  );
}

function FileViewedCheckbox({
  fileKey,
  nativeCheckbox,
  paths,
}: {
  fileKey: string;
  nativeCheckbox: HTMLInputElement | null;
  paths: string[];
}): React.JSX.Element {
  const [checked, setChecked] = useState(false);
  const checkboxId = `gitlab-pierre-viewed-${fileKey}`;

  useEffect(() => {
    if (nativeCheckbox == null) {
      setChecked(false);
      return;
    }
    setChecked(nativeCheckbox.checked);
    const update = () => setChecked(nativeCheckbox.checked);
    nativeCheckbox.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(nativeCheckbox, { attributes: true, attributeFilter: ['checked'] });
    return () => {
      nativeCheckbox.removeEventListener('change', update);
      observer.disconnect();
    };
  }, [nativeCheckbox]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.preventDefault();
    const live = nativeCheckbox ?? findNativeFileActions(paths).viewedCheckbox;
    if (live != null) {
      live.click();
      return;
    }
    console.info('[GitLab Pierre] viewed-checkbox native target missing', {
      paths,
      diffFile: findNativeDiffFiles(paths)[0],
    });
    setChecked((value) => !value);
  };

  return (
    <label className="gitlab-pierre-file-viewed gl-mr-3" htmlFor={checkboxId}>
      <input
        aria-label="Mark file as viewed"
        checked={checked}
        className="gitlab-pierre-file-viewed-input"
        id={checkboxId}
        onChange={handleChange}
        type="checkbox"
      />
      <span className="gitlab-pierre-file-viewed-label">Viewed</span>
    </label>
  );
}

function FileCommentButton({
  nativeButton,
  paths,
}: {
  nativeButton: HTMLElement | null;
  paths: string[];
}): React.JSX.Element {
  const [active, setActive] = useState(true);
  const isOneShot = isRapidDiffsCommentButton(nativeButton);

  useEffect(() => {
    if (nativeButton == null || isOneShot) return;
    const read = () => {
      const pressed = nativeButton.getAttribute('aria-pressed');
      if (pressed === 'true' || pressed === 'false') {
        setActive(pressed === 'true');
        return;
      }
      const label = (nativeButton.getAttribute('aria-label') ?? '').toLowerCase();
      if (label.includes('hide')) setActive(true);
      else if (label.includes('show')) setActive(false);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(nativeButton, {
      attributes: true,
      attributeFilter: ['aria-pressed', 'aria-label', 'class'],
    });
    return () => observer.disconnect();
  }, [nativeButton, isOneShot]);

  const handleClick = () => {
    const live = nativeButton ?? findNativeFileActions(paths).commentToggle;
    if (!isOneShot) setActive((prev) => !prev);
    if (live != null) {
      live.click();
      return;
    }
    console.info('[GitLab Pierre] comment-button native target missing', {
      paths,
      diffFile: findNativeDiffFiles(paths)[0],
    });
  };

  const label = isOneShot
    ? 'Comment on this file'
    : active
      ? 'Hide all comments on this file'
      : 'Show all comments on this file';

  return (
    <button
      aria-label={label}
      aria-pressed={isOneShot ? undefined : active}
      className={`btn gl-button btn-default btn-sm btn-default-tertiary btn-icon gl-mr-1${
        !isOneShot && !active ? ' gitlab-pierre-toggle-off' : ''
      }`}
      onClick={handleClick}
      title={label}
      type="button"
    >
      <GlIcon name="comment-lines" testid="toggle-comments-icon" />
    </button>
  );
}

interface KebabItem {
  href: string | null;
  label: string;
  onSelect: () => void;
  separated: boolean;
  external?: boolean;
}

interface RapidDiffOptionItem {
  text?: string;
  href?: string;
  messageData?: Record<string, string | number | boolean | null | undefined>;
  extraAttrs?: Record<string, string | number | boolean | null | undefined>;
}

function formatRapidDiffsItemText(
  text: string,
  data: RapidDiffOptionItem['messageData']
): string {
  let result = text.replace(/%\{codeStart\}|%\{codeEnd\}/g, '');
  if (data != null) {
    result = result.replace(/%\{(\w+)\}/g, (_match, key: string) => {
      const value = data[key];
      return value == null ? '' : String(value);
    });
  }
  return result.replace(/\s+/g, ' ').trim();
}

function readRapidDiffKebabItems(
  diffFile: HTMLElement,
  kebabToggle: HTMLElement | null
): KebabItem[] {
  const script = findRapidDiffOptionsScript(diffFile);
  if (script == null) return [];
  const raw = script.textContent ?? '';
  if (raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): KebabItem[] => {
    if (typeof entry !== 'object' || entry == null) return [];
    const item = entry as RapidDiffOptionItem;
    const text = typeof item.text === 'string' ? item.text : '';
    const label = formatRapidDiffsItemText(text, item.messageData);
    if (label === '') return [];
    const href = typeof item.href === 'string' && item.href !== '' ? item.href : null;
    const dataClick =
      typeof item.extraAttrs?.['data-click'] === 'string'
        ? (item.extraAttrs['data-click'] as string)
        : null;
    const target =
      typeof item.extraAttrs?.target === 'string' ? (item.extraAttrs.target as string) : null;
    const external = target === '_blank';

    const onSelect = (): void => {
      if (dataClick != null) {
        triggerRapidDiffsAction(diffFile, kebabToggle, dataClick, label);
        return;
      }
      if (href != null) {
        if (external) {
          window.open(href, '_blank', 'noopener,noreferrer');
        } else {
          window.location.href = href;
        }
      }
    };

    return [
      {
        href,
        label,
        onSelect,
        separated: false,
        external,
      },
    ];
  });
}

function triggerRapidDiffsAction(
  diffFile: HTMLElement,
  kebabToggle: HTMLElement | null,
  dataClick: string,
  label: string
): void {
  const directTarget = diffFile.querySelector<HTMLElement>(
    `[data-click="${CSS.escape(dataClick)}"]`
  );
  if (directTarget != null) {
    directTarget.click();
    return;
  }

  if (kebabToggle == null) {
    console.info('[GitLab Pierre] rapid-diffs action target missing', { dataClick, label });
    return;
  }

  const wasOpen = kebabToggle.getAttribute('aria-expanded') === 'true';
  if (!wasOpen) kebabToggle.click();

  const findItem = (): HTMLElement | null => {
    const fromAttr = document.querySelector<HTMLElement>(
      `[data-click="${CSS.escape(dataClick)}"]`
    );
    if (fromAttr != null) return fromAttr;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"], a, button')
    );
    return (
      candidates.find((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim() === label) ?? null
    );
  };

  let attempts = 0;
  const tryClick = (): void => {
    const item = findItem();
    if (item != null) {
      item.click();
      if (!wasOpen && kebabToggle.getAttribute('aria-expanded') === 'true') {
        kebabToggle.click();
      }
      return;
    }
    attempts += 1;
    if (attempts < 10) {
      window.requestAnimationFrame(tryClick);
    } else {
      console.info('[GitLab Pierre] rapid-diffs action item not located', { dataClick, label });
      if (!wasOpen && kebabToggle.getAttribute('aria-expanded') === 'true') {
        kebabToggle.click();
      }
    }
  };
  window.requestAnimationFrame(tryClick);
}

const KEBAB_PANEL_SELECTOR = [
  '[data-testid="disclosure-content"]',
  '[data-testid="base-dropdown-menu"]',
  '.gl-new-dropdown-panel',
  '.gl-new-dropdown-contents',
  '.gl-disclosure-dropdown-menu',
  '.dropdown-menu.show',
  '.dropdown-menu',
  '[role="menu"]',
].join(', ');

function findKebabDropdownPanel(kebabToggle: HTMLElement): HTMLElement | null {
  const panelId = kebabToggle.getAttribute('aria-controls');
  if (panelId !== null && panelId !== '') {
    const byId = document.getElementById(panelId);
    if (byId != null) return byId;
  }
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(KEBAB_PANEL_SELECTOR));
  for (const el of candidates) {
    if (!el.isConnected) continue;
    if (el.querySelector('a, button, [role="menuitem"]') == null) continue;
    return el;
  }
  return candidates.find((el) => el.isConnected) ?? null;
}

function extractKebabItems(panel: HTMLElement, kebabToggle: HTMLElement): KebabItem[] {
  const items: KebabItem[] = [];
  let pendingSeparator = false;
  const interactive = 'a[role="menuitem"], button[role="menuitem"], a, button';
  const nodes = Array.from(
    panel.querySelectorAll<HTMLElement>(`${interactive}, hr, [role="separator"]`)
  );
  for (const node of nodes) {
    if (node.tagName === 'HR' || node.getAttribute('role') === 'separator') {
      pendingSeparator = items.length > 0;
      continue;
    }
    if (node === kebabToggle) continue;
    if (node.classList.contains('gl-new-dropdown-toggle')) continue;
    if (node.getAttribute('aria-hidden') === 'true') continue;
    if (node.closest('[aria-hidden="true"]') != null) continue;
    const label = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (label === '') continue;
    const href = node instanceof HTMLAnchorElement ? node.getAttribute('href') : null;
    const native = node;
    items.push({
      href,
      label,
      onSelect: () => native.click(),
      separated: pendingSeparator,
    });
    pendingSeparator = false;
  }
  return items;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function scrapeNativeKebabItems(kebabToggle: HTMLElement): Promise<KebabItem[]> {
  const wasOpen = kebabToggle.getAttribute('aria-expanded') === 'true';
  if (!wasOpen) kebabToggle.click();

  let panel: HTMLElement | null = null;
  let items: KebabItem[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    panel = findKebabDropdownPanel(kebabToggle);
    if (panel != null) {
      items = extractKebabItems(panel, kebabToggle);
      if (items.length > 0) break;
    }
    await nextAnimationFrame();
  }

  if (items.length === 0) {
    console.info('[GitLab Pierre] kebab scrape empty', {
      panel,
      kebabToggle,
      diffFile: kebabToggle.closest('.diff-file, diff-file, [data-testid="rd-diff-file"]'),
    });
  }

  if (!wasOpen && kebabToggle.getAttribute('aria-expanded') === 'true') {
    kebabToggle.click();
  }

  return items;
}

function buildSynthesizedKebabItems(
  filePath: string,
  paths: string[]
): KebabItem[] {
  const items: KebabItem[] = [];
  const actions = findNativeFileActions(paths);

  if (actions.diffFile != null) {
    const fromJson = readRapidDiffKebabItems(actions.diffFile, actions.kebabToggle);
    if (fromJson.length > 0) {
      items.push({
        href: null,
        label: 'Copy file path',
        onSelect: () => copyToClipboard(filePath),
        separated: false,
      });
      items.push(...fromJson);
      return items;
    }
  }

  if (actions.commentToggle != null && !isRapidDiffsCommentButton(actions.commentToggle)) {
    const native = actions.commentToggle;
    const labelLower = (native.getAttribute('aria-label') ?? '').toLowerCase();
    const showing = !labelLower.includes('show');
    items.push({
      href: null,
      label: showing ? 'Hide all comments on this file' : 'Show all comments on this file',
      onSelect: () => native.click(),
      separated: false,
    });
  }

  items.push({
    href: null,
    label: 'Copy file path',
    onSelect: () => copyToClipboard(filePath),
    separated: false,
  });

  if (actions.diffFile != null) {
    const seenLabels = new Set(items.map((item) => item.label.toLowerCase()));
    const anchors = Array.from(actions.diffFile.querySelectorAll<HTMLAnchorElement>('a[href]'));
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href');
      if (href == null || href === '' || href.startsWith('#')) continue;
      const isFileActionLink =
        anchor.closest('.file-actions') != null ||
        anchor.closest('[data-testid="file-actions"]') != null ||
        anchor.closest('[role="menu"], .gl-new-dropdown-panel, .gl-disclosure-dropdown-menu') != null;
      if (!isFileActionLink) continue;
      const label = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (label === '') continue;
      const lower = label.toLowerCase();
      if (seenLabels.has(lower)) continue;
      seenLabels.add(lower);
      const native = anchor;
      items.push({
        href,
        label,
        onSelect: () => native.click(),
        separated: false,
      });
    }
  }

  return items;
}

function mergeKebabItems(primary: KebabItem[], extra: KebabItem[]): KebabItem[] {
  const seen = new Set(primary.map((item) => item.label.toLowerCase()));
  const merged = [...primary];
  for (const item of extra) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

const FULL_FILE_TOGGLE_PATTERN = /^(show\s+(full|entire)\s+file|show\s+changes\s+only|toggle\s+full\s+diff|view\s+full\s+file|view\s+changes\s+only)$/i;

function isFullFileToggleLabel(label: string): boolean {
  return FULL_FILE_TOGGLE_PATTERN.test(label.trim());
}

function interceptFullFileToggle(
  items: KebabItem[],
  onToggleFullFile: () => void,
  showingFullFile: boolean
): KebabItem[] {
  let hasFullFileItem = false;
  const result = items.map((item) => {
    if (!isFullFileToggleLabel(item.label)) return item;
    hasFullFileItem = true;
    return {
      ...item,
      label: showingFullFile ? 'Show changes only' : 'Show full file',
      onSelect: onToggleFullFile,
    };
  });
  if (!hasFullFileItem) {
    result.push({
      href: null,
      label: showingFullFile ? 'Show changes only' : 'Show full file',
      onSelect: onToggleFullFile,
      separated: true,
    });
  }
  return result;
}

function FileActionsKebab({
  fileKey,
  filePath,
  nativeButton,
  onToggleFullFile,
  paths,
  showingFullFile,
}: {
  fileKey: string;
  filePath: string;
  nativeButton: HTMLElement | null;
  onToggleFullFile: () => void;
  paths: string[];
  showingFullFile: boolean;
}): React.JSX.Element {
  const [items, setItems] = useState<KebabItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = `gitlab-pierre-kebab-${fileKey}`;

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const actions = findNativeFileActions(paths);
    const fromJson =
      actions.diffFile != null
        ? readRapidDiffKebabItems(actions.diffFile, actions.kebabToggle)
        : [];
    const synthesized = buildSynthesizedKebabItems(filePath, paths);
    const withIntercepted = interceptFullFileToggle(synthesized, onToggleFullFile, showingFullFile);
    setItems(withIntercepted);
    setIsOpen(true);

    if (fromJson.length > 0) return;

    const liveNative = nativeButton ?? actions.kebabToggle;
    if (liveNative == null) {
      console.info('[GitLab Pierre] kebab native toggle not found', { paths });
      return;
    }
    void scrapeNativeKebabItems(liveNative).then((scraped) => {
      if (scraped.length === 0) return;
      setItems((current) => mergeKebabItems(interceptFullFileToggle(current, onToggleFullFile, showingFullFile), interceptFullFileToggle(scraped, onToggleFullFile, showingFullFile)));
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node) === true) return;
      setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const handleItemClick = (item: KebabItem, event: React.MouseEvent<HTMLElement>) => {
    if (item.href != null && (event.metaKey || event.ctrlKey || event.shiftKey)) {
      setIsOpen(false);
      return;
    }
    event.preventDefault();
    setIsOpen(false);
    item.onSelect();
  };

  return (
    <div className="gitlab-pierre-file-kebab" ref={containerRef}>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Options"
        className="btn gl-button btn-default btn-sm btn-default-tertiary btn-icon"
        onClick={handleToggle}
        title="Options"
        type="button"
      >
        <GlIcon name="ellipsis_v" testid="ellipsis_v-icon" />
      </button>
      {isOpen ? (
        <div
          aria-label="File actions"
          className="gitlab-pierre-file-kebab-panel"
          id={menuId}
          role="menu"
        >
          {items.length === 0 ? (
            <div className="gitlab-pierre-file-kebab-empty">Loading actions…</div>
          ) : (
            items.map((item, idx) => {
              const key = `${idx}:${item.label}`;
              const className = `gitlab-pierre-file-kebab-item${item.separated ? ' gitlab-pierre-file-kebab-item-separated' : ''}`;
              return item.href != null ? (
                <a
                  className={className}
                  href={item.href}
                  key={key}
                  onClick={(event) => handleItemClick(item, event)}
                  role="menuitem"
                >
                  {item.label}
                </a>
              ) : (
                <button
                  className={className}
                  key={key}
                  onClick={(event) => handleItemClick(item, event)}
                  role="menuitem"
                  type="button"
                >
                  {item.label}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

// --- Inline discussion annotations ---

type AnnotationMeta =
  | { kind: 'active-comment' }
  | { kind: 'discussion'; discussionId: string; notes: DiscussionNote[] };

interface DiscussionNote {
  id: number;
  author: { name: string; username?: string; avatar_url?: string };
  body: string;
  created_at: string;
  resolved?: boolean;
  resolvable?: boolean;
  type?: string | null;
  position?: {
    new_line?: number | null;
    old_line?: number | null;
    new_path?: string;
    old_path?: string;
    position_type?: string;
  } | null;
}

interface DiscussionThread {
  id: string;
  notes: DiscussionNote[];
}

let discussionsCache: Map<string, DiscussionThread[]> = new Map();

async function fetchMrDiscussions(ctx: MrContext): Promise<DiscussionThread[]> {
  const cacheKey = `${ctx.projectPath}!${ctx.mrIid}`;
  const cached = discussionsCache.get(cacheKey);
  if (cached != null) return cached;

  const encodedProject = encodeURIComponent(ctx.projectPath);
  const threads: DiscussionThread[] = [];
  let page = 1;
  const MAX_PAGES = 5; // Cap at 500 discussions to avoid slow loads
  while (page <= MAX_PAGES) {
    const url = `/api/v4/projects/${encodedProject}/merge_requests/${ctx.mrIid}/discussions?per_page=100&page=${page}`;
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) break;
      const batch = (await response.json()) as DiscussionThread[];
      threads.push(...batch);
      if (batch.length < 100) break;
      page++;
    } catch {
      break;
    }
  }

  // Also fetch draft notes
  const draftsUrl = `/api/v4/projects/${encodedProject}/merge_requests/${ctx.mrIid}/draft_notes`;
  try {
    const response = await fetch(draftsUrl, { credentials: 'same-origin' });
    if (response.ok) {
      const drafts = (await response.json()) as Array<{
        id: number;
        author_id: number;
        note: string;
        position?: DiscussionNote['position'];
        created_at?: string;
      }>;
      for (const draft of drafts) {
        if (draft.position?.position_type === 'text') {
          threads.push({
            id: `draft-${draft.id}`,
            notes: [{
              id: draft.id,
              author: { name: 'You (draft)' },
              body: draft.note,
              created_at: draft.created_at ?? new Date().toISOString(),
              type: 'DraftNote',
              position: draft.position,
            }],
          });
        }
      }
    }
  } catch { /* ignore */ }

  discussionsCache.set(cacheKey, threads);
  console.info('[GitLab Pierre] fetchMrDiscussions result', {
    total: threads.length,
    withPosition: threads.filter((t) => t.notes[0]?.position?.position_type === 'text').length,
    samplePaths: [...new Set(threads.flatMap((t) => [t.notes[0]?.position?.new_path, t.notes[0]?.position?.old_path].filter(Boolean)))].slice(0, 10),
  });
  return threads;
}

function getDiscussionsForFile(
  threads: DiscussionThread[],
  filePath: string
): Array<{ side: AnnotationSide; lineNumber: number; thread: DiscussionThread }> {
  const results: Array<{ side: AnnotationSide; lineNumber: number; thread: DiscussionThread }> = [];
  for (const thread of threads) {
    if (thread.notes.length === 0) continue;
    // Position is on the first note of the discussion
    const pos = thread.notes[0]?.position;
    if (pos == null || pos.position_type !== 'text') continue;
    if (pos.new_path !== filePath && pos.old_path !== filePath) continue;

    let side: AnnotationSide;
    let lineNumber: number;
    if (pos.new_line != null) {
      side = 'additions';
      lineNumber = pos.new_line;
    } else if (pos.old_line != null) {
      side = 'deletions';
      lineNumber = pos.old_line;
    } else {
      continue;
    }
    results.push({ side, lineNumber, thread });
  }
  return results;
}

function DiscussionThreadView({ thread }: { thread: DiscussionThread }): React.JSX.Element {
  const isDraft = thread.id.startsWith('draft-');
  const firstNote = thread.notes[0];
  const pos = firstNote?.position;
  const isResolved = thread.notes.some((n) => n.resolved === true);
  const isResolvable = thread.notes.some((n) => n.resolvable === true);

  const [collapsed, setCollapsed] = useState(isResolved);
  const [replyText, setReplyText] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resolved, setResolved] = useState(isResolved);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [kebabOpenNoteId, setKebabOpenNoteId] = useState<number | null>(null);
  const [deletedNoteIds, setDeletedNoteIds] = useState<Set<number>>(new Set());

  const visibleNotes = thread.notes.filter((n) => !deletedNoteIds.has(n.id));

  const lineRangeLabel = useMemo(() => {
    if (pos == null) return null;
    const parts: string[] = [];
    if (pos.old_line != null) parts.push(`-${pos.old_line}`);
    if (pos.new_line != null) parts.push(`+${pos.new_line}`);
    return parts.length > 0 ? parts.join(' to ') : null;
  }, [pos]);

  const handleReply = async () => {
    const body = replyText.trim();
    if (body.length === 0 || isDraft) return;
    const ctx = getMrContext();
    if (ctx == null) return;
    setSubmitting(true);
    const encodedProject = encodeURIComponent(ctx.projectPath);
    const csrf = getCsrfToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrf != null) headers['X-CSRF-Token'] = csrf;
    try {
      const response = await fetch(
        `/api/v4/projects/${encodedProject}/merge_requests/${ctx.mrIid}/discussions/${thread.id}/notes`,
        { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ body }) }
      );
      if (response.ok) {
        const newNote = (await response.json()) as DiscussionNote;
        thread.notes.push(newNote);
        setReplyText('');
        setReplyOpen(false);
      } else {
        showToast('Failed to post reply.', 'error');
      }
    } catch {
      showToast('Failed to post reply.', 'error');
    }
    setSubmitting(false);
  };

  const handleResolve = async () => {
    const ctx = getMrContext();
    if (ctx == null) return;
    const encodedProject = encodeURIComponent(ctx.projectPath);
    const csrf = getCsrfToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrf != null) headers['X-CSRF-Token'] = csrf;
    const newResolved = !resolved;
    try {
      const response = await fetch(
        `/api/v4/projects/${encodedProject}/merge_requests/${ctx.mrIid}/discussions/${thread.id}`,
        { method: 'PUT', credentials: 'same-origin', headers, body: JSON.stringify({ resolved: newResolved }) }
      );
      if (response.ok) {
        setResolved(newResolved);
        if (newResolved) setCollapsed(true);
      } else {
        showToast('Failed to resolve thread.', 'error');
      }
    } catch {
      showToast('Failed to resolve thread.', 'error');
    }
  };

  const handleEdit = async (noteId: number) => {
    const body = editText.trim();
    if (body.length === 0) return;
    const ctx = getMrContext();
    if (ctx == null) return;
    const encodedProject = encodeURIComponent(ctx.projectPath);
    const csrf = getCsrfToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrf != null) headers['X-CSRF-Token'] = csrf;
    try {
      const response = await fetch(
        `/api/v4/projects/${encodedProject}/merge_requests/${ctx.mrIid}/discussions/${thread.id}/notes/${noteId}`,
        { method: 'PUT', credentials: 'same-origin', headers, body: JSON.stringify({ body }) }
      );
      if (response.ok) {
        const note = thread.notes.find((n) => n.id === noteId);
        if (note != null) note.body = body;
        setEditingNoteId(null);
        setEditText('');
      } else {
        showToast('Failed to edit comment.', 'error');
      }
    } catch {
      showToast('Failed to edit comment.', 'error');
    }
  };

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const noteActionBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    lineHeight: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  };

  const iconSvg = (d: string) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ display: 'block' }}>
      <path d={d} />
    </svg>
  );

  // SVG icon paths (from GitLab's icon set)
  const icons = {
    checkCircle: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm3.03 4.97a.75.75 0 0 0-1.06 0L7 8.94 5.53 7.47a.75.75 0 1 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0 0-1.06z',
    smile: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zM5.5 6.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM4.5 9.5a.5.5 0 0 0-.09.99A5.25 5.25 0 0 0 8 12a5.25 5.25 0 0 0 3.59-1.51.5.5 0 0 0-.68-.73A4.25 4.25 0 0 1 8 11a4.25 4.25 0 0 1-2.91-1.24.5.5 0 0 0-.59-.26z',
    reply: 'M6.5 2.5a.75.75 0 0 0-1.28-.53l-4.5 4.5a.75.75 0 0 0 0 1.06l4.5 4.5a.75.75 0 0 0 1.28-.53V9.06c3.93.18 5.47 1.72 6.25 3.47a.75.75 0 0 0 1.4-.2c.07-.36.1-.74.1-1.08 0-4.22-3.07-7.25-7.75-7.5V2.5z',
    pencil: 'M11.54 1.96a1.75 1.75 0 0 1 2.5 0l.5.5a1.75 1.75 0 0 1 0 2.5l-7.5 7.5a1 1 0 0 1-.42.26l-3 1a.75.75 0 0 1-.95-.95l1-3a1 1 0 0 1 .26-.42l7.6-7.39z',
    ellipsis: 'M4 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm5.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM13 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  };

  const kebabItemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--gl-text-color-default, inherit)',
  };

  const handleDeleteNote = async (noteId: number) => {
    const ctx = getMrContext();
    if (ctx == null) return;
    const encodedProject = encodeURIComponent(ctx.projectPath);
    const csrf = getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrf != null) headers['X-CSRF-Token'] = csrf;
    try {
      const url = isDraft
        ? `/api/v4/projects/${encodedProject}/merge_requests/${ctx.mrIid}/draft_notes/${noteId}`
        : `/api/v4/projects/${encodedProject}/merge_requests/${ctx.mrIid}/discussions/${thread.id}/notes/${noteId}`;
      const response = await fetch(url, { method: 'DELETE', credentials: 'same-origin', headers });
      if (response.ok) {
        setDeletedNoteIds((prev) => new Set(prev).add(noteId));
        showToast('Comment deleted.', 'success');
        setKebabOpenNoteId(null);
      } else {
        showToast('Failed to delete comment.', 'error');
      }
    } catch {
      showToast('Failed to delete comment.', 'error');
    }
    setKebabOpenNoteId(null);
  };

  if (visibleNotes.length === 0) return <></>;

  return (
    <div style={{
      border: '1px solid var(--gl-border-color-default, #dcdcde)',
      borderRadius: '6px',
      background: 'var(--gl-background-color-default, #fff)',
      marginBottom: '8px',
      overflow: 'visible',
    }}>
      {/* Line range header */}
      {lineRangeLabel != null && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--gl-background-color-subtle, #fafafa)',
          borderBottom: '1px solid var(--gl-border-color-default, #dcdcde)',
          fontSize: '12px',
          color: 'var(--gl-text-color-subtle, #626168)',
        }}>
          Comment on line {lineRangeLabel}
        </div>
      )}

      {/* Resolved/collapsed toggle */}
      {resolved && (
        <div
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            fontSize: '13px',
            color: 'var(--gl-text-color-subtle, #626168)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          onClick={() => setCollapsed(!collapsed)}
        >
          <span style={{ fontSize: '10px' }}>{collapsed ? '▶' : '▼'}</span>
          <span style={{ color: '#108548' }}>✓ Resolved</span>
          <span>by {thread.notes[thread.notes.length - 1]?.author.name ?? 'unknown'}</span>
        </div>
      )}

      {/* Notes */}
      {!collapsed && (
        <div style={{ padding: '12px' }}>
          {visibleNotes.map((note) => (
            <div key={note.id} style={{ marginBottom: '12px' }}>
              {/* Author row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                {note.author.avatar_url != null && (
                  <img
                    src={note.author.avatar_url}
                    alt=""
                    style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                  />
                )}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>{note.author.name}</span>
                  {note.author.username != null && (
                    <span style={{ fontSize: '12px', color: 'var(--gl-text-color-subtle, #626168)' }}>
                      @{note.author.username}
                    </span>
                  )}
                  <span style={{ fontSize: '12px', color: 'var(--gl-text-color-subtle, #626168)' }}>
                    {timeAgo(note.created_at)}
                  </span>
                  {isDraft && (
                    <span style={{
                      fontSize: '11px',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      background: '#f5a623',
                      color: '#fff',
                      fontWeight: 500,
                    }}>
                      draft
                    </span>
                  )}
                </div>
                {/* Action buttons toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
                  {!isDraft && note.resolvable && (
                    <button
                      type="button"
                      title={resolved ? 'Unresolve thread' : 'Resolve thread'}
                      style={{ ...noteActionBtnStyle, color: resolved ? '#108548' : undefined }}
                      onClick={() => void handleResolve()}
                    >
                      {iconSvg(icons.checkCircle)}
                    </button>
                  )}
                  {!isDraft && (
                    <button
                      type="button"
                      title="Add reaction"
                      style={noteActionBtnStyle}
                      onClick={() => {
                        const ctx = getMrContext();
                        if (ctx != null) {
                          window.open(`/${ctx.projectPath}/-/merge_requests/${ctx.mrIid}#note_${note.id}`, '_blank');
                        }
                      }}
                    >
                      {iconSvg(icons.smile)}
                    </button>
                  )}
                  {!isDraft && (
                    <button
                      type="button"
                      title="Reply"
                      style={noteActionBtnStyle}
                      onClick={() => setReplyOpen(true)}
                    >
                      {iconSvg(icons.reply)}
                    </button>
                  )}
                  <button
                    type="button"
                    title="Edit"
                    style={noteActionBtnStyle}
                    onClick={() => {
                      setEditingNoteId(note.id);
                      setEditText(note.body);
                    }}
                  >
                    {iconSvg(icons.pencil)}
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      title="More actions"
                      style={noteActionBtnStyle}
                      onClick={() => setKebabOpenNoteId(kebabOpenNoteId === note.id ? null : note.id)}
                    >
                      {iconSvg(icons.ellipsis)}
                    </button>
                    {kebabOpenNoteId === note.id && (
                        <div style={{
                          position: 'absolute',
                          right: 0,
                          top: '100%',
                          marginTop: '4px',
                          background: 'var(--gl-background-color-default, #fff)',
                          border: '1px solid var(--gl-border-color-default, #dcdcde)',
                          borderRadius: '6px',
                          boxShadow: '0 2px 8px rgba(0,0,0,.15)',
                          zIndex: 100,
                          minWidth: '160px',
                          padding: '4px 0',
                        }}>
                          <button
                            type="button"
                            style={kebabItemStyle}
                            onClick={() => {
                              const ctx = getMrContext();
                              if (ctx != null) {
                                const url = `${window.location.origin}/${ctx.projectPath}/-/merge_requests/${ctx.mrIid}#note_${note.id}`;
                                void navigator.clipboard.writeText(url);
                                showToast('Link copied to clipboard', 'success');
                              }
                              setKebabOpenNoteId(null);
                            }}
                          >
                            Copy link
                          </button>
                          <button
                            type="button"
                            style={kebabItemStyle}
                            onClick={() => {
                              void navigator.clipboard.writeText(note.body);
                              showToast('Comment copied to clipboard', 'success');
                              setKebabOpenNoteId(null);
                            }}
                          >
                            Copy comment
                          </button>
                          <button
                            type="button"
                            style={{ ...kebabItemStyle, color: '#dd2b0e' }}
                            onClick={() => void handleDeleteNote(note.id)}
                          >
                            Delete comment
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
              </div>

              {/* Note body or edit form */}
              {editingNoteId === note.id ? (
                <div style={{ marginTop: '4px' }}>
                  <textarea
                    style={{
                      width: '100%',
                      minHeight: '60px',
                      padding: '8px',
                      border: '1px solid var(--gl-border-color-default, #dcdcde)',
                      borderRadius: '4px',
                      font: '13px/1.4 ui-monospace, monospace',
                      resize: 'vertical',
                      background: 'var(--gl-background-color-default, #fff)',
                      color: 'var(--gl-text-color-default, inherit)',
                    }}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void handleEdit(note.id); }
                      if (e.key === 'Escape') { setEditingNoteId(null); setEditText(''); }
                    }}
                  />
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn gl-button btn-default btn-sm" onClick={() => { setEditingNoteId(null); setEditText(''); }}>Cancel</button>
                    <button type="button" className="btn gl-button btn-confirm btn-sm" onClick={() => void handleEdit(note.id)}>Save</button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '2px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13px', lineHeight: '1.5' }}>
                  {note.body}
                </div>
              )}
            </div>
          ))}

          {/* Reply + Resolve row */}
          {!isDraft && (
            <div style={{ marginTop: '8px' }}>
              {replyOpen ? (
                <div>
                  <textarea
                    style={{
                      width: '100%',
                      minHeight: '60px',
                      padding: '8px',
                      border: '1px solid var(--gl-border-color-default, #dcdcde)',
                      borderRadius: '4px',
                      font: '13px/1.4 ui-monospace, monospace',
                      resize: 'vertical',
                      background: 'var(--gl-background-color-default, #fff)',
                      color: 'var(--gl-text-color-default, inherit)',
                    }}
                    placeholder="Reply… (Ctrl+Enter to submit)"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void handleReply(); }
                      if (e.key === 'Escape') { setReplyOpen(false); setReplyText(''); }
                    }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn gl-button btn-default btn-sm" onClick={() => { setReplyOpen(false); setReplyText(''); }}>Cancel</button>
                    <button type="button" className="btn gl-button btn-confirm btn-sm" disabled={submitting} onClick={() => void handleReply()}>
                      {submitting ? 'Sending…' : 'Reply'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    placeholder="Reply..."
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      border: '1px solid var(--gl-border-color-default, #dcdcde)',
                      borderRadius: '4px',
                      fontSize: '13px',
                      cursor: 'pointer',
                      background: 'var(--gl-background-color-default, #fff)',
                      color: 'var(--gl-text-color-subtle, #626168)',
                    }}
                    onClick={() => setReplyOpen(true)}
                  />
                  {isResolvable && (
                    <button
                      type="button"
                      className="btn gl-button btn-default btn-sm"
                      onClick={() => void handleResolve()}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {resolved ? 'Unresolve thread' : 'Resolve thread'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PierreCodeViewHeader({
  fileLoading,
  item,
  onToggle,
  onToggleFullFile,
  showingFullFile,
}: {
  fileLoading: boolean;
  item: CodeViewItem<AnnotationMeta>;
  onToggle: () => void;
  onToggleFullFile: () => void;
  showingFullFile: boolean;
}): React.JSX.Element | null {
  if (item.type !== 'diff') return null;

  const path = item.id;
  const file = item.fileDiff;
  const stats = useMemo(() => getFileStats(file), [file]);
  const fileKey = useMemo(() => hashPath(path), [path]);
  const nativePaths = useMemo(() => getDiffFilePaths(file), [file]);
  const nativeActions = useNativeFileActions(nativePaths);

  return (
    <div
      className="js-file-title file-title file-title-flex-parent gl-rounded-bl-none gl-rounded-br-none !gl-border-0 gitlab-pierre-codeview-header"
      data-gitlab-pierre-file={path}
      data-path={path}
      id={`gitlab-pierre-file-${fileKey}`}
    >
      <div className="file-header-content">
        <button
          aria-expanded={!item.collapsed}
          aria-label={item.collapsed ? 'Show file contents' : 'Hide file contents'}
          className="btn-icon gl-mr-2 btn gl-button btn-default btn-sm btn-default-tertiary"
          onClick={onToggle}
          type="button"
        >
          <span className="gl-button-text">
            <ChevronToggleIcon collapsed={item.collapsed === true} />
          </span>
        </button>
        <a
          className="gl-mr-2 gl-break-all !gl-no-underline"
          href={`#gitlab-pierre-file-${fileKey}`}
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
      <div className="file-actions gl-ml-auto gl-flex gl-items-center gl-self-start gl-gap-2">
        {fileLoading ? (
          <span className="gitlab-pierre-full-file-loading gl-text-secondary">
            Loading full file…
          </span>
        ) : null}
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
        {nativeActions.viewedCheckbox != null ? (
          <FileViewedCheckbox
            fileKey={fileKey}
            nativeCheckbox={nativeActions.viewedCheckbox}
            paths={nativePaths}
          />
        ) : null}
        {nativeActions.commentToggle != null ? (
          <FileCommentButton
            nativeButton={nativeActions.commentToggle}
            paths={nativePaths}
          />
        ) : null}
        <FileActionsKebab
          fileKey={fileKey}
          filePath={path}
          nativeButton={nativeActions.kebabToggle}
          onToggleFullFile={onToggleFullFile}
          paths={nativePaths}
          showingFullFile={showingFullFile}
        />
      </div>
    </div>
  );
}

function PierreDiffFile({
  areDiffsCollapsed,
  discussions,
  file,
  onToggle,
  path,
  themeOptions,
  themeSettingsKey,
  unsafeCSS,
}: {
  areDiffsCollapsed: boolean;
  discussions: DiscussionThread[] | null;
  file: FileDiffMetadata;
  onToggle: () => void;
  path: string;
  themeOptions: { theme: Record<'dark' | 'light', DiffsThemeNames>; themeType: ThemeTypes };
  themeSettingsKey: string;
  unsafeCSS: string;
}): React.JSX.Element {
  const stats = useMemo(() => getFileStats(file), [file]);
  const fileKey = useMemo(() => hashPath(path), [path]);
  const fileId = `gitlab-pierre-file-${fileKey}`;
  const contentId = `gitlab-pierre-content-${fileKey}`;
  const nativePaths = useMemo(() => getDiffFilePaths(file), [file]);
  const nativeActions = useNativeFileActions(nativePaths);

  const [showFullFile, setShowFullFile] = useState(false);
  const [fullFileDiff, setFullFileDiff] = useState<FileDiffMetadata | null>(null);
  const [fullFileLoading, setFullFileLoading] = useState(false);

  const toggleFullFile = useCallback(() => {
    setShowFullFile((prev) => {
      const next = !prev;
      if (next && fullFileDiff == null) {
        setFullFileLoading(true);
        void fetchFullFileDiff(file).then((result) => {
          setFullFileDiff(result);
          setFullFileLoading(false);
        }).catch((err) => {
          console.warn('[GitLab Pierre] Failed to fetch full file:', err);
          setFullFileLoading(false);
        });
      }
      return next;
    });
  }, [file, fullFileDiff]);

  const [activeCommentLine, setActiveCommentLine] = useState<ActiveCommentLine | null>(null);
  const [commentHost, setCommentHost] = useState<HTMLElement | null>(null);
  const selectedRangeRef = useRef<SelectedLineRange | null>(null);
  const lastMultiLineRangeRef = useRef<{ range: SelectedLineRange; at: number } | null>(null);

  const filePath = useMemo(() => normalizeDiffPath(file.name) ?? file.name, [file.name]);
  const fileDiscussions = useMemo(() => {
    if (discussions == null) return [];
    return getDiscussionsForFile(discussions, filePath);
  }, [discussions, filePath]);

  const lineAnnotations = useMemo<DiffLineAnnotation<AnnotationMeta>[] | undefined>(() => {
    const annotations: DiffLineAnnotation<AnnotationMeta>[] = [];
    // Existing discussions
    for (const d of fileDiscussions) {
      annotations.push({
        side: d.side,
        lineNumber: d.lineNumber,
        metadata: { kind: 'discussion', discussionId: d.thread.id, notes: d.thread.notes },
      });
    }
    // Active comment being composed
    if (activeCommentLine != null) {
      annotations.push({
        side: activeCommentLine.side,
        lineNumber: activeCommentLine.lineNumber,
        metadata: { kind: 'active-comment' },
      });
    }
    return annotations.length > 0 ? annotations : undefined;
  }, [activeCommentLine, fileDiscussions]);

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationMeta>) => {
      if (annotation.metadata?.kind === 'discussion') {
        return <DiscussionThreadView thread={{ id: annotation.metadata.discussionId, notes: annotation.metadata.notes }} />;
      }
      return <InlineCommentSlot setHost={setCommentHost} />;
    },
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
        <div className="file-actions gl-ml-auto gl-flex gl-items-center gl-self-start gl-gap-2">
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
          <FileViewedCheckbox
            fileKey={fileKey}
            nativeCheckbox={nativeActions.viewedCheckbox}
            paths={nativePaths}
          />
          <FileCommentButton
            nativeButton={nativeActions.commentToggle}
            paths={nativePaths}
          />
          <FileActionsKebab
            fileKey={fileKey}
            filePath={path}
            nativeButton={nativeActions.kebabToggle}
            onToggleFullFile={toggleFullFile}
            paths={nativePaths}
            showingFullFile={showFullFile}
          />
        </div>
      </div>
      <div
        className="diff-content gl-rounded-none gl-rounded-bl-lg gl-rounded-br-lg gl-border-0"
        data-testid="content-area"
        hidden={areDiffsCollapsed}
        id={contentId}
      >
        {fullFileLoading ? (
          <div className="gl-p-4 gl-text-secondary">Loading full file…</div>
        ) : (
          <FileDiff<AnnotationMeta>
            disableWorkerPool
            fileDiff={showFullFile && fullFileDiff != null ? fullFileDiff : file}
            key={`${themeSettingsKey}:${areDiffsCollapsed ? 'c' : 'e'}:${showFullFile && fullFileDiff != null ? 'full' : 'hunks'}`}
            lineAnnotations={lineAnnotations}
            options={{
              collapsedContextThreshold: showFullFile && fullFileDiff != null ? undefined : 12,
              collapsed: false,
              diffStyle: 'unified',
              enableGutterUtility: true,
              enableLineSelection: true,
              expandUnchanged: showFullFile && fullFileDiff != null,
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
        )}
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
  enhancePierreUnifiedLineNumbers(shadowRoot);
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

function enhancePierreUnifiedLineNumbers(shadowRoot: ShadowRoot): void {
  shadowRoot.querySelectorAll<HTMLElement>('[data-code][data-unified]').forEach((code) => {
    const gutterNumbers = Array.from(
      code.querySelectorAll<HTMLElement>('[data-gutter] [data-column-number]')
    );
    const contentLines = Array.from(
      code.querySelectorAll<HTMLElement>('[data-content] [data-line]')
    );

    gutterNumbers.forEach((numberElement, index) => {
      const contentLine = contentLines[index];
      if (contentLine == null) return;

      const type = contentLine.getAttribute('data-line-type');
      const line = contentLine.getAttribute('data-line') ?? '';
      const altLine = contentLine.getAttribute('data-alt-line');
      const oldLine = type === 'change-addition' ? '' : (altLine ?? line);
      const newLine = type === 'change-deletion' ? '' : line;
      const signature = `${oldLine}:${newLine}`;
      if (numberElement.getAttribute('data-gitlab-pierre-dual-line-signature') === signature) {
        return;
      }

      let wrapper = numberElement.querySelector<HTMLElement>(
        '[data-gitlab-pierre-dual-line-numbers]'
      );
      if (wrapper == null) {
        wrapper = document.createElement('span');
        wrapper.setAttribute('data-gitlab-pierre-dual-line-numbers', '');
      }

      const utilitySlot = numberElement.querySelector('[data-gutter-utility-slot]');
      Array.from(numberElement.childNodes).forEach((child) => {
        if (child !== wrapper && child !== utilitySlot) {
          child.remove();
        }
      });
      if (!numberElement.contains(wrapper)) {
        const referenceNode = utilitySlot?.parentNode === numberElement
          ? utilitySlot
          : numberElement.firstChild;
        numberElement.insertBefore(wrapper, referenceNode);
      }

      const oldLineElement = document.createElement('span');
      oldLineElement.setAttribute('data-gitlab-pierre-old-line', '');
      oldLineElement.textContent = oldLine;

      const newLineElement = document.createElement('span');
      newLineElement.setAttribute('data-gitlab-pierre-new-line', '');
      newLineElement.textContent = newLine;

      wrapper.replaceChildren(oldLineElement, newLineElement);
      numberElement.setAttribute('data-gitlab-pierre-dual-line-signature', signature);
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

interface ActiveCodeViewComment {
  path: string;
  file: FileDiffMetadata;
  line: ActiveCommentLine;
}

function getLineAnnotationsForFile(
  discussions: DiscussionThread[] | null,
  filePath: string,
  activeCommentLine: ActiveCommentLine | null
): DiffLineAnnotation<AnnotationMeta>[] | undefined {
  const annotations: DiffLineAnnotation<AnnotationMeta>[] = [];
  if (discussions != null) {
    for (const discussion of getDiscussionsForFile(discussions, filePath)) {
      annotations.push({
        side: discussion.side,
        lineNumber: discussion.lineNumber,
        metadata: {
          kind: 'discussion',
          discussionId: discussion.thread.id,
          notes: discussion.thread.notes,
        },
      });
    }
  }
  if (activeCommentLine != null) {
    annotations.push({
      side: activeCommentLine.side,
      lineNumber: activeCommentLine.lineNumber,
      metadata: { kind: 'active-comment' },
    });
  }
  return annotations.length > 0 ? annotations : undefined;
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
  const ref = useRef<HTMLButtonElement>(null);

  // Attach a native pointerdown listener to stop propagation before Pierre's
  // InteractionManager (on the shadow-DOM <pre>) can start a line-selection
  // session. The actual action is handled by onClick for proper button
  // semantics (keyboard, drag-away-to-cancel).
  useEffect(() => {
    const btn = ref.current;
    if (btn == null) return;

    const handler = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    btn.addEventListener('pointerdown', handler);
    return () => btn.removeEventListener('pointerdown', handler);
  }, []);

  return (
    <button
      ref={ref}
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
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      title="Comment on this line"
      type="button"
    >
      +
    </button>
  );
}

function InlineCommentSlot({
  onUnmount,
  setHost,
}: {
  onUnmount?: () => void;
  setHost: (el: HTMLElement | null) => void;
}): React.JSX.Element {
  const onUnmountRef = useRef(onUnmount);

  useEffect(() => {
    onUnmountRef.current = onUnmount;
  }, [onUnmount]);

  useEffect(() => {
    return () => {
      onUnmountRef.current?.();
    };
  }, []);

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
  '[data-testid="note-edit-form"]',
  '[data-testid="new-discussion-form"]',
  'form.reply-placeholder-text-field',
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
  'pointer-events: none',
  'z-index: -1',
  'opacity: 0',
  'display: block',
].map((rule) => `${rule} !important`).join('; ');

const PAGE_BRIDGE_SCRIPT = 'gitlab-pierre-page-bridge.js';
const PAGE_BRIDGE_REQUEST_EVENT = 'gitlab-pierre:native-file-request';
const PAGE_BRIDGE_RESPONSE_EVENT = 'gitlab-pierre:native-file-response';
const PAGE_BRIDGE_INJECTED_ATTR = 'data-gitlab-pierre-page-bridge-injected';

let pageBridgeInjection: Promise<boolean> | null = null;

// --- API-based inline comment fallback ---

interface MrContext {
  projectPath: string;
  mrIid: string;
}

function getMrContext(): MrContext | null {
  const match = location.pathname.match(/^\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (match?.[1] == null || match[2] == null) return null;
  return { projectPath: match[1], mrIid: match[2] };
}

function getCsrfToken(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? null;
}

interface DiffVersionInfo {
  base_commit_sha: string;
  head_commit_sha: string;
  start_commit_sha: string;
}

let cachedDiffVersion: DiffVersionInfo | null = null;

async function fetchDiffVersionInfo(ctx: MrContext): Promise<DiffVersionInfo | null> {
  if (cachedDiffVersion != null) return cachedDiffVersion;
  const encodedProject = encodeURIComponent(ctx.projectPath);
  const url = `/api/v4/projects/${encodedProject}/merge_requests/${ctx.mrIid}/versions`;
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const versions = (await response.json()) as Array<{
      base_commit_sha?: string;
      head_commit_sha?: string;
      start_commit_sha?: string;
    }>;
    const latest = versions[0];
    if (latest?.base_commit_sha == null || latest.head_commit_sha == null || latest.start_commit_sha == null) {
      return null;
    }
    cachedDiffVersion = {
      base_commit_sha: latest.base_commit_sha,
      head_commit_sha: latest.head_commit_sha,
      start_commit_sha: latest.start_commit_sha,
    };
    return cachedDiffVersion;
  } catch {
    return null;
  }
}

async function createDraftNote(
  ctx: MrContext,
  version: DiffVersionInfo,
  filePath: string,
  oldFilePath: string,
  lineNumber: number,
  side: AnnotationSide,
  body: string
): Promise<boolean> {
  const encodedProject = encodeURIComponent(ctx.projectPath);
  const url = `/api/v4/projects/${encodedProject}/merge_requests/${ctx.mrIid}/draft_notes`;
  const csrf = getCsrfToken();
  const position: Record<string, string | number> = {
    position_type: 'text',
    base_sha: version.base_commit_sha,
    head_sha: version.head_commit_sha,
    start_sha: version.start_commit_sha,
    new_path: filePath,
    old_path: oldFilePath,
  };
  if (side === 'additions') {
    position.new_line = lineNumber;
  } else {
    position.old_line = lineNumber;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (csrf != null) headers['X-CSRF-Token'] = csrf;

  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ note: body, position }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function renderApiCommentForm(
  host: HTMLElement,
  file: FileDiffMetadata,
  line: ActiveCommentLine,
  onDone: () => void
): void {
  const ctx = getMrContext();
  if (ctx == null) {
    showToast('Cannot determine MR context for inline comment.', 'error');
    onDone();
    return;
  }

  const filePath = normalizeDiffPath(file.name) ?? file.name;
  const oldFilePath = normalizeDiffPath(file.prevName ?? file.name) ?? filePath;
  const wrapper = document.createElement('div');
  wrapper.className = 'gitlab-pierre-comment-slot';
  wrapper.style.cssText = 'padding: 12px; border: 1px solid var(--gl-border-color-default, #dcdcde); border-radius: 6px; margin: 8px 0; background: var(--gl-background-color-default, #fff);';

  const label = document.createElement('div');
  label.style.cssText = 'font-size: 12px; color: var(--gl-text-color-subtle, #626168); margin-bottom: 8px;';
  label.textContent = `Draft comment on ${filePath}:${line.lineNumber} (${line.side})`;

  const textarea = document.createElement('textarea');
  textarea.style.cssText = 'width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--gl-border-color-default, #dcdcde); border-radius: 4px; font: 13px/1.4 ui-monospace, monospace; resize: vertical; background: var(--gl-background-color-default, #fff); color: var(--gl-text-color-default, inherit);';
  textarea.placeholder = 'Write a comment… (Ctrl+Enter to submit)';
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitBtn.click();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelBtn.click();
    }
  });

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end;';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn gl-button btn-default btn-sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    wrapper.remove();
    onDone();
  });

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn gl-button btn-confirm btn-sm';
  submitBtn.textContent = 'Add draft comment';
  submitBtn.addEventListener('click', () => {
    const body = textarea.value.trim();
    if (body.length === 0) {
      textarea.focus();
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    void (async () => {
      const version = await fetchDiffVersionInfo(ctx);
      if (version == null) {
        showToast('Could not fetch MR version info.', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add draft comment';
        return;
      }
      const ok = await createDraftNote(ctx, version, filePath, oldFilePath, line.lineNumber, line.side, body);
      if (ok) {
        showToast('Draft comment added.', 'success');
        // Invalidate discussions cache and trigger refetch
        discussionsCache.delete(`${ctx.projectPath}!${ctx.mrIid}`);
        if (typeof (window as any).__pierreRefetchDiscussions === 'function') {
          (window as any).__pierreRefetchDiscussions();
        }
        wrapper.remove();
        onDone();
      } else {
        showToast('Failed to create draft comment.', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add draft comment';
      }
    })();
  });

  actions.append(cancelBtn, submitBtn);
  wrapper.append(label, textarea, actions);
  host.innerHTML = '';
  host.append(wrapper);
  textarea.focus();
}

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

const NATIVE_DIFF_FILE_SELECTOR = '.diff-file, diff-file, [data-testid="rd-diff-file"]';

function findDiffsAppInstance(targets: MountTargets): DiffsAppLike | null {
  const seed = targets.diffContainer.querySelector(NATIVE_DIFF_FILE_SELECTOR) ?? targets.diffContainer;

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

function ensurePageBridgeInjected(): Promise<boolean> {
  if (document.documentElement.hasAttribute(PAGE_BRIDGE_INJECTED_ATTR)) {
    return Promise.resolve(true);
  }

  if (pageBridgeInjection != null) {
    return pageBridgeInjection;
  }

  pageBridgeInjection = new Promise((resolve) => {
    if (typeof chrome === 'undefined' || chrome.runtime?.getURL == null) {
      console.warn('[GitLab Pierre] Page bridge unavailable: chrome.runtime.getURL missing.');
      resolve(false);
      return;
    }

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(PAGE_BRIDGE_SCRIPT);
    script.async = false;

    script.addEventListener(
      'load',
      () => {
        document.documentElement.setAttribute(PAGE_BRIDGE_INJECTED_ATTR, 'true');
        script.remove();
        resolve(true);
      },
      { once: true }
    );
    script.addEventListener(
      'error',
      () => {
        console.warn('[GitLab Pierre] Failed to inject page bridge.');
        script.remove();
        pageBridgeInjection = null;
        resolve(false);
      },
      { once: true }
    );

    (document.head ?? document.documentElement).append(script);
  });

  return pageBridgeInjection;
}

function parsePageBridgeResponse(detail: unknown): Record<string, unknown> | null {
  if (typeof detail !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function requestNativeFileMountInPageWorld(
  paths: string[],
  targets: MountTargets
): Promise<boolean> {
  const bridgeReady = await ensurePageBridgeInjected();
  if (!bridgeReady) return false;

  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const response = await new Promise<Record<string, unknown> | null>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      document.removeEventListener(PAGE_BRIDGE_RESPONSE_EVENT, onResponse);
      resolve(null);
    }, 5000);

    const finish = (payload: Record<string, unknown> | null) => {
      window.clearTimeout(timeoutId);
      document.removeEventListener(PAGE_BRIDGE_RESPONSE_EVENT, onResponse);
      resolve(payload);
    };

    function onResponse(event: Event): void {
      const payload = parsePageBridgeResponse((event as CustomEvent).detail);
      if (payload?.requestId !== requestId) return;
      finish(payload);
    }

    document.addEventListener(PAGE_BRIDGE_RESPONSE_EVENT, onResponse);
    targets.diffContainer.dispatchEvent(
      new CustomEvent(PAGE_BRIDGE_REQUEST_EVENT, {
        bubbles: true,
        detail: JSON.stringify({ paths, requestId }),
      })
    );
  });

  console.info('[GitLab Pierre] page bridge mount response', { paths, response });
  return response?.ok === true;
}

async function waitForNativeDiffFile(paths: string[], targets: MountTargets): Promise<boolean> {
  return waitForCondition(
    () => findNativeDiffFiles(paths).length > 0,
    targets.diffContainer,
    5000
  );
}

async function mountNativeFileViaPageBridge(
  paths: string[],
  targets: MountTargets
): Promise<boolean> {
  const requested = await requestNativeFileMountInPageWorld(paths, targets);
  if (!requested) return false;
  return waitForNativeDiffFile(paths, targets);
}

async function forceNativeRenderAndWait(
  paths: string[],
  targets: MountTargets
): Promise<boolean> {
  const c = targets.diffContainer;
  // Temporarily make the container fully visible so GitLab's lazy-loading
  // (IntersectionObserver, Vue watchers, etc.) can render the diff files.
  const prevStyle = c.style.cssText;
  const prevHidden = c.classList.contains(HIDDEN_CLASS);
  c.classList.remove(HIDDEN_CLASS);
  c.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; overflow: auto !important; z-index: -1 !important; opacity: 0.01 !important;';
  console.info('[GitLab Pierre] forceNativeRenderAndWait: revealing container', { paths });

  const found = await waitForCondition(
    () => findNativeDiffFiles(paths).length > 0,
    c,
    8000
  );

  // Restore the hidden state
  c.style.cssText = prevStyle;
  if (prevHidden) c.classList.add(HIDDEN_CLASS);

  console.info('[GitLab Pierre] forceNativeRenderAndWait: result', { found, paths });
  return found;
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
    const seedEl = targets.diffContainer.querySelector(NATIVE_DIFF_FILE_SELECTOR) ?? targets.diffContainer;
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
    if (ok) return true;
    const bridged = await mountNativeFileViaPageBridge(paths, targets);
    if (bridged) return true;
    // Last resort: make container fully visible to trigger lazy rendering
    return forceNativeRenderAndWait(paths, targets);
  }

  const entry = findNativeDiffEntry(app, paths);
  if (entry == null) {
    const ok = findNativeDiffFiles(paths).length > 0;
    log('no-entry-in-diffFiles', {
      ok,
      diffFilesCount: app.diffFiles.length,
      sampleEntries: app.diffFiles.slice(0, 3).map((e) => e.file_path),
    });
    return ok || mountNativeFileViaPageBridge(paths, targets);
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

  let mounted = await waitForNativeDiffFile(paths, targets);
  log('after-mount-wait', { mounted });
  if (!mounted) {
    mounted = await mountNativeFileViaPageBridge(paths, targets);
    log('after-page-bridge-mount-wait', { mounted });
  }
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
    // Try API-based comment form as fallback
    if (host != null && getMrContext() != null) {
      renderApiCommentForm(host, file, line, onTeardown);
    } else {
      showToast(message, 'error');
      onTeardown();
      fallbackToNativeForLine(file, line);
    }
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
      nativeButton.closest<HTMLElement>('.diff-file, diff-file, [data-testid="rd-diff-file"]') ?? nativeButton.ownerDocument.body;
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
  const filePaths = getDiffFilePaths(file);
  const nativeFiles = findNativeDiffFiles(filePaths);

  for (const nativeFile of nativeFiles) {
    const button = findNativeCommentButtonInFile(
      nativeFile,
      hoveredLine.lineNumber,
      hoveredLine.side
    );
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
  const diffFiles = Array.from(
    container.querySelectorAll<HTMLElement>(
      '.diff-file, diff-file, [data-testid="rd-diff-file"]'
    )
  );
  return diffFiles.filter((diffFile) => nativeDiffFileMatchesPath(diffFile, paths));
}

interface RapidDiffFileData {
  file_path?: string;
  old_path?: string;
  new_path?: string;
  file_hash?: string;
}

function readRapidDiffFileData(diffFile: HTMLElement): RapidDiffFileData | null {
  const raw = diffFile.getAttribute('data-file-data');
  if (raw == null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as RapidDiffFileData;
    return typeof parsed === 'object' && parsed != null ? parsed : null;
  } catch {
    return null;
  }
}

interface NativeFileActions {
  diffFile: HTMLElement | null;
  viewedCheckbox: HTMLInputElement | null;
  commentToggle: HTMLElement | null;
  kebabToggle: HTMLElement | null;
}

const EMPTY_NATIVE_FILE_ACTIONS: NativeFileActions = {
  diffFile: null,
  viewedCheckbox: null,
  commentToggle: null,
  kebabToggle: null,
};

function findNativeFileActions(paths: string[]): NativeFileActions {
  const [diffFile = null] = findNativeDiffFiles(paths);
  if (diffFile == null) return EMPTY_NATIVE_FILE_ACTIONS;
  const scope =
    diffFile.querySelector<HTMLElement>(
      '.rd-diff-file-header, [data-testid="rd-diff-file-header"]'
    ) ??
    diffFile.querySelector<HTMLElement>('.file-actions') ??
    diffFile.querySelector<HTMLElement>('.js-file-title') ??
    diffFile.querySelector<HTMLElement>('[data-testid="file-title-content"]') ??
    diffFile;
  const viewedCheckbox = findViewedCheckbox(scope);
  const commentToggle = findCommentButton(scope);
  const kebabToggle = findKebabToggleButton(scope);
  return { diffFile, viewedCheckbox, commentToggle, kebabToggle };
}

function findViewedCheckbox(scope: HTMLElement): HTMLInputElement | null {
  const rapidDiffs = scope.querySelector<HTMLInputElement>('input[data-viewed-checkbox]');
  if (rapidDiffs != null) return rapidDiffs;

  const byTestid = scope.querySelector<HTMLInputElement>(
    'input[data-testid="fileReviewCheckbox"], input[data-testid="file-review-checkbox"], input.js-file-reviewed-checkbox'
  );
  if (byTestid != null) return byTestid;

  for (const checkbox of Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    const containerText = (
      checkbox.closest('label, .gl-form-checkbox, [class*="checkbox"]')?.textContent ?? ''
    )
      .trim()
      .toLowerCase();
    if (containerText.includes('viewed')) return checkbox;

    const id = checkbox.id;
    if (id !== '') {
      const associated = scope.querySelector<HTMLElement>(`label[for="${CSS.escape(id)}"]`);
      const associatedText = (associated?.textContent ?? '').trim().toLowerCase();
      if (associatedText.includes('viewed')) return checkbox;
    }
  }

  const all = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  return all.length === 1 ? (all[0] ?? null) : null;
}

function findCommentButton(scope: HTMLElement): HTMLElement | null {
  const rapidDiffs = scope.querySelector<HTMLElement>(
    '[data-testid="comment-files-button"], button[data-click="fileComment"]'
  );
  if (rapidDiffs != null) return rapidDiffs;

  const byTestid = scope.querySelector<HTMLElement>(
    [
      '[data-testid="toggle-comments-button"]',
      '[data-testid="toggle-comments-btn"]',
      '[data-testid="toggle-discussion-button"]',
      '[data-testid="comments-toggle"]',
      'button.js-toggle-discussion-wrapper',
      'button.js-toggle-discussions',
    ].join(', ')
  );
  if (byTestid != null) return byTestid;

  for (const btn of Array.from(scope.querySelectorAll<HTMLElement>('button'))) {
    const label = (
      btn.getAttribute('aria-label') ??
      btn.getAttribute('title') ??
      ''
    ).toLowerCase();
    if (label === '') continue;
    if (/comment|discussion/.test(label) && /(show|hide|toggle)/.test(label)) {
      return btn;
    }
  }

  for (const btn of Array.from(scope.querySelectorAll<HTMLElement>('button'))) {
    if (btn.querySelector('use[href*="#comment"]') != null) return btn;
  }

  return null;
}

function isRapidDiffsCommentButton(button: HTMLElement | null): boolean {
  if (button == null) return false;
  return (
    button.getAttribute('data-testid') === 'comment-files-button' ||
    button.getAttribute('data-click') === 'fileComment'
  );
}

function findKebabToggleButton(scope: HTMLElement): HTMLElement | null {
  return (
    scope.querySelector<HTMLElement>('button[data-click="toggleOptionsMenu"]') ??
    scope.querySelector<HTMLElement>('[data-testid="file-actions-button"]') ??
    scope.querySelector<HTMLElement>('[data-testid="dropdown-toggle-btn"]') ??
    scope.querySelector<HTMLElement>('[data-testid="base-dropdown-toggle"]') ??
    findButtonByAriaLabel(
      scope,
      /^(more options|more actions|file actions|options for this file)/i
    ) ??
    scope.querySelector<HTMLElement>('button.gl-new-dropdown-toggle') ??
    scope.querySelector<HTMLElement>('button[aria-haspopup="menu"]') ??
    scope.querySelector<HTMLElement>('button[aria-haspopup="true"]')
  );
}

function findRapidDiffOptionsScript(diffFile: HTMLElement): HTMLScriptElement | null {
  return diffFile.querySelector<HTMLScriptElement>(
    '[data-options-menu] script[type="application/json"]'
  );
}

function findButtonByAriaLabel(scope: ParentNode, pattern: RegExp): HTMLElement | null {
  const candidates = Array.from(
    scope.querySelectorAll<HTMLElement>('button[aria-label], a[aria-label]')
  );
  return candidates.find((el) => pattern.test(el.getAttribute('aria-label') ?? '')) ?? null;
}

function nativeFileActionsEqual(a: NativeFileActions, b: NativeFileActions): boolean {
  return (
    a.diffFile === b.diffFile &&
    a.viewedCheckbox === b.viewedCheckbox &&
    a.commentToggle === b.commentToggle &&
    a.kebabToggle === b.kebabToggle
  );
}

function useNativeFileActions(paths: string[]): NativeFileActions {
  const pathsKey = paths.join('|');
  const [actions, setActions] = useState<NativeFileActions>(EMPTY_NATIVE_FILE_ACTIONS);

  useEffect(() => {
    let cancelled = false;
    let rafId: number | null = null;
    const refresh = () => {
      if (cancelled) return;
      const next = findNativeFileActions(paths);
      setActions((prev) => (nativeFileActionsEqual(prev, next) ? prev : next));
    };
    const scheduleRefresh = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        refresh();
      });
    };
    refresh();
    const container = mountState?.targets.diffContainer ?? null;
    let observer: MutationObserver | null = null;
    if (container != null) {
      observer = new MutationObserver(scheduleRefresh);
      observer.observe(container, { childList: true, subtree: true });
    }
    const interval = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      observer?.disconnect();
      window.clearInterval(interval);
      if (rafId != null) window.cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  return actions;
}

function nativeDiffFileMatchesPath(diffFile: HTMLElement, paths: string[]): boolean {
  const fileData = readRapidDiffFileData(diffFile);
  const values = [
    diffFile.dataset.filePath,
    diffFile.dataset.newPath,
    diffFile.dataset.oldPath,
    diffFile.dataset.path,
    diffFile.getAttribute('data-file-path'),
    diffFile.getAttribute('data-new-path'),
    diffFile.getAttribute('data-old-path'),
    fileData?.file_path,
    fileData?.new_path,
    fileData?.old_path,
    diffFile.querySelector<HTMLElement>('[data-file-path]')?.dataset.filePath,
    diffFile.querySelector<HTMLElement>('[data-new-path]')?.dataset.newPath,
    diffFile.querySelector<HTMLElement>('[data-old-path]')?.dataset.oldPath,
  ]
    .map((value) => normalizeDiffPath(value ?? undefined))
    .filter((value): value is string => value != null);

  const titleText = diffFile
    .querySelector(
      '.file-title-name, .diff-file-title, .rd-diff-file-title, .rd-diff-file-link, [data-testid="file-title"]'
    )
    ?.textContent?.trim();
  if (titleText != null) {
    values.push(normalizeDiffPath(titleText) ?? titleText);
  }

  return paths.some((path) => values.some((value) => value === path || value.endsWith(`/${path}`)));
}

function collectShadowRoots(root: Element): ShadowRoot[] {
  const results: ShadowRoot[] = [];
  const walk = (el: Element) => {
    if (el.shadowRoot != null) {
      results.push(el.shadowRoot);
      for (const child of el.shadowRoot.querySelectorAll('*')) {
        walk(child);
      }
    }
    for (const child of el.children) {
      walk(child);
    }
  };
  walk(root);
  return results;
}

function findNativeCommentButtonInFile(
  nativeFile: HTMLElement,
  lineNumber: number,
  side: AnnotationSide
): HTMLElement | null {
  const escapedLineNumber = CSS.escape(String(lineNumber));
  const interopSelectors =
    side === 'additions'
      ? [
          `[data-interop-type="new"][data-interop-new-line="${escapedLineNumber}"] a[data-linenumber="${escapedLineNumber}"]`,
          `[data-interop-type="new"][data-interop-line="${escapedLineNumber}"] a[data-linenumber="${escapedLineNumber}"]`,
        ]
      : [
          `[data-interop-type="old"][data-interop-old-line="${escapedLineNumber}"] a[data-linenumber="${escapedLineNumber}"]`,
          `[data-interop-type="old"][data-interop-line="${escapedLineNumber}"] a[data-linenumber="${escapedLineNumber}"]`,
        ];
  const preferredVisualSide = side === 'additions' ? 'right' : 'left';
  const fallbackVisualSide = preferredVisualSide === 'right' ? 'left' : 'right';
  const visualSideSelectors = (visualSide: 'left' | 'right') =>
    visualSide === 'right'
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
  const selectors = [
    ...interopSelectors,
    ...visualSideSelectors(preferredVisualSide),
    ...visualSideSelectors(fallbackVisualSide),
  ];

  // Search the main DOM tree of the native file
  for (const selector of selectors) {
    for (const lineAnchor of Array.from(nativeFile.querySelectorAll<HTMLElement>(selector))) {
      const button = findCommentButtonNearLineAnchor(lineAnchor);
      if (button != null) {
        return button;
      }
    }
  }

  // Rapid-diffs: search inside shadow roots of child custom elements
  const shadowRoots = collectShadowRoots(nativeFile);
  for (const root of shadowRoots) {
    for (const selector of selectors) {
      for (const lineAnchor of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
        const button = findCommentButtonNearLineAnchor(lineAnchor);
        if (button != null) {
          return button;
        }
      }
    }
  }

  console.debug('[GitLab Pierre] findNativeCommentButtonInFile: not found', {
    lineNumber,
    side,
    nativeFileTag: nativeFile.tagName,
    nativeFileTestId: nativeFile.getAttribute('data-testid'),
    childCount: nativeFile.children.length,
    shadowRootsFound: shadowRoots.length,
    hasInteropRows: nativeFile.querySelectorAll('[data-interop-type]').length,
    hasDiffLineNums: nativeFile.querySelectorAll('.diff-line-num').length,
    hasLineAnchors: nativeFile.querySelectorAll('a[data-linenumber]').length,
  });

  // If the file is collapsed (has header but no lines), try to expand it
  expandCollapsedNativeDiffFile(nativeFile);

  return null;
}

const EXPAND_ATTEMPTED_ATTR = 'data-gitlab-pierre-expand-attempted';

function expandCollapsedNativeDiffFile(nativeFile: HTMLElement): void {
  if (nativeFile.hasAttribute(EXPAND_ATTEMPTED_ATTR)) return;
  // Only expand if there are no line rows (file is collapsed)
  const hasLines =
    nativeFile.querySelectorAll('.diff-line-num, [data-interop-type], a[data-linenumber]').length > 0;
  if (hasLines) return;

  const expandButton =
    nativeFile.querySelector<HTMLElement>('button[aria-label="Show file contents"]') ??
    nativeFile.querySelector<HTMLElement>('button[aria-label="Expand file"]') ??
    nativeFile.querySelector<HTMLElement>('.js-file-title button.btn-icon') ??
    nativeFile.querySelector<HTMLElement>('[data-testid="expand-file"]');
  if (expandButton == null) return;

  nativeFile.setAttribute(EXPAND_ATTEMPTED_ATTR, '');
  console.info('[GitLab Pierre] expandCollapsedNativeDiffFile: clicking expand', {
    label: expandButton.getAttribute('aria-label'),
  });
  expandButton.click();
}

function findCommentButtonNearLineAnchor(lineAnchor: HTMLElement): HTMLElement | null {
  const sideContainer = lineAnchor.closest<HTMLElement>(
    '.diff-grid-left, .diff-grid-right, [data-testid="left-side"], [data-testid="right-side"]'
  );
  const lineNumberCell = lineAnchor.closest<HTMLElement>('.diff-line-num');
  const interopRow = lineAnchor.closest<HTMLElement>('[data-interop-type]');
  const scopes = [
    lineNumberCell,
    sideContainer,
    interopRow,
    lineAnchor.closest('.line_holder'),
    lineAnchor.parentElement,
  ];

  for (const scope of scopes) {
    if (!(scope instanceof HTMLElement)) continue;
    const button =
      scope.querySelector<HTMLElement>('.js-add-diff-note-button') ??
      scope.querySelector<HTMLElement>('[data-testid="add-diff-note-button"]') ??
      scope.querySelector<HTMLElement>('button[data-click="addDiffNote"]');
    if (button != null && !isDisabledButton(button)) {
      return button;
    }
  }

  // Rapid-diffs: the line anchor itself may act as the comment trigger
  if (lineAnchor.hasAttribute('data-linenumber') && lineAnchor.closest('[data-interop-type]') != null) {
    return lineAnchor;
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
  onFileSelected,
  onQueryChange,
  paths,
  query,
}: {
  fileInfoByPath: Map<string, FileBrowserFileInfo>;
  onFileSelected: (path: string) => void;
  onQueryChange: (query: string) => void;
  paths: string[];
  query: string;
}): React.JSX.Element {
  const model = useMemo(
    () =>
      new FileTreeModel({
        flattenEmptyDirectories: true,
        density: 'default',
        initialExpansion: 'open',
        onSearchChange: (value) => onQueryChange(value ?? ''),
        onSelectionChange: ([selectedPath]) => {
          if (selectedPath == null) return;
          onFileSelected(selectedPath);
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
        unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
      }),
    [fileInfoByPath, onFileSelected, onQueryChange, paths]
  );

  useEffect(() => {
    return () => {
      model.cleanUp();
    };
  }, [model]);

  useEffect(() => {
    model.setSearch(query.trim() === '' ? null : query);
  }, [model, query]);

  return <FileTree className="gitlab-pierre-tree" model={model} />;
}

function PierreFileList({
  fileInfoByPath,
  onFileSelected,
  paths,
  query,
}: {
  fileInfoByPath: Map<string, FileBrowserFileInfo>;
  onFileSelected: (path: string) => void;
  paths: string[];
  query: string;
}): React.JSX.Element {
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
                onClick={() => {
                  onFileSelected(path);
                }}
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

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.matches('input, textarea, select');
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
