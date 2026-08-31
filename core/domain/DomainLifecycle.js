/**
 * Xentra Core Domain Lifecycle (F4)
 * Manages domain operational states (REGISTERED -> ACTIVE -> DISABLED / ERROR).
 */
class DomainLifecycle {
  static STATES = {
    REGISTERED: 'registered',
    ACTIVE: 'active',
    DISABLED: 'disabled',
    ERROR: 'error'
  };

  constructor(initialState = DomainLifecycle.STATES.REGISTERED) {
    this._state = initialState;
    this._history = [{ state: this._state, timestamp: new Date().toISOString() }];
  }

  get state() {
    return this._state;
  }

  isActive() {
    return this._state === DomainLifecycle.STATES.ACTIVE;
  }

  activate() {
    this._transitionTo(DomainLifecycle.STATES.ACTIVE);
  }

  disable(reason = '') {
    this._transitionTo(DomainLifecycle.STATES.DISABLED, reason);
  }

  markError(errMessage) {
    this._transitionTo(DomainLifecycle.STATES.ERROR, errMessage);
  }

  _transitionTo(newState, note = '') {
    const validStates = Object.values(DomainLifecycle.STATES);
    if (!validStates.includes(newState)) {
      throw new Error(`[DomainLifecycle] Invalid target state "${newState}".`);
    }

    this._state = newState;
    this._history.push({
      state: newState,
      note: note ? String(note) : '',
      timestamp: new Date().toISOString()
    });
  }

  getHistory() {
    return [...this._history];
  }
}

module.exports = DomainLifecycle;
