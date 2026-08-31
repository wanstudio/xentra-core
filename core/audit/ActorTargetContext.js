/**
 * Xentra Core Actor & Target Context (E2)
 * Standardized structures representing who performed the action and what was affected.
 */
class ActorTargetContext {
  /**
   * Normalizes Actor information.
   */
  static createActor({
    actor_id,
    actor_type = 'user', // 'user' | 'system' | 'api_key'
    role = null,
    ip_address = null,
    user_agent = null
  }) {
    if (!actor_id || typeof actor_id !== 'string') {
      throw new Error('[ActorTargetContext] "actor_id" is required.');
    }

    const validActorTypes = ['user', 'system', 'api_key'];
    if (!validActorTypes.includes(actor_type)) {
      throw new Error(`[ActorTargetContext] Invalid actor_type "${actor_type}".`);
    }

    return Object.freeze({
      actor_id: actor_id.trim(),
      actor_type,
      role: role ? String(role).trim() : null,
      ip_address: ip_address ? String(ip_address).trim() : null,
      user_agent: user_agent ? String(user_agent).trim() : null
    });
  }

  /**
   * Normalizes Target Entity information.
   */
  static createTarget({
    entity_type,
    entity_id,
    organization_id = null,
    brand_id = null,
    branch_id = null
  }) {
    if (!entity_type || typeof entity_type !== 'string') {
      throw new Error('[ActorTargetContext] "entity_type" is required.');
    }
    if (!entity_id || typeof entity_id !== 'string') {
      throw new Error('[ActorTargetContext] "entity_id" is required.');
    }

    return Object.freeze({
      entity_type: entity_type.trim(),
      entity_id: entity_id.trim(),
      organization_id: organization_id ? String(organization_id).trim() : null,
      brand_id: brand_id ? String(brand_id).trim() : null,
      branch_id: branch_id ? String(branch_id).trim() : null
    });
  }
}

module.exports = ActorTargetContext;
