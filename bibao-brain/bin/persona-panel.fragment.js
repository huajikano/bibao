    /* ------------------------------------------------------------------ */
    /* 人物：配置 → 生成 → 审核 → 应用                                      */
    /* ------------------------------------------------------------------ */

    class PersonaPanel extends React.Component {
      constructor(props) {
        super(props)
        this.state = {
          seed: { name: '', ageNow: 22, city: '', occupation: '', tone: '', wound: '', userName: '', userRelation: '', brief: '' },
          draft: null,
          draftId: '',
          busy: false,
          note: '',
        }
        this.edit = this.edit.bind(this)
        this.generate = this.generate.bind(this)
        this.apply = this.apply.bind(this)
      }

      edit(field, value) {
        this.setState((prev) => ({ seed: { ...prev.seed, [field]: value } }))
      }

      async generate() {
        const seed = this.state.seed
        const brief = String(seed.brief || '').trim()
        const payload = {
          name: seed.name || undefined,
          ageNow: seed.ageNow || undefined,
          city: seed.city || undefined,
          occupation: seed.occupation || undefined,
          tone: seed.tone || undefined,
          wound: seed.wound || undefined,
          userName: seed.userName || undefined,
          userRelation: seed.userRelation || undefined,
          oneLine: brief && brief.length <= 60 ? brief : undefined,
          canon: brief.length > 60 ? brief.slice(0, 2400) : undefined,
        }
        if (brief && brief.length <= 60) payload.tone = [payload.tone, brief].filter(Boolean).join('，')
        this.setState({ busy: true, note: '生成中…（十几秒）' })
        try {
          const data = await request('/biography/generate', { method: 'POST', body: JSON.stringify({ seed: payload }) })
          const warn = data.warnings && data.warnings.length ? ' · ' + data.warnings[0] : ''
          this.setState({
            draft: data.persona,
            draftId: data.draftId || '',
            busy: false,
            note: (data.source === 'ai' ? 'AI 生成' : '模板生成') + warn,
          })
        } catch (error) {
          this.setState({ busy: false, note: '失败：' + error.message })
        }
      }

      async apply(mode) {
        if (!this.state.draft) return
        this.setState({ busy: true, note: '应用中…' })
        try {
          const data = await request('/biography/apply', {
            method: 'POST',
            body: JSON.stringify({ draftId: this.state.draftId, mode: mode }),
          })
          const added = data.result ? data.result.added || 0 : 0
          this.setState({
            busy: false,
            draft: null,
            note: data.result && data.result.mode === 'rebuild' ? '已按新人生重建' : '已补进 ' + added + ' 条经历',
          })
        } catch (error) {
          this.setState({ busy: false, note: '应用失败：' + error.message })
        }
      }

      render() {
        const { seed, draft, busy, note } = this.state
        const fields = [
          ['name', '名字（必填）'],
          ['ageNow', '现在年龄（必填）'],
          ['city', '城市（可选）'],
          ['occupation', '职业（可选）'],
          ['tone', '性格气质（可选）'],
          ['wound', '核心伤口（可选）'],
          ['userName', '你怎么称呼（可选）'],
          ['userRelation', '你和她的关系（可选）'],
        ]
        return h(
          'div',
          { className: 'bb-stack' },
          h(
            Card,
            { title: '人物经历（AI 生成）', hint: '填好配置 → 生成 → 审核 → 应用' },
            h(
              'div',
              { className: 'bb-personaGrid' },
              fields.map((item) =>
                h(
                  'label',
                  { key: item[0], className: 'bb-personaField' },
                  h('span', { className: 'bb-muted' }, item[1]),
                  h('input', {
                    className: 'bb-input',
                    type: item[0] === 'ageNow' ? 'number' : 'text',
                    value: seed[item[0]],
                    onChange: (event) => this.edit(item[0], item[0] === 'ageNow' ? Number(event.target.value) : event.target.value),
                  }),
                ),
              ),
            ),
            h('textarea', {
              className: 'bb-textarea',
              rows: 4,
              placeholder: '补充：一句话设定，或直接粘贴小说片段 / 人物小传（超过 60 字按原著设定生成）',
              value: seed.brief,
              onChange: (event) => this.edit('brief', event.target.value),
            }),
            h(
              'div',
              { className: 'bb-actions' },
              h('button', { type: 'button', className: 'bb-btn primary', disabled: busy, onClick: this.generate }, busy ? '处理中…' : '生成一版'),
              draft ? h('button', { type: 'button', className: 'bb-btn', disabled: busy, onClick: () => this.apply('merge') }, '应用（只补新经历）') : null,
              draft ? h('button', { type: 'button', className: 'bb-btn', disabled: busy, onClick: () => this.apply('rebuild') }, '应用并重建') : null,
              note ? h('span', { className: 'bb-chip good' }, note) : null,
            ),
          ),
          draft
            ? h(
                Card,
                { title: '审核这一版', hint: draft.events.length + ' 条经历 · ' + draft.relations.length + ' 段关系' },
                h('div', { className: 'bb-muted' }, draft.oneLine || ''),
                h(
                  'div',
                  { className: 'bb-personaList' },
                  draft.events.map((event, index) =>
                    h(
                      'div',
                      { key: index, className: 'bb-a9' },
                      h(Chip, { children: event.age + ' 岁' }),
                      h('span', {}, event.title + '｜' + String(event.narrative).slice(0, 30) + '…'),
                      h('span', { className: 'bb-muted' }, event.valence >= 0 ? '好感' : '难受'),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'bb-personaList', style: { marginBlockStart: '8px' } },
                  draft.relations.map((row) =>
                    h(
                      'div',
                      { key: row.name, className: 'bb-a9' },
                      h(Chip, { children: row.name }),
                      h('span', { className: 'bb-muted' }, '好感 ' + row.intimacy + ' · 信任 ' + row.trust + ' · 敬畏 ' + row.powerFear),
                      h('span', { className: 'bb-muted' }, row.impression),
                    ),
                  ),
                ),
              )
            : null,
        )
      }
    }

