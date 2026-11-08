import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractHeredocs,
  findGitOperations,
  operationMessage,
  shortCommand,
  splitSegments,
  tokenize,
} from '../lib/host/command.js'

function first(command, cwd = '/repo') {
  return findGitOperations(command, cwd).operations[0]
}

test('splits segments without breaking quotes or substitutions', () => {
  assert.deepEqual(splitSegments('cd /repo && git commit -m "a; b"'), ['cd /repo', 'git commit -m "a; b"'])
  assert.deepEqual(splitSegments('git log | head'), ['git log', 'head'])
  assert.deepEqual(splitSegments('echo "$(git rev-parse HEAD)"'), ['echo "$(git rev-parse HEAD)"'])
  assert.deepEqual(tokenize('git commit -m "feat: x"'), ['git', 'commit', '-m', 'feat: x'])
  assert.deepEqual(tokenize("git commit -m 'fix: y'"), ['git', 'commit', '-m', 'fix: y'])
})

test('parses a plain commit message', () => {
  const op = first('git commit -m "feat: add login"')
  assert.equal(op.kind, 'commit')
  assert.equal(operationMessage(op), 'feat: add login')
  assert.equal(op.noVerify, false)
})

test('handles cd and git -C cwd changes', () => {
  assert.equal(first('cd /tmp/x && git commit -m "feat: x"').cwd, '/tmp/x')
  assert.equal(first('git -C /tmp/y commit -m "feat: y"').cwd, '/tmp/y')
  assert.equal(first('FOO=1 git -C ../z commit -m "feat: z"').cwd, '/z')
  assert.equal(first('git -C ~/repo commit -m "feat: home"').cwd.endsWith('/repo'), true)
})

test('handles combined short flags', () => {
  const op = first('git commit -am "chore: bump"')
  assert.equal(operationMessage(op), 'chore: bump')
  assert.equal(op.noVerify, false)
  assert.equal(first('git commit -qm "chore: quiet"').noVerify, false)
})

test('reads amend and no-verify', () => {
  const op = first('git commit --amend --no-verify')
  assert.equal(op.amend, true)
  assert.equal(op.noVerify, true)
  assert.equal(operationMessage(op), null)
})

test('multiple -m values join with a blank line', () => {
  const op = first('git commit -m "feat: x" -m "Refs: #1"')
  assert.equal(operationMessage(op), 'feat: x\n\nRefs: #1')
})

test('extracts a heredoc used with -F -', () => {
  const command = "git commit -F - <<'EOF'\nfeat: heredoc\n\nRefs: #7\nEOF"
  const op = first(command)
  assert.equal(op.messageFile, '-')
  assert.equal(operationMessage(op), 'feat: heredoc\n\nRefs: #7')
  assert.equal(extractHeredocs(command).length, 1)
})

test('finds branch creation forms', () => {
  assert.deepEqual(
    ['git checkout -b feature/a', 'git switch -c fix/b', 'git branch feature/c', 'git worktree add -b feature/d ../d'].map((command) => {
      const op = first(command)
      return [op.kind, op.name]
    }),
    [
      ['create-branch', 'feature/a'],
      ['create-branch', 'fix/b'],
      ['create-branch', 'feature/c'],
      ['create-branch', 'feature/d'],
    ],
  )
})

test('does not treat branch listing or deletion as creation', () => {
  assert.equal(first('git branch -d old'), undefined)
  assert.equal(first('git branch --list'), undefined)
  assert.equal(first('git checkout main').kind, 'switch-branch')
  assert.equal(first('git switch main').kind, 'switch-branch')
  assert.equal(first('git checkout -- README.md'), undefined)
})

test('parses nested shell strings', () => {
  const op = first('bash -lc "git commit -m \'feat: nested\'"')
  assert.equal(op.kind, 'commit')
  assert.equal(operationMessage(op), 'feat: nested')
})

test('ignores prose that merely contains git commit', () => {
  assert.equal(first('echo "git commit -m fake"'), undefined)
  assert.equal(first('printf "git commit --amend" > notes.txt'), undefined)
  assert.equal(first('git log --grep="git commit"'), undefined)
})

test('recognizes dangerous commands in production checks', () => {
  const result = findGitOperations('kubectl delete pod api-0', '/repo')
  assert.equal(result.operations.length, 0)
  assert.equal(result.dangers[0].kind, 'kubectl')

  const forcePush = findGitOperations('git push --force origin main', '/repo')
  assert.equal(forcePush.operations[0].kind, 'push')
  assert.equal(forcePush.dangers[0].kind, 'force-push')

  const ssh = findGitOperations('ssh deploy@prod.example.com "pm2 restart api"', '/repo')
  assert.equal(ssh.dangers[0].kind, 'ssh')
})

test('shortCommand caps output', () => {
  assert.ok(shortCommand('x'.repeat(400)).length <= 181)
})
