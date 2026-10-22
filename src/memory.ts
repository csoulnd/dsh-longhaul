/**
 * Append-only tree memory for one Long Haul root session. Decisions and
 * artifacts are tree-wide; findings are stored per author and listed only for
 * that author's branch. Each record is one JSONL line, so history survives
 * restarts and is never rewritten.
 *
 * @module dsh-longhaul/memory
 */
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  ArtifactRecord,
  DecisionRecord,
  FindingRecord,
  MemoryKind,
  MemoryRecord,
} from './types.ts'

/** Construction options for {@link LonghaulMemory}. */
export interface MemoryStoreOptions {
  /** Absolute base directory, e.g. `~/.dsh/longhaul`. */
  baseDir: string
  /** Root session id; names the tree directory under `baseDir`. */
  rootSessionId: string
  /** Clock override for record timestamps; defaults to `Date.now`. */
  now?: () => number
  /** Id generator override; defaults to `randomUUID`. */
  newId?: () => string
}

/** Fields accepted when appending a decision or a finding. */
interface AppendInput {
  text: string
  tags?: string[]
  evidence?: string
  supersedes?: string
}

/** Fields accepted when appending an artifact. */
interface ArtifactInput {
  text: string
  path: string
  tags?: string[]
  evidence?: string
}

/** Parent lookup for session-tree walks; the root session returns undefined. */
type ParentOf = (sessionId: string) => string | undefined

/** Validate an opaque session id used as a storage directory or record author. */
function requireSessionId(value: string, label: string): string {
  if (value.trim() === '') throw new Error(`longhaul: ${label} cannot be empty`)
  if (value === '.' || value === '..' || /[\\/\0]/u.test(value)) {
    throw new Error(`longhaul: ${label} must not contain path separators: ${value}`)
  }
  return value
}

/** Reject text that carries no content. */
function requireText(text: string): string {
  if (text.trim() === '') throw new Error('longhaul: memory text cannot be empty')
  return text
}

/** Reject artifacts that point at nothing. */
function requireArtifactPath(path: string): string {
  if (path.trim() === '') throw new Error('longhaul: artifact path cannot be empty')
  return path
}

/** Whether a filesystem error means the file or directory does not exist. */
function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** Return a frozen copy of a record with a frozen tags array. */
function freezeRecord<T extends MemoryRecord>(record: T): T {
  const stored = { ...record, tags: [...record.tags] }
  Object.freeze(stored.tags)
  Object.freeze(stored)
  return stored
}

/**
 * Read one JSONL file, skipping blank lines.
 * @param file - absolute file path.
 * @returns parsed records in file order; a missing file reads as empty.
 * @throws when a non-blank line is not valid JSON; the message names the file and 1-based line.
 */
async function readJsonl<T>(file: string): Promise<T[]> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
  const records: T[] = []
  const lines = raw.split(/\r?\n/u)
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue
    try {
      records.push(JSON.parse(line) as T)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`longhaul: malformed JSON in ${file} line ${index + 1}: ${reason}`)
    }
  }
  return records
}

/**
 * Whether `nodeId` is `ancestorId` itself or one of its descendants.
 * @param ancestorId - candidate ancestor session id.
 * @param nodeId - session id to walk upward from.
 * @param parentOf - parent lookup for the session tree; returns undefined at the root.
 * @returns true when the walk from `nodeId` reaches `ancestorId`; false when the
 * walk ends at the root or revisits a session, so a parent cycle is not a
 * descendant chain.
 */
export function isDescendantOf(ancestorId: string, nodeId: string, parentOf: ParentOf): boolean {
  const seen = new Set<string>()
  let current: string | undefined = nodeId
  while (current !== undefined) {
    if (current === ancestorId) return true
    if (seen.has(current)) return false
    seen.add(current)
    current = parentOf(current)
  }
  return false
}

/**
 * Append-only memory store for one root session tree.
 *
 * Writes create missing directories and append one JSON line per record.
 * Decisions and artifacts are tree-wide; findings are stored under their author
 * and listed only for sessions on that author's branch. Every returned record
 * is frozen.
 */
