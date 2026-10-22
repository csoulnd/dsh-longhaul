import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isDescendantOf, LonghaulMemory } from '../../src/memory.ts'

const ROOT = 'root-session'

/** Build a `parentOf` lookup for a synthetic session tree. */
function tree(links: Record<string, string | undefined>): (sessionId: string) => string | undefined {
  return sessionId => links[sessionId]
}

/** Count non-blank lines in a JSONL file. */
async function lineCount(file: string): Promise<number> {
  const text = await readFile(file, 'utf8')
  return text.split(/\r?\n/u).filter(line => line.trim() !== '').length
}

describe('LonghaulMemory', () => {
  let baseDir: string
  let memory: LonghaulMemory
  let counter: number

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'dsh-longhaul-memory-'))
    counter = 0
    memory = new LonghaulMemory({
      baseDir,
      rootSessionId: ROOT,
      now: () => 1_700_000_000_000 + counter,
      newId: () => `rec-${++counter}`,
    })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('appends decisions, artifacts, and findings as frozen JSONL records', async () => {
    const decision = await memory.appendDecision(ROOT, { text: 'Use sidecar JSONL', tags: ['storage'] })
    const artifact = await memory.appendArtifact('child-a', {
      text: 'Implementation deliverable',
      path: '.longhaul/deliverables/02-implementation.md',
      tags: ['evidence'],
      evidence: 'test run 17',
    })
    const finding = await memory.appendFinding('child-a', { text: 'rename races with read', evidence: 'log:17' })

    expect(decision.kind).toBe('decision')
    expect(decision.version).toBe(1)
    expect(decision.authorSessionId).toBe(ROOT)
    expect(artifact.kind).toBe('artifact')
    expect(artifact.path).toBe('.longhaul/deliverables/02-implementation.md')
    expect(finding.kind).toBe('finding')
    expect(finding.authorSessionId).toBe('child-a')
    expect(finding.evidence).toBe('log:17')

    const decisions = await memory.listDecisions()
    const artifacts = await memory.listArtifacts()
    const findings = await memory.listFindings(ROOT, tree({ [ROOT]: undefined, 'child-a': ROOT }))
    expect(decisions).toEqual([decision])
    expect(artifacts).toEqual([artifact])
    expect(findings).toEqual([finding])

    const recordIds = new Set([decision.id, artifact.id, finding.id])
    expect(recordIds.size).toBe(3)

    expect(Object.isFrozen(decision)).toBe(true)
    expect(Object.isFrozen(decision.tags)).toBe(true)
    expect(Object.isFrozen(decisions[0])).toBe(true)

    const decisionFile = join(baseDir, ROOT, 'decisions.jsonl')
    const artifactFile = join(baseDir, ROOT, 'artifacts.jsonl')
    const findingFile = join(baseDir, ROOT, 'findings', 'child-a.jsonl')
    expect(await lineCount(decisionFile)).toBe(1)
    expect(await lineCount(artifactFile)).toBe(1)
    expect(await lineCount(findingFile)).toBe(1)

    await memory.appendDecision(ROOT, { text: 'Second decision' })
    expect(await lineCount(decisionFile)).toBe(2)
    const appended = await memory.listDecisions()
    expect(appended).toHaveLength(2)
    expect(new Set(appended.map(record => record.id)).size).toBe(2)
  })

  it('scopes findings to the viewer’s own branch', async () => {
    const parentOf = tree({ [ROOT]: undefined, 'child-a': ROOT, grandchild: 'child-a', 'child-b': ROOT })
    const rootFinding = await memory.appendFinding(ROOT, { text: 'root note' })
    const childFinding = await memory.appendFinding('child-a', { text: 'child note' })
    const grandchildFinding = await memory.appendFinding('grandchild', { text: 'grandchild note' })
    const siblingFinding = await memory.appendFinding('child-b', { text: 'sibling note' })

    const idsFor = async (viewerSessionId: string): Promise<string[]> => {
      const records = await memory.listFindings(viewerSessionId, parentOf)
      return records.map(record => record.id)
    }

    expect(new Set(await idsFor(ROOT))).toEqual(
      new Set([rootFinding.id, childFinding.id, grandchildFinding.id, siblingFinding.id]),
    )
    expect(new Set(await idsFor('child-a'))).toEqual(new Set([childFinding.id, grandchildFinding.id]))
    expect(await idsFor('grandchild')).toEqual([grandchildFinding.id])
    expect(await idsFor('child-b')).toEqual([siblingFinding.id])

    expect(isDescendantOf(ROOT, 'grandchild', parentOf)).toBe(true)
    expect(isDescendantOf('child-a', ROOT, parentOf)).toBe(false)
    expect(isDescendantOf('child-a', 'child-a', parentOf)).toBe(true)
    expect(isDescendantOf('child-b', 'grandchild', parentOf)).toBe(false)
    expect(isDescendantOf(ROOT, 'unknown-session', parentOf)).toBe(false)
  })

  it('treats a parent cycle as not reachable', () => {
    const cyclic = tree({ a: 'b', b: 'a' })
    expect(isDescendantOf('root', 'a', cyclic)).toBe(false)
  })

  it('promotes visible findings into decisions and versions supersessions', async () => {
    const parentOf = tree({ [ROOT]: undefined, 'child-a': ROOT, grandchild: 'child-a', 'child-b': ROOT })
    const finding = await memory.appendFinding('grandchild', {
      text: 'JSONL append needs a trailing newline',
      tags: ['storage'],
    })

    const promoted = await memory.promote(finding.id, 'child-a', parentOf)
    expect(promoted.kind).toBe('decision')
    expect(promoted.authorSessionId).toBe('child-a')
    expect(promoted.text).toBe(finding.text)
    expect(promoted.tags).toEqual(['storage'])
    expect(promoted.evidence).toContain(finding.id)
    expect(promoted.supersedes).toBeUndefined()
    expect(promoted.version).toBe(1)

    const byRoot = await memory.promote(finding.id, ROOT, parentOf, 'Root-promoted decision')
    expect(byRoot.text).toBe('Root-promoted decision')
    expect((await memory.listDecisions()).map(record => record.id)).toEqual([promoted.id, byRoot.id])

    await expect(memory.promote(finding.id, 'child-b', parentOf)).rejects.toThrow(/outside the branch/u)
    await expect(memory.promote('missing-finding', ROOT, parentOf)).rejects.toThrow(/unknown finding/u)

    const first = await memory.appendDecision(ROOT, { text: 'Storage is JSONL' })
    const second = await memory.appendDecision(ROOT, { text: 'Storage is JSONL with newlines', supersedes: first.id })
    expect(second.version).toBe(2)
    expect(second.supersedes).toBe(first.id)
    const third = await memory.appendDecision(ROOT, { text: 'Storage is JSONL, one record per line', supersedes: second.id })
    expect(third.version).toBe(3)
    await expect(memory.appendDecision(ROOT, { text: 'Bad', supersedes: 'missing' })).rejects.toThrow(
      /unknown decision/u,
    )
  })

  it('skips blank lines and reports malformed JSON with file and line', async () => {
    const dir = join(baseDir, ROOT)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'decisions.jsonl')
    const first = {
      id: 'rec-1',
      kind: 'decision',
      authorSessionId: ROOT,
      time: 1,
      version: 1,
      text: 'one',
      tags: [],
    }
    await writeFile(
      file,
      `\n${JSON.stringify(first)}\n\n  \n${JSON.stringify({ ...first, id: 'rec-2', text: 'two' })}\n`,
      'utf8',
    )
    expect(await memory.listDecisions()).toHaveLength(2)

    await writeFile(file, `${JSON.stringify(first)}\n{not json}\n`, 'utf8')
    const error = await memory.listDecisions().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    const message = error instanceof Error ? error.message : ''
    expect(message).toContain('malformed JSON')
    expect(message).toContain(file)
    expect(message).toContain('line 2')
  })

  it('rejects empty or whitespace-only text', async () => {
    await expect(memory.appendDecision(ROOT, { text: '' })).rejects.toThrow(/text cannot be empty/u)
    await expect(memory.appendFinding('child-a', { text: '   ' })).rejects.toThrow(/text cannot be empty/u)
    await expect(memory.appendArtifact(ROOT, { text: '\n\t', path: 'evidence.log' })).rejects.toThrow(
      /text cannot be empty/u,
    )
    await expect(memory.appendArtifact(ROOT, { text: 'evidence', path: '  ' })).rejects.toThrow(
      /path cannot be empty/u,
    )

    expect(await memory.listDecisions()).toEqual([])
    expect(await memory.listArtifacts()).toEqual([])
    expect(await memory.listFindings(ROOT, tree({ [ROOT]: undefined }))).toEqual([])
  })
})
