'use strict';

/**
 * MediaLifecycle - Strict State Model for Xentra Media Assets (M1)
 *
 * States:
 * - TEMPORARY: Upload has been received and initial binary validation passed; placed in staging.
 * - UPLOADED: Staged upload has completed binary verification and is queued for processing.
 * - PROCESSING: Asset is currently undergoing optimization / transformation.
 * - READY: Asset processing is complete and verified; eligible for entity attachment.
 * - FAILED: Processing or validation encountered a terminal error. Can be retried.
 * - ORPHAN: Asset was replaced or unlinked from its entity; enters 30-day grace period.
 *
 * Rules:
 * - Only valid transitions are permitted; invalid transitions fail safely with Error.
 * - Entity attachment is strictly permitted ONLY when state is READY.
 * - FAILED assets may transition back to PROCESSING (retry).
 * - ORPHAN assets cannot transition back to READY or PROCESSING.
 */
class MediaLifecycle {
  static STATES = {
    TEMPORARY: 'temporary',
    UPLOADED: 'uploaded',
    PROCESSING: 'processing',
    READY: 'ready',
    FAILED: 'failed',
    ORPHAN: 'orphan'
  };

  static VALID_TRANSITIONS = {
    temporary: ['uploaded', 'processing', 'failed'],
    uploaded: ['processing', 'failed', 'ready'], // direct-to-ready allowed when processing is no-op/M1
    processing: ['ready', 'failed'],
    ready: ['orphan', 'failed'],
    failed: ['processing', 'temporary', 'orphan'], // retryable to processing or temporary
    orphan: [] // terminal state for GC purge
  };

  /**
   * Check if a transition between two states is valid.
   */
  static canTransition(fromState, toState) {
    if (!fromState || !toState) return false;
    const allowed = MediaLifecycle.VALID_TRANSITIONS[fromState];
    return Array.isArray(allowed) && allowed.includes(toState);
  }

  /**
   * Assert that a transition is valid or throw a fail-safe error.
   */
  static assertTransition(fromState, toState) {
    if (!MediaLifecycle.canTransition(fromState, toState)) {
      const error = new Error(`[MediaLifecycle] Transisi status tidak valid dari '${fromState}' ke '${toState}'.`);
      error.code = 'INVALID_LIFECYCLE_TRANSITION';
      error.fromState = fromState;
      error.toState = toState;
      throw error;
    }
  }

  /**
   * Verify if an asset in the given state can be attached to an entity.
   */
  static canAttach(state) {
    return state === MediaLifecycle.STATES.READY;
  }
}

module.exports = MediaLifecycle;
