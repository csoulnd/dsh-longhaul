/**
 * Long Haul composer chip and its first-enable risk confirmation.
 *
 * This file is the browser module itself: it registers through the DSH module
 * loader, uses only the injected host faces, and never touches the DOM.
 */
window.__ModuleLoader__.load({
  id: 'dsh-longhaul',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'longhaul'

    const en = {
      'chip.label': 'Long Haul',
      'chip.on': 'Long Haul · {phase}',
      'chip.off.title': 'Start Long Haul mode',
      'chip.on.title': 'Long Haul is active',
      'confirm.title': 'Start Long Haul mode?',
      'confirm.body': 'Long Haul creates subagent sessions, spends additional tokens, and submits each stage '
        + 'deliverable for your approval. Build, commit, push, and publish stay with the parent session. '
        + 'You can leave the mode at any time.',
      'confirm.enable': 'Start',
      'confirm.cancel': 'Cancel',
      'panel.off': 'Leave Long Haul mode',
      'panel.close': 'Close',
      'panel.failed': 'The command failed',
    }

    const zh = {
      'chip.label': '长任务',
      'chip.on': '长任务 · {phase}',
      'chip.off.title': '开始长任务模式',
      'chip.on.title': '长任务模式运行中',
      'confirm.title': '开始长任务模式？',
      'confirm.body': '长任务模式会创建子 Agent、消耗额外 token，并在每个阶段结束时提交交付件等待审批。'
        + '构建、提交、推送与发布仍由父会话执行。你可以随时退出该模式。',
      'confirm.enable': '开始',
      'confirm.cancel': '取消',
      'panel.off': '退出长任务模式',
      'panel.close': '关闭',
      'panel.failed': '命令执行失败',
    }

    const styles = {
      wrap: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '2px 8px', borderRadius: '999px', cursor: 'pointer',
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.35))',
        background: 'var(--dsw-surface-raised, transparent)',
        color: 'var(--dsw-text-primary, inherit)',
        font: 'inherit', lineHeight: '18px', fontSize: '12px',
      },
      dot: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--dsw-accent, #247bbf)' },
      panel: {
        position: 'absolute', bottom: '130%', left: 0, zIndex: 30, width: '300px',
        padding: '10px 12px', borderRadius: '10px', textAlign: 'left',
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.35))',
        background: 'var(--dsw-surface-overlay, #fff)',
        color: 'var(--dsw-text-primary, #111)',
        boxShadow: '0 8px 24px rgba(0,0,0,.18)', fontSize: '12px', lineHeight: '1.45',
      },
      title: { fontWeight: 600, marginBottom: '6px' },
      actions: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' },
      button: {
        padding: '3px 10px', borderRadius: '6px', cursor: 'pointer', font: 'inherit',
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.35))',
        background: 'transparent', color: 'inherit',
      },
      primary: {
        padding: '3px 10px', borderRadius: '6px', cursor: 'pointer', font: 'inherit',
        border: '1px solid var(--dsw-accent, #247bbf)',
        background: 'var(--dsw-accent, #247bbf)', color: '#fff',
      },
      error: { color: 'var(--dsw-danger, #c0392b)', marginTop: '6px' },
    }

    function Chip(props) {
      const view = props.useProjection('longhaul')
      const mode = view === undefined ? 'off' : view.mode
      const phase = view === undefined ? 'P0' : view.phase
      const [open, setOpen] = React.useState(false)
      const [confirming, setConfirming] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const t = props.t

      const run = (line) => {
        setBusy(true)
        setError(null)
        props.execute(line).then((failure) => {
          setBusy(false)
          if (failure !== null) {
            setError(failure)
            return
          }
          setConfirming(false)
          setOpen(false)
        }, (reason) => {
          setBusy(false)
          setError(reason instanceof Error ? reason.message : String(reason))
        })
      }

      const label = mode === 'on' ? t('chip.on').replace('{phase}', phase) : t('chip.label')
      return h('span', { style: styles.wrap },
        h('button', {
          type: 'button',
          style: styles.chip,
          title: mode === 'on' ? t('chip.on.title') : t('chip.off.title'),
          'aria-expanded': open,
          onClick: () => {
            setOpen(!open)
            setConfirming(false)
            setError(null)
          },
        },
        mode === 'on' ? h('span', { style: styles.dot, 'aria-hidden': true }) : null,
        label,
        ),
        open ? h('div', { style: styles.panel, role: 'dialog' },
          confirming
            ? h(React.Fragment, null,
              h('div', { style: styles.title }, t('confirm.title')),
              h('div', null, t('confirm.body')),
              h('div', { style: styles.actions },
                h('button', { type: 'button', style: styles.button, disabled: busy, onClick: () => setConfirming(false) }, t('confirm.cancel')),
                h('button', { type: 'button', style: styles.primary, disabled: busy, onClick: () => run('/longhaul on') }, t('confirm.enable')),
              ),
            )
            : h(React.Fragment, null,
              h('div', { style: styles.title }, mode === 'on' ? t('chip.on.title') : t('chip.off.title')),
              h('div', { style: styles.actions },
                h('button', { type: 'button', style: styles.button, onClick: () => setOpen(false) }, t('panel.close')),
                h('button', {
                  type: 'button',
                  style: mode === 'on' ? styles.button : styles.primary,
                  disabled: busy,
                  onClick: () => {
                    if (mode === 'on') run('/longhaul off')
                    else setConfirming(true)
                  },
                }, mode === 'on' ? t('panel.off') : t('confirm.enable')),
              ),
            ),
          error !== null ? h('div', { style: styles.error, role: 'status' }, `${t('panel.failed')}: ${error}`) : null,
        ) : null,
      )
    }

    return {
      inject: ['slots', 'remote.commands', 'locale'],
      apply(ctx) {
        ctx.locale.register(NS, { zh, en })
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'dsh-longhaul',
          order: 20,
          locale: NS,
          inject: (sessionId) => ({
            execute: async (line) => {
              const result = await ctx.remote.commands.execute(sessionId, line, [])
              if (!result.ok) return `${result.error.message} (${result.error.code})`
              if (result.value === undefined) return `unknown command: ${line}`
              return null
            },
          }),
        }, Chip))
      },
    }
  },
})
