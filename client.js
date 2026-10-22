/**
 * Long Haul composer chip. A click runs `/longhaul on` or `/longhaul off`; the
 * host command raises the risk approval before the mode starts, so this module
 * never draws its own popup (which would be clipped by the composer).
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
      'chip.on.title': 'Leave Long Haul mode',
      'chip.failed': 'Long Haul command failed',
    }

    const zh = {
      'chip.label': '长任务',
      'chip.on': '长任务 · {phase}',
      'chip.off.title': '开始长任务模式',
      'chip.on.title': '退出长任务模式',
      'chip.failed': '长任务命令失败',
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
      error: { color: 'var(--dsw-danger, #c0392b)', fontWeight: 700, cursor: 'help' },
    }

    function Chip(props) {
      const view = props.useProjection('longhaul')
      const mode = view === undefined ? 'off' : view.mode
      const phase = view === undefined ? 'P0' : view.phase
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(null)
      const t = props.t

      const run = () => {
        if (busy) return
        setBusy(true)
        setFailed(null)
        const line = mode === 'on' ? '/longhaul off' : '/longhaul on'
        props.execute(line).then((failure) => {
          setBusy(false)
          if (failure !== null) setFailed(failure)
        }, (reason) => {
          setBusy(false)
          setFailed(reason instanceof Error ? reason.message : String(reason))
        })
      }

      const label = mode === 'on' ? t('chip.on').replace('{phase}', phase) : t('chip.label')
      return h('span', { style: styles.wrap },
        h('button', {
          type: 'button',
          style: styles.chip,
          title: mode === 'on' ? t('chip.on.title') : t('chip.off.title'),
          'aria-busy': busy,
          'aria-label': label,
          disabled: busy,
          onClick: run,
        },
        mode === 'on' ? h('span', { style: styles.dot, 'aria-hidden': true }) : null,
        label,
        busy ? h('span', { 'aria-hidden': true }, '…') : null,
        ),
        failed !== null
          ? h('span', { style: styles.error, title: failed, 'aria-label': t('chip.failed') }, '!')
          : null,
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
