/**
 * Long Haul composer chip. A click writes `/longhaul on` (or `off`) into the
 * composer through the public input actions and submits it, so the host command
 * owns the risk approval and the command runs in a real turn. No RPC access and
 * no custom popup are needed.
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
      'chip.draft': 'Clear the composer draft before toggling Long Haul.',
    }

    const zh = {
      'chip.label': '长任务',
      'chip.on': '长任务 · {phase}',
      'chip.off.title': '开始长任务模式',
      'chip.on.title': '退出长任务模式',
      'chip.failed': '长任务命令失败',
      'chip.draft': '请先清空输入框草稿，再切换长任务模式。',
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
      const input = typeof props.useInput === 'function' ? props.useInput() : undefined
      const actions = props.inputActions
      const [failed, setFailed] = React.useState(null)
      const t = props.t

      const run = () => {
        if (actions === undefined) {
          setFailed(t('chip.failed'))
          return
        }
        const draft = input === undefined ? '' : input.draft
        if (draft.trim() !== '') {
          setFailed(t('chip.draft'))
          return
        }
        setFailed(null)
        actions.setDraft(mode === 'on' ? '/longhaul off' : '/longhaul on')
        actions.submit()
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
        failed !== null
          ? h('span', { style: styles.error, title: failed, 'aria-label': t('chip.failed') }, '!')
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.locale.register(NS, { zh, en })
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-longhaul',
          order: 20,
          locale: NS,
        }, Chip))
      },
    }
  },
})
