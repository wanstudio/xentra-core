/**
 * Xentra Core Permission Model (B4)
 * Granular permissions catalog and authoritative Role -> Permissions mapping.
 */
const RoleModel = require('./RoleModel');

class PermissionModel {
  /**
   * System Permissions Catalog
   */
  static PERMISSIONS = {
    // Organization & Brand
    ORG_MANAGE: 'org:manage',
    BRAND_MANAGE: 'brand:manage',
    
    // Branch
    BRANCH_CREATE: 'branch:create',
    BRANCH_READ: 'branch:read',
    BRANCH_UPDATE: 'branch:update',
    
    // Catalog & Menu
    MENU_MANAGE: 'menu:manage',
    MENU_VIEW: 'menu:view',
    
    // POS & Orders
    ORDER_CREATE: 'order:create',
    ORDER_ACCEPT: 'order:accept',
    ORDER_PREPARE: 'order:prepare',
    ORDER_COMPLETE: 'order:complete',
    ORDER_CANCEL: 'order:cancel',
    ORDER_VIEW: 'order:view',
    
    // Reports & Analytics
    ANALYTICS_VIEW: 'analytics:view'
  };

  /**
   * Authoritative Role -> Permissions Matrix
   */
  static ROLE_PERMISSIONS_MATRIX = {
    [RoleModel.ROLES.OWNER]: [
      '*' // Full administrative access across the organization
    ],
    [RoleModel.ROLES.BRAND_MANAGER]: [
      'brand:manage',
      'branch:create',
      'branch:read',
      'branch:update',
      'menu:manage',
      'menu:view',
      'order:view',
      'analytics:view'
    ],
    [RoleModel.ROLES.BRANCH_MANAGER]: [
      'branch:read',
      'branch:update',
      'menu:view',
      'order:create',
      'order:accept',
      'order:prepare',
      'order:complete',
      'order:cancel',
      'order:view',
      'analytics:view'
    ],
    [RoleModel.ROLES.CASHIER]: [
      'menu:view',
      'order:create',
      'order:accept',
      'order:cancel',
      'order:view'
    ],
    [RoleModel.ROLES.KITCHEN]: [
      'order:view',
      'order:prepare',
      'order:complete'
    ],
    [RoleModel.ROLES.CUSTOMER]: [
      'menu:view',
      'order:create',
      'order:view'
    ]
  };

  /**
   * Checks if a role is granted a specific permission.
   * @param {string} role
   * @param {string} permission
   * @returns {boolean}
   */
  static hasPermission(role, permission) {
    const list = PermissionModel.ROLE_PERMISSIONS_MATRIX[role] || [];
    if (list.includes('*')) return true;
    return list.includes(permission);
  }

  /**
   * Lists all permissions granted to a role.
   * @param {string} role
   * @returns {Array<string>}
   */
  static getPermissions(role) {
    return PermissionModel.ROLE_PERMISSIONS_MATRIX[role] || [];
  }
}

module.exports = PermissionModel;
