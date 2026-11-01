/**
 * 全局神经工作空间（GNWT）。
 *
 * 容量严格 5 槽，杏仁核劫持（皮质醇 > 0.75）时物理锁死为 2 槽。
 * 点火阈值随静默时间下降、随皮质醇下降，于是长期无外部输入时
 * 海马体的悬置预期与潜意识碎片会自发点火（走神 / 内耗）。
 */

import { PARAMS, clamp } from './constants.js'
import { uid } from './rng.js'

export class GlobalWorkspace {
  constructor({ rng, slots = [], lost = [] } = {}) {
    this.rng = rng
    this.slots = slots
    this.lost = lost
    this.lastIgnition = null
  }

  capacity(state) {
    return state.hijacked ? PARAMS.slotsHijacked : PARAMS.slots
  }

  /** Θ_ign(t) = Θ_base · (1 − 0.5·tanh(Δt/τ_idle)) − 0.25·Cortisol */
  threshold(state, silenceMin) {
    const dt = Math.max(0, silenceMin)
    const raw =
      PARAMS.ignitionBase * (1 - 0.5 * Math.tanh(dt / PARAMS.ignitionTauMin)) - 0.25 * state.cortisol
    return Math.max(PARAMS.ignitionFloor, raw)
  }

  /** 外源/内源共用的点火入口。 */
  ignite(candidate, { state, silenceMin, now }) {
    const theta = this.threshold(state, silenceMin)
    const salience = clamp(Number(candidate.salience ?? 0))
    const approved = Boolean(candidate.force) || salience >= theta
    if (!approved) {
      return { ignited: false, theta: Number(theta.toFixed(3)), salience, reason: 'below-threshold' }
    }

    const slot = {
      id: uid('slot', this.rng),
      kind: candidate.kind ?? 'external',
      source: candidate.source ?? 'unknown',
      title: candidate.title ?? '',
      content: candidate.content ?? '',
      entityId: candidate.entityId ?? null,
      entityName: candidate.entityName ?? null,
      salience,
      arousal: clamp(Number(candidate.arousal ?? 0)),
      pe: clamp(Number(candidate.pe ?? 0)),
      activation: clamp(salience + 0.2),
      bornAt: now,
      memoryId: null,
      tags: candidate.tags ?? [],
    }

    const evicted = []
    const capacity = this.capacity(state)
    while (this.slots.length >= capacity) {
      const victim = this.pickVictim()
      if (!victim) break
      this.slots = this.slots.filter((item) => item.id !== victim.id)
      const forgotten = !victim.memoryId
      if (forgotten) {
        this.lost.push({
          id: victim.id,
          title: victim.title,
          content: victim.content,
          at: now,
          reason: state.hijacked ? 'amygdala-hijack' : 'capacity-overflow',
        })
        if (this.lost.length > 80) this.lost = this.lost.slice(-80)
      }
      evicted.push({
        id: victim.id,
        title: victim.title,
        forgotten,
        memoryId: victim.memoryId,
        activation: Number(victim.activation.toFixed(3)),
      })
    }

    this.slots.push(slot)
    this.lastIgnition = { at: now, kind: slot.kind, title: slot.title, salience, theta }
    return {
      ignited: true,
      theta: Number(theta.toFixed(3)),
      salience,
      slot,
      evicted,
      capacity,
    }
  }

  pickVictim() {
    if (!this.slots.length) return null
    return this.slots.reduce((worst, slot) =>
      slot.activation < worst.activation ||
      (slot.activation === worst.activation && slot.bornAt < worst.bornAt)
        ? slot
        : worst,
    )
  }

  /** 皮质醇飙升导致容量收缩时，立即挤掉最低激活槽位。 */
  enforceCapacity(state, now) {
    const capacity = this.capacity(state)
    const evicted = []
    while (this.slots.length > capacity) {
      const victim = this.pickVictim()
      if (!victim) break
      this.slots = this.slots.filter((item) => item.id !== victim.id)
      if (!victim.memoryId) {
        this.lost.push({
          id: victim.id,
          title: victim.title,
          content: victim.content,
          at: now,
          reason: 'amygdala-hijack',
        })
        if (this.lost.length > 80) this.lost = this.lost.slice(-80)
      }
      evicted.push({ id: victim.id, title: victim.title, forgotten: !victim.memoryId })
    }
    return evicted
  }

  decay(dtMin) {
    if (!(dtMin > 0)) return
    const factor = Math.pow(2, -dtMin / PARAMS.slotActivationHalfLifeMin)
    for (const slot of this.slots) {
      slot.activation = clamp(slot.activation * factor)
    }
    this.slots = this.slots.filter((slot) => slot.activation > 0.03 || slot.memoryId)
  }

  markWritten(slotId, memoryId) {
    const slot = this.slots.find((item) => item.id === slotId)
    if (slot) slot.memoryId = memoryId
  }

  find(query = '') {
    const q = String(query)
    return this.slots.find(
      (slot) => slot.title.includes(q) || slot.content.includes(q) || (slot.entityName ?? '').includes(q),
    )
  }

  recentlyLost(query = '') {
    const q = String(query)
    return this.lost.filter((item) => item.title.includes(q) || item.content.includes(q)).slice(-3)
  }

  snapshot() {
    return this.slots.map((slot) => ({
      id: slot.id,
      kind: slot.kind,
      title: slot.title,
      content: slot.content,
      entityName: slot.entityName,
      salience: Number(slot.salience.toFixed(3)),
      activation: Number(slot.activation.toFixed(3)),
      pe: Number(slot.pe.toFixed(3)),
      bornAt: slot.bornAt,
      written: Boolean(slot.memoryId),
    }))
  }

  toJSON() {
    return { slots: this.slots, lost: this.lost }
  }

  static fromJSON(json, rng) {
    return new GlobalWorkspace({ rng, slots: json?.slots ?? [], lost: json?.lost ?? [] })
  }
}