export class LonghaulMemory {
  private readonly rootDir: string
  private readonly now: () => number
  private readonly newId: () => string

  /**
   * @param options - storage root, root session id, and clock/id overrides.
   * @throws when `baseDir` is empty or `rootSessionId` cannot name a directory.
   */
  constructor(options: MemoryStoreOptions) {
    if (options.baseDir.trim() === '') throw new Error('longhaul: memory baseDir cannot be empty')
    this.rootDir = join(options.baseDir, requireSessionId(options.rootSessionId, 'rootSessionId'))
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? randomUUID
  }

  /**
   * Append a finding for the author's own branch. A superseded finding must
   * already exist in the author's own file.
   * @param authorSessionId - session that owns the finding and its file.
   * @param input - finding text plus optional tags, evidence, and superseded finding id.
   * @returns the frozen record as appended.
   * @throws when `text` is blank, the session id is not path-safe, or `supersedes` is unknown.
   */
  async appendFinding(authorSessionId: string, input: AppendInput): Promise<FindingRecord> {
    const author = requireSessionId(authorSessionId, 'authorSessionId')
    const text = requireText(input.text)
    const file = this.findingsFile(author)
    const record: FindingRecord = {
      id: this.newId(),
      kind: 'finding',
      authorSessionId: author,
      time: this.now(),
      version: await this.versionFor('finding', file, input.supersedes),
      text,
      tags: [...(input.tags ?? [])],
      ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
      ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
    }
    return this.appendRecord(file, record)
  }

  /**
   * Append a tree-wide decision. Callers enforce who may write decisions.
   * @param authorSessionId - session credited with the decision.
   * @param input - decision text plus optional tags, evidence, and superseded decision id.
   * @returns the frozen record as appended.
   * @throws when `text` is blank, the session id is not path-safe, or `supersedes` is unknown.
   */
  async appendDecision(authorSessionId: string, input: AppendInput): Promise<DecisionRecord> {
    const author = requireSessionId(authorSessionId, 'authorSessionId')
    const text = requireText(input.text)
    const file = this.decisionsFile()
    const record: DecisionRecord = {
      id: this.newId(),
      kind: 'decision',
      authorSessionId: author,
      time: this.now(),
      version: await this.versionFor('decision', file, input.supersedes),
      text,
      tags: [...(input.tags ?? [])],
      ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
      ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
    }
    return this.appendRecord(file, record)
  }

  /**
   * Append a tree-wide artifact reference.
   * @param authorSessionId - session credited with the artifact.
   * @param input - description, artifact path, and optional tags and evidence.
   * @returns the frozen record as appended.
   * @throws when `text` or `path` is blank or the session id is not path-safe.
   */
  async appendArtifact(authorSessionId: string, input: ArtifactInput): Promise<ArtifactRecord> {
    const author = requireSessionId(authorSessionId, 'authorSessionId')
    const text = requireText(input.text)
    const path = requireArtifactPath(input.path)
    const record: ArtifactRecord = {
      id: this.newId(),
      kind: 'artifact',
      authorSessionId: author,
      time: this.now(),
      version: 1,
      text,
      tags: [...(input.tags ?? [])],
      ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
      path,
    }
    return this.appendRecord(this.artifactsFile(), record)
  }

  /**
   * Read every decision in append order.
   * @returns frozen decisions, tree-wide.
   * @throws when a stored line is not valid JSON; the message names the file and line.
   */
  async listDecisions(): Promise<DecisionRecord[]> {
    const records = await readJsonl<DecisionRecord>(this.decisionsFile())
    return records.map(record => freezeRecord(record))
  }

  /**
   * Read every artifact in append order.
   * @returns frozen artifacts, tree-wide.
   * @throws when a stored line is not valid JSON; the message names the file and line.
   */
  async listArtifacts(): Promise<ArtifactRecord[]> {
    const records = await readJsonl<ArtifactRecord>(this.artifactsFile())
    return records.map(record => freezeRecord(record))
  }

