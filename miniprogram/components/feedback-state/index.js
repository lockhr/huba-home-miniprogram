Component({
  properties: {
    loading: Boolean,
    error: String,
    label: { type: String, value: '正在加载…' },
  },
  methods: { retry() { if (!this.data.loading) this.triggerEvent('retry') } },
})
