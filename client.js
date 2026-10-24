/**
 * Long Haul client entry: the composer chip and the read-only Long Haul
 * sidebar tab. The tab renders the durable phase/task plan, deliverable links,
 * and tree memory evidence; it never mutates state. It reads the host's
 * `longhaul` session projection from the client session list, so it updates
 * without a custom RPC. Without dsh-better-sidebar the chip still works.
 */
window.__ModuleLoader__.load({
  id: 'dsh-longhaul',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'longhaul'
    const PHASES = ['P0', 'P1', 'P2', 'P3']
    /** The better-sidebar client service, captured when its tab is registered. */
    let sidebarService

    const en = {
      'chip.label': 'Long Haul',
      'chip.on': 'Long Haul · {phase}',
      'chip.off.title': 'Start Long Haul mode',
      'chip.on.title': 'Leave Long Haul mode',
      'chip.failed': 'Long Haul command failed',
      'chip.draft': 'Clear the composer draft before toggling Long Haul.',
      'chip.tasks': 'Tasks',
      'chip.openTree': 'Open the Long Haul task tree',
      'chip.noSidebar': 'The Long Haul sidebar tab is not available; install dsh-better-sidebar.',
      'risk.confirm': 'Start Long Haul mode?\n\nIt creates subagent sessions, spends additional tokens, '
        + 'and submits each stage deliverable for your approval. Build, commit, push, and publish stay in the '
        + 'parent session. You can leave the mode at any time.',
      'tab.title': 'Long Haul',
      'tab.description': 'Read-only phase gates, task tree, deliverable links, and tree memory evidence.',
      'tree.off': 'Long Haul mode is off.',
      'tree.unavailable': 'Long Haul state is not available for this session yet.',
      'tree.objective': 'Objective',
      'tree.noObjective': 'No objective recorded.',
      'tree.plan': 'Plan v{version}',
      'tree.doneOf': '{done}/{total} done',
      'tree.steps': '{steps} child steps',
      'tree.live': '{count} live',
      'tree.pending': 'Pending approval',
      'tree.updated': 'Updated {time}',
      'tree.gates': 'Phase gates',
      'tree.tasks': 'Tasks',
      'tree.noTasks': 'No tasks have been recorded.',
      'tree.evidence': 'Evidence',
      'tree.decisions': 'Decisions',
      'tree.findings': 'Findings',
      'tree.artifacts': 'Artifacts',
      'tree.noEvidence': 'No evidence recorded yet.',
      'tree.files': 'Files',
      'tree.deps': 'Depends on',
      'tree.budget': '{steps} step budget',
      'tree.openChild': 'Open child session',
      'tree.openFile': 'Open file',
      'tree.expand': 'Show details',
      'tree.collapse': 'Hide details',
      'phase.P0': 'Requirements',
      'phase.P1': 'Design',
      'phase.P2': 'Development',
      'phase.P3': 'Ship',
      'phase.done': 'done',
      'phase.active': 'active',
      'phase.waiting': 'waiting',
      'phase.pending': 'pending',
      'status.pending': 'pending',
      'status.running': 'running',
      'status.done': 'done',
      'status.blocked': 'blocked',
      'status.cancelled': 'cancelled',
    }

    const zh = {
      'chip.label': '长任务',
      'chip.on': '长任务 · {phase}',
      'chip.off.title': '开始长任务模式',
      'chip.on.title': '退出长任务模式',
      'chip.failed': '长任务命令失败',
      'chip.draft': '请先清空输入框草稿，再切换长任务模式。',
      'chip.tasks': '任务',
      'chip.openTree': '打开长任务任务树',
      'chip.noSidebar': '长任务侧边栏 tab 不可用；请安装 dsh-better-sidebar。',
      'risk.confirm': '开始长任务模式？\n\n该模式会创建子 Agent、消耗额外 token，并在每个阶段结束时提交交付件等待审批。'
        + '构建、提交、推送与发布仍由父会话执行。你可以随时退出该模式。',
      'tab.title': '长任务',
      'tab.description': '只读的阶段闸门、任务树、交付件链接与树记忆证据。',
      'tree.off': '长任务模式已关闭。',
      'tree.unavailable': '当前会话还没有可用的长任务状态。',
      'tree.objective': '目标',
      'tree.noObjective': '还没有记录目标。',
      'tree.plan': '计划 v{version}',
      'tree.doneOf': '{done}/{total} 完成',
      'tree.steps': '{steps} 子会话步',
      'tree.live': '{count} 个进行中',
      'tree.pending': '待审批',
      'tree.updated': '更新于 {time}',
      'tree.gates': '阶段闸门',
      'tree.tasks': '任务',
      'tree.noTasks': '还没有记录任务。',
      'tree.evidence': '证据',
      'tree.decisions': '决策',
      'tree.findings': '发现',
      'tree.artifacts': '交付证据',
      'tree.noEvidence': '还没有记录证据。',
      'tree.files': '文件',
      'tree.deps': '依赖',
      'tree.budget': '{steps} 步预算',
      'tree.openChild': '打开子会话',
      'tree.openFile': '打开文件',
      'tree.expand': '展开详情',
      'tree.collapse': '收起详情',
      'phase.P0': '需求',
      'phase.P1': '设计',
      'phase.P2': '开发',
      'phase.P3': '发布',
      'phase.done': '完成',
      'phase.active': '进行中',
      'phase.waiting': '待审批',
      'phase.pending': '待开始',
      'status.pending': '待处理',
      'status.running': '进行中',
      'status.done': '完成',
      'status.blocked': '阻塞',
      'status.cancelled': '取消',
    }

    const styles = {
      wrap: { display: 'inline-flex', alignItems: 'center', gap: '4px' },
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '2px 8px', borderRadius: '999px', cursor: 'pointer',
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.35))',
        background: 'var(--dsw-surface-raised, transparent)',
        color: 'var(--dsw-text-primary, inherit)',
        font: 'inherit', lineHeight: '18px', fontSize: '12px',
      },
      dot: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--dsw-accent, #247bbf)' },
      chipSmall: {
        display: 'inline-flex', alignItems: 'center', padding: '2px 6px',
        borderRadius: '999px', cursor: 'pointer', fontSize: '11px',
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.35))',
        background: 'transparent', color: 'var(--dsw-text-secondary, #888)', font: 'inherit',
      },
      error: { color: 'var(--dsw-danger, #c0392b)', fontWeight: 700, cursor: 'help' },
      tab: {
        display: 'flex', flexDirection: 'column', gap: '14px',
        padding: '12px 12px 20px', fontSize: '12px', color: 'inherit',
        overflow: 'auto', height: '100%', boxSizing: 'border-box',
      },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' },
      title: { fontWeight: 700, fontSize: '14px', lineHeight: '18px' },
      badge: {
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '1px 7px', borderRadius: '999px', fontSize: '10px', whiteSpace: 'nowrap',
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.35))',
      },
      meta: { color: 'var(--dsw-text-secondary, #888)', fontSize: '11px' },
      small: { color: 'var(--dsw-text-secondary, #888)', fontSize: '10px' },
      section: { display: 'flex', flexDirection: 'column', gap: '6px' },
      sectionTitle: {
        fontWeight: 600, fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase',
        color: 'var(--dsw-text-secondary, #888)',
      },
      summary: { display: 'flex', flexWrap: 'wrap', gap: '4px 8px', alignItems: 'center' },
      objective: { fontWeight: 500, lineHeight: '17px' },
      gate: {
        display: 'flex', gap: '7px', padding: '5px 0',
        borderBottom: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.12))',
      },
      gateBody: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 auto' },
      gateTop: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' },
      gateLabel: { fontWeight: 600 },
      link: {
        display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', padding: 0, border: 0, background: 'transparent',
        color: 'var(--dsw-accent, #247bbf)', font: 'inherit', fontSize: '10px',
        textAlign: 'left', cursor: 'pointer',
      },
      task: {
        display: 'flex', flexDirection: 'column',
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.22))',
        borderRadius: '7px', overflow: 'hidden',
        background: 'var(--dsw-surface-raised, transparent)',
      },
      taskHeader: {
        display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
        padding: '6px 8px', border: 0, background: 'transparent', color: 'inherit',
        font: 'inherit', textAlign: 'left', cursor: 'pointer',
      },
      taskGlyph: { width: '14px', textAlign: 'center', fontWeight: 700, flex: '0 0 auto' },
      taskTitle: {
        fontWeight: 600, flex: '1 1 auto', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      },
      taskStatus: { fontSize: '10px', flex: '0 0 auto' },
      chevron: { color: 'var(--dsw-text-secondary, #888)', fontSize: '10px', flex: '0 0 auto' },
      taskDetails: {
        display: 'flex', flexDirection: 'column', gap: '4px',
        padding: '0 9px 8px 29px', borderTop: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.12))',
      },
      detailRow: { display: 'flex', flexWrap: 'wrap', gap: '3px 6px', alignItems: 'center' },
      detailLabel: { color: 'var(--dsw-text-secondary, #888)', fontSize: '10px' },
      fileLink: {
        padding: 0, border: 0, background: 'transparent', color: 'var(--dsw-accent, #247bbf)',
        font: 'inherit', fontSize: '10px', cursor: 'pointer',
      },
      ownerButton: {
        padding: '1px 6px', borderRadius: '4px', cursor: 'pointer',
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.35))',
        background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '10px',
      },
      evidenceGroup: { display: 'flex', flexDirection: 'column', gap: '3px' },
      evidenceItem: {
        display: 'flex', gap: '6px', alignItems: 'baseline',
        padding: '3px 0', borderBottom: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.08))',
      },
      evidenceText: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      empty: { margin: 0, color: 'var(--dsw-text-secondary, #888)', lineHeight: '17px' },
    }

    const STATUS_GLYPH = { pending: '○', running: '◐', done: '✓', blocked: '!', cancelled: '×' }
    const STATUS_COLOR = {
      pending: 'var(--dsw-text-secondary, #888)',
      running: 'var(--dsw-accent, #247bbf)',
      done: 'var(--dsw-accent, #247bbf)',
      blocked: 'var(--dsw-danger, #c0392b)',
      cancelled: 'var(--dsw-text-secondary, #888)',
    }
    const GATE_GLYPH = { done: '●', active: '◉', waiting: '◷', pending: '○' }
    const GATE_COLOR = {
      done: 'var(--dsw-accent, #247bbf)',
      active: 'var(--dsw-text-primary, inherit)',
      waiting: 'var(--dsw-warning, #b7791f)',
      pending: 'var(--dsw-text-secondary, #888)',
    }

    function Chip(props) {
      const view = props.useProjection('longhaul')
      const mode = view === undefined ? 'off' : view.mode
      const phase = view === undefined ? 'P0' : view.phase
      const draft = typeof props.useInput === 'function' ? props.useInput(state => state.draft) : ''
      const actions = props.inputActions
      const [failed, setFailed] = React.useState(null)
      const t = props.t

      const run = () => {
        if (actions === undefined) {
          setFailed(t('chip.failed'))
          return
        }
        if (draft !== undefined && draft.trim() !== '') {
          setFailed(t('chip.draft'))
          return
        }
        if (mode === 'off' && typeof window.confirm === 'function' && !window.confirm(t('risk.confirm'))) return
        setFailed(null)
        actions.setDraft(mode === 'on' ? '/longhaul off' : '/longhaul on')
        actions.submit()
        if (mode === 'off' && sidebarService && typeof sidebarService.openTab === 'function') {
          try {
            sidebarService.openTab({ type: 'longhaul:tasks', target: 'right' })
          } catch (error) {
            if (typeof console !== 'undefined') console.warn('longhaul: could not open the task tree', error)
          }
        }
      }

      const label = mode === 'on' ? t('chip.on').replace('{phase}', phase) : t('chip.label')
      return h('span', { style: styles.wrap },
        h('button', {
          type: 'button',
          style: styles.chip,
          title: mode === 'on' ? t('chip.on.title') : t('chip.off.title'),
          'aria-label': label,
          onClick: run,
        },
        mode === 'on' ? h('span', { style: styles.dot, 'aria-hidden': true }) : null,
        label,
        ),
        mode === 'on'
          ? h('button', {
              type: 'button',
              style: styles.chipSmall,
              title: t('chip.openTree'),
              'aria-label': t('chip.openTree'),
              onClick: () => {
                if (sidebarService && typeof sidebarService.openTab === 'function') {
                  setFailed(null)
                  sidebarService.openTab({ type: 'longhaul:tasks', target: 'right' })
                } else {
                  setFailed(t('chip.noSidebar'))
                }
              },
            }, t('chip.tasks'))
          : null,
        failed !== null
          ? h('span', { style: styles.error, title: failed, 'aria-label': t('chip.failed') }, '!')
          : null,
      )
    }

    /** Walk the durable session list to the root conversation. */
    function rootIdOf(byId, id) {
      let current = id
      const seen = new Set()
      while (current !== undefined && byId[current] !== undefined && !seen.has(current)) {
        seen.add(current)
        const parentId = byId[current].parentId
        if (parentId === undefined || parentId === current) return current
        current = parentId
      }
      return current
    }

    function formatTime(value) {
      if (typeof value !== 'number' || value <= 0) return ''
      try {
        return new Date(value).toLocaleString()
      } catch {
        return ''
      }
    }

    function isAbsolutePath(path) {
      return /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith('/')
    }

    function joinPath(cwd, path) {
      if (!cwd) return path
      return `${cwd.replace(/[\\/]+$/u, '')}/${path.replace(/^[\\/]+/u, '')}`
    }

    function baseName(path) {
      const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
      return at === -1 ? path : path.slice(at + 1)
    }

    /**
     * Open a workspace file through the better-sidebar editor. External tab
     * components do not receive `onOpenFile` (only built-in tabs do), so the
     * tab replicates the built-in open: resolve against the session cwd and
     * call the service's `openTab` with an `editor:<absolute>` id.
     */
    function openWorkspaceFile(ctx, service, scope, path) {
      if (!service || typeof service.openTab !== 'function' || typeof path !== 'string' || path === '') return false
      const list = ctx && ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot() : undefined
      const sessionCwd = list && list.byId && scope ? list.byId[scope.sessionId]?.cwd : undefined
      const cwd = (scope && scope.cwd) || sessionCwd
      const absolute = isAbsolutePath(path) ? path : joinPath(cwd, path)
      service.openTab({
        type: 'editor',
        title: baseName(absolute),
        path: absolute,
        id: `editor:${absolute}`,
      })
      return true
    }

    function defaultGates(view) {
      const current = PHASES.indexOf(view.phase)
      return PHASES.map((phase, index) => ({
        phase,
        status: index < current ? 'done' : index === current ? 'active' : 'pending',
        deliverable: '',
      }))
    }

    function gateRow(gate, props, t, openFile) {
      const status = gate.status || 'pending'
      const glyph = GATE_GLYPH[status] || '○'
      const color = GATE_COLOR[status] || GATE_COLOR.pending
      const deliverable = typeof gate.deliverable === 'string' ? gate.deliverable : ''
      const open = deliverable !== '' && typeof openFile === 'function'
        ? () => openFile(deliverable)
        : undefined
      return h('div', { style: styles.gate, key: gate.phase },
        h('span', { style: { ...styles.taskGlyph, color }, 'aria-hidden': true }, glyph),
        h('div', { style: styles.gateBody },
          h('div', { style: styles.gateTop },
            h('span', { style: styles.gateLabel }, `${gate.phase} · ${t(`phase.${gate.phase}`)}`),
            h('span', { style: styles.small }, t(`phase.${status}`)),
          ),
          deliverable !== ''
            ? (open === undefined
                ? h('span', { style: styles.small, title: deliverable }, deliverable)
                : h('button', { type: 'button', style: styles.link, title: deliverable, onClick: open }, deliverable))
            : null,
        ),
      )
    }

    function taskRow(task, props, t, expanded, toggle, openFile) {
      const status = task.status || 'pending'
      const glyph = STATUS_GLYPH[status] || '○'
      const color = STATUS_COLOR[status] || STATUS_COLOR.pending
      const files = Array.isArray(task.files) ? task.files : []
      const dependencies = Array.isArray(task.dependsOn) ? task.dependsOn : []
      const owner = typeof task.ownerSessionId === 'string' ? task.ownerSessionId : ''
      const detail = expanded
        ? h('div', { style: styles.taskDetails },
            files.length > 0
              ? h('div', { style: styles.detailRow },
                  h('span', { style: styles.detailLabel }, `${t('tree.files')}:`),
                  ...files.map((file, index) => {
                    if (typeof openFile !== 'function') {
                      return h('span', { key: `${file}:${index}`, style: styles.small }, file)
                    }
                    return h('button', {
                      key: `${file}:${index}`,
                      type: 'button',
                      style: styles.fileLink,
                      title: file,
                      onClick: () => openFile(file),
                    }, file)
                  }),
                )
              : null,
            dependencies.length > 0
              ? h('div', { style: styles.detailRow },
                  h('span', { style: styles.detailLabel }, `${t('tree.deps')}:`),
                  h('span', { style: styles.small }, dependencies.join(', ')),
                )
              : null,
            (typeof task.budgetSteps === 'number' && task.budgetSteps > 0)
              ? h('div', { style: styles.detailRow },
                  h('span', { style: styles.detailLabel }, t('tree.budget').replace('{steps}', String(task.budgetSteps))),
                )
              : null,
            owner !== ''
              ? h('div', { style: styles.detailRow },
                  h('button', {
                    type: 'button',
                    style: styles.ownerButton,
                    title: t('tree.openChild'),
                    onClick: () => {
                      if (typeof props.onSubagentJump === 'function') props.onSubagentJump(owner)
                    },
                  }, `${t('tree.openChild')} · ${owner}`),
                )
              : null,
          )
        : null
      return h('div', { style: styles.task, key: task.id },
        h('button', {
          type: 'button',
          style: styles.taskHeader,
          title: expanded ? t('tree.collapse') : t('tree.expand'),
          'aria-expanded': expanded ? 'true' : 'false',
          onClick: toggle,
        },
        h('span', { style: { ...styles.taskGlyph, color }, 'aria-hidden': true }, glyph),
        h('span', { style: styles.taskTitle }, task.title || task.id),
        h('span', { style: { ...styles.taskStatus, color } }, t(`status.${status}`)),
        h('span', { style: styles.chevron, 'aria-hidden': true }, expanded ? '▾' : '▸'),
        ),
        detail,
      )
    }

    function evidenceGroup(label, items, t) {
      if (!Array.isArray(items) || items.length === 0) return null
      return h('div', { style: styles.evidenceGroup },
        h('div', { style: styles.detailLabel }, label),
        ...items.map((item, index) => h('div', { style: styles.evidenceItem, key: `${item.id || index}` },
          h('span', { style: styles.evidenceText, title: item.text || '' }, item.text || ''),
          h('span', { style: styles.small }, formatTime(item.time)),
        )),
      )
    }

    function TaskTreeTab(props) {
      const ctx = props.ctx
      const t = ctx && ctx.locale && typeof ctx.locale.bind === 'function'
        ? ctx.locale.bind(NS)
        : key => key
      const sessions = ctx && ctx.sessions
      let list
      if (sessions && sessions.list && typeof React.useSyncExternalStore === 'function'
        && typeof React.useCallback === 'function') {
        const subscribe = React.useCallback(callback => sessions.list.subscribe(callback), [sessions])
        const snapshot = React.useCallback(() => sessions.list.getSnapshot(), [sessions])
        list = React.useSyncExternalStore(subscribe, snapshot)
      } else if (sessions && sessions.list) {
        list = sessions.list.getSnapshot()
      }
      const root = list && list.byId ? rootIdOf(list.byId, props.scope && props.scope.sessionId) : undefined
      const projected = list && list.projectionsBySession && root !== undefined
        ? list.projectionsBySession[root]
        : undefined
      const view = projected && projected.values ? projected.values.longhaul : undefined
      const [expanded, setExpanded] = React.useState({})
      const toggleTask = (id) => {
        setExpanded(previous => ({ ...previous, [id]: !previous[id] }))
      }
      const sidebar = sidebarService
        || (ctx && typeof ctx.get === 'function' ? ctx.get('betterSidebar') : ctx && ctx.betterSidebar)
      const canOpenFile = typeof props.onOpenFile === 'function'
        || (sidebar && typeof sidebar.openTab === 'function')
      const openFile = canOpenFile
        ? (path) => {
            if (typeof props.onOpenFile === 'function') {
              props.onOpenFile(path)
              return
            }
            openWorkspaceFile(ctx, sidebar, props.scope, path)
          }
        : undefined

      if (view === undefined) {
        return h('div', { style: styles.tab }, h('p', { style: styles.empty }, t('tree.unavailable')))
      }

      const tasks = Array.isArray(view.tasks) ? view.tasks : []
      const gates = Array.isArray(view.gates) && view.gates.length > 0
        ? view.gates
        : defaultGates(view)
      const deliverables = view.deliverables && typeof view.deliverables === 'object' ? view.deliverables : {}
      const normalizedGates = gates.map(gate => ({
        ...gate,
        status: gate.status === 'active' && view.pending === gate.phase ? 'waiting' : gate.status,
        deliverable: gate.deliverable || deliverables[gate.phase] || '',
      }))
      const done = tasks.filter(task => task.status === 'done').length
      const live = tasks.filter(task => task.status === 'running' && task.ownerSessionId).length
      const evidence = view.evidence && typeof view.evidence === 'object' ? view.evidence : {}
      const counts = evidence.counts && typeof evidence.counts === 'object' ? evidence.counts : {}
      const updated = formatTime(view.updatedAt)

      if (view.mode !== 'on') {
        return h('div', { style: styles.tab },
          h('div', { style: styles.header },
            h('span', { style: styles.title }, t('tab.title')),
            h('span', { style: styles.badge }, t('tree.off')),
          ),
          h('p', { style: styles.empty }, t('tree.off')),
        )
      }

      return h('div', { style: styles.tab },
        h('div', { style: styles.header },
          h('div', { style: styles.section },
            h('span', { style: styles.title }, t('tab.title')),
            h('span', { style: styles.meta }, `${view.phase} · ${t(`phase.${view.phase}`)}`),
          ),
          h('span', { style: styles.badge }, `${view.phase} · v${view.designVersion}`),
        ),
        updated !== '' ? h('span', { style: styles.small }, t('tree.updated').replace('{time}', updated)) : null,
        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, t('tree.objective')),
          h('div', { style: styles.objective }, view.objective || t('tree.noObjective')),
          h('div', { style: styles.summary },
            h('span', { style: styles.badge }, t('tree.doneOf').replace('{done}', String(done)).replace('{total}', String(tasks.length))),
            h('span', { style: styles.badge }, t('tree.steps').replace('{steps}', String(view.steps || 0))),
            h('span', { style: styles.badge }, t('tree.live').replace('{count}', String(live))),
            view.pending ? h('span', { style: styles.badge }, `${t('tree.pending')}: ${view.pending}`) : null,
          ),
        ),
        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, t('tree.gates')),
          ...normalizedGates.map(gate => gateRow(gate, props, t, openFile)),
        ),
        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, `${t('tree.tasks')} (${done}/${tasks.length})`),
          ...(tasks.length === 0
            ? [h('p', { key: 'empty', style: styles.empty }, t('tree.noTasks'))]
            : tasks.map(task => taskRow(
                task,
                props,
                t,
                Boolean(expanded[task.id]),
                () => toggleTask(task.id),
                openFile,
              ))),
        ),
        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, t('tree.evidence')),
          h('div', { style: styles.meta },
            `${t('tree.decisions')}: ${counts.decisions || 0} · `
            + `${t('tree.findings')}: ${counts.findings || 0} · `
            + `${t('tree.artifacts')}: ${counts.artifacts || 0}`,
          ),
          ...(Array.isArray(evidence.decisions) || Array.isArray(evidence.findings) || Array.isArray(evidence.artifacts)
            ? [
                evidenceGroup(t('tree.decisions'), evidence.decisions, t),
                evidenceGroup(t('tree.findings'), evidence.findings, t),
                evidenceGroup(t('tree.artifacts'), evidence.artifacts, t),
              ].filter(Boolean)
            : [h('p', { key: 'none', style: styles.empty }, t('tree.noEvidence'))]),
        ),
      )
    }

    function taskTabIcon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true,
      },
      h('rect', { x: 2, y: 3, width: 12, height: 1.8, rx: 0.9 }),
      h('rect', { x: 2, y: 7.1, width: 12, height: 1.8, rx: 0.9 }),
      h('rect', { x: 2, y: 11.2, width: 8, height: 1.8, rx: 0.9 }),
      )
    }

    /** Register the sidebar tab when dsh-better-sidebar is composed. */
    function registerTaskTab(ctx, service) {
      if (service === undefined || service === null || typeof service.registerTab !== 'function') return
      const t = ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : key => key
      const descriptor = {
        id: 'longhaul:tasks',
        title: () => t('tab.title'),
        description: () => t('tab.description'),
        icon: taskTabIcon,
        order: 33,
        single: true,
        component: TaskTreeTab,
      }
      const register = () => {
        const dispose = service.registerTab(descriptor)
        sidebarService = service
        return dispose
      }
      if (typeof ctx.effect === 'function') ctx.effect(register)
      else register()
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          ctx.locale.register(NS, { zh, en })
        } catch (error) {
          // A hot-reloaded module may race an existing namespace; the chip must
          // still register even when the dictionary is already present.
          if (typeof console !== 'undefined') console.warn('longhaul: locale registration failed', error)
        }
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'dsh-longhaul',
          order: 20,
          locale: NS,
        }, Chip))

        try {
          const service = typeof ctx.get === 'function' ? ctx.get('betterSidebar') : ctx.betterSidebar
          if (service !== undefined && service !== null) {
            registerTaskTab(ctx, service)
          } else if (typeof ctx.inject === 'function') {
            ctx.inject(['betterSidebar'], (sub) => {
              try {
                const attached = typeof sub.get === 'function' ? sub.get('betterSidebar') : sub.betterSidebar
                registerTaskTab(sub, attached)
              } catch (error) {
                if (typeof console !== 'undefined') console.warn('longhaul: sidebar tab registration failed', error)
              }
            })
          }
        } catch (error) {
          // Sidebar integration is optional; never let it take the chip down.
          if (typeof console !== 'undefined') console.warn('longhaul: sidebar tab registration failed', error)
        }
      },
    }
  },
})
