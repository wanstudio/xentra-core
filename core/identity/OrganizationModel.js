/**
 * Xentra Core Organization Model (B2)
 * Manages the structural hierarchy: Organization (Owner) -> Brand -> Branch.
 */
class OrganizationModel {
  /**
   * Constructs an Organization hierarchy manager.
   */
  constructor() {
    this._orgs = new Map();     // id -> org
    this._brands = new Map();   // id -> brand { id, org_id, name, ... }
    this._branches = new Map(); // id -> branch { id, brand_id, name, phone, ... }
  }

  createOrganization({ id, name, owner_user_id }) {
    if (!id || !name || !owner_user_id) {
      throw new Error('[OrganizationModel] "id", "name", and "owner_user_id" are required.');
    }
    const org = {
      id: id.trim(),
      name: name.trim(),
      owner_user_id: owner_user_id.trim(),
      created_at: new Date().toISOString()
    };
    this._orgs.set(org.id, org);
    return org;
  }

  createBrand({ id, organization_id, name }) {
    if (!id || !organization_id || !name) {
      throw new Error('[OrganizationModel] "id", "organization_id", and "name" are required.');
    }
    if (!this._orgs.has(organization_id)) {
      throw new Error(`[OrganizationModel] Parent organization "${organization_id}" does not exist.`);
    }
    const brand = {
      id: id.trim(),
      organization_id: organization_id.trim(),
      name: name.trim(),
      created_at: new Date().toISOString()
    };
    this._brands.set(brand.id, brand);
    return brand;
  }

  createBranch({ id, brand_id, name, phone }) {
    if (!id || !brand_id || !name) {
      throw new Error('[OrganizationModel] "id", "brand_id", and "name" are required.');
    }
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      throw new Error('[OrganizationModel] Branch phone (WhatsApp number) is mandatory.');
    }
    if (!this._brands.has(brand_id)) {
      throw new Error(`[OrganizationModel] Parent brand "${brand_id}" does not exist.`);
    }
    const branch = {
      id: id.trim(),
      brand_id: brand_id.trim(),
      name: name.trim(),
      phone: phone.trim(),
      created_at: new Date().toISOString()
    };
    this._branches.set(branch.id, branch);
    return branch;
  }

  getOrganization(orgId) {
    return this._orgs.get(orgId) || null;
  }

  getBrand(brandId) {
    return this._brands.get(brandId) || null;
  }

  getBranch(branchId) {
    return this._branches.get(branchId) || null;
  }

  /**
   * Verifies if a branch belongs to a brand.
   */
  isBranchInBrand(branchId, brandId) {
    const branch = this._branches.get(branchId);
    return branch ? branch.brand_id === brandId : false;
  }

  /**
   * Verifies if a brand belongs to an organization.
   */
  isBrandInOrganization(brandId, orgId) {
    const brand = this._brands.get(brandId);
    return brand ? brand.organization_id === orgId : false;
  }

  clear() {
    this._orgs.clear();
    this._brands.clear();
    this._branches.clear();
  }
}

module.exports = OrganizationModel;