  /**
   * List findings visible to a viewer: the viewer's own and its descendants'
   * (branch scope), ordered by time then id.
   * @param viewerSessionId - session whose branch defines visibility.
   * @param parentOf - parent lookup for the session tree.
   * @returns frozen findings authored anywhere in the viewer's subtree.
   * @throws when a stored line is not valid JSON; the message names the file and line.
   */
  async listFindings(viewerSessionId: string, parentOf: ParentOf): Promise<FindingRecord[]> {
    const visible: FindingRecord[] = []
    for (const file of await this.findingFiles()) {
      for (const record of await readJsonl<FindingRecord>(file)) {
        if (isDescendantOf(viewerSessionId, record.authorSessionId, parentOf)) visible.push(record)
      }
    }
    visible.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
    return visible.map(record => freezeRecord(record))
  }

  /**
   * Promote a visible finding into a decision. The new decision keeps the
   * finding's text (unless `text` is given) and tags, and records the source
   * finding id in `evidence`.
   * @param findingId - id of the finding to promote.
   * @param promoterSessionId - session that becomes the decision author.
   * @param parentOf - parent lookup for the session tree.
   * @param text - replacement decision text; defaults to the finding text.
   * @returns the frozen decision as appended.
   * @throws when the finding is unknown or outside the promoter's branch.
   */
  async promote(
    findingId: string,
    promoterSessionId: string,
    parentOf: ParentOf,
    text?: string,
  ): Promise<DecisionRecord> {
    const finding = await this.findFinding(findingId)
    if (finding === undefined) throw new Error(`longhaul: unknown finding ${findingId}`)
    if (!isDescendantOf(promoterSessionId, finding.authorSessionId, parentOf)) {
      throw new Error(
        `longhaul: finding ${findingId} by ${finding.authorSessionId} is outside the branch of ${promoterSessionId}`,
      )
    }
    return this.appendDecision(promoterSessionId, {
      text: text ?? finding.text,
      tags: [...finding.tags],
      evidence: `finding:${finding.id}`,
    })
  }

  private decisionsFile(): string {
    return join(this.rootDir, 'decisions.jsonl')
  }

  private artifactsFile(): string {
    return join(this.rootDir, 'artifacts.jsonl')
  }

  private findingsFile(authorSessionId: string): string {
    return join(this.rootDir, 'findings', `${authorSessionId}.jsonl`)
  }

  /** Existing per-author finding files, sorted by file name. */
  private async findingFiles(): Promise<string[]> {
    const dir = join(this.rootDir, 'findings')
    let names: string[]
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      names = entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map(entry => entry.name)
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }
    return names.sort().map(name => join(dir, name))
  }

  /** The finding with `findingId` across every author file, when present. */
  private async findFinding(findingId: string): Promise<FindingRecord | undefined> {
    for (const file of await this.findingFiles()) {
      const match = (await readJsonl<FindingRecord>(file)).find(record => record.id === findingId)
      if (match !== undefined) return match
    }
    return undefined
  }

  /**
   * Version of the record about to be written. A supersession must name an
   * existing record of the same kind in the destination file.
   */
  private async versionFor(
    kind: MemoryKind,
    file: string,
    supersedes: string | undefined,
  ): Promise<number> {
    if (supersedes === undefined) return 1
    const previous = (await readJsonl<MemoryRecord>(file))
      .find(record => record.id === supersedes && record.kind === kind)
    if (previous === undefined) {
      throw new Error(`longhaul: cannot supersede unknown ${kind} ${supersedes} in ${file}`)
    }
    return previous.version + 1
  }

  /** Freeze `record`, create its directory, and append it as one JSON line. */
  private async appendRecord<T extends MemoryRecord>(file: string, record: T): Promise<T> {
    const stored = freezeRecord(record)
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify(stored)}\n`, 'utf8')
    return stored
  }
}
