/**
 * XENTRA CORE — MERCHANT SHARED CATALOG CLIENT
 *
 * Transport/data-access boundary for Branch Catalog operations shared by
 * Owner Dashboard and Merchant App.
 *
 * No DOM manipulation, rendering, modal logic, or surface-specific state.
 * Must be loaded after merchant-shared/js/shared.js.
 */
(function (window) {
  'use strict';

  var S = window.XentraShared;
  if (!S) {
    throw new Error('[XentraCatalogClient] XentraShared must be loaded first.');
  }

  var API_BASE = S.API_BASE || '';
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;

  async function request(url, options) {
    var opts = options ? Object.assign({}, options) : {};
    var headers = Object.assign({}, getAuthHeaders(), opts.headers || {});
    opts.headers = headers;

    var target = String(url || '');
    if (!/^https?:\/\//i.test(target)) {
      target = API_BASE + target;
    }

    return adminFetch(target, opts);
  }


  function getBranchCatalog(branchId) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/catalog');
  }

  function setBranchProductAvailability(branchId, productId, isAvailable) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId), {
      method: 'PATCH',
      body: JSON.stringify({ is_available: isAvailable })
    });
  }

  function removeBranchProduct(branchId, productId) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId), {
      method: 'DELETE'
    });
  }

  function uploadBranchProductImage(branchId, productId, payload) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId) + '/image', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  function updateBranchProductOverride(branchId, productId, payload) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId) + '/override', {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }

  function createBranchCategory(branchId, payload) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/categories', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  function updateBranchCategory(branchId, categoryId, payload) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/categories/' + encodeURIComponent(categoryId), {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }

  function uploadBranchCategoryImage(branchId, categoryId, payload) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/categories/' + encodeURIComponent(categoryId) + '/image', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  function deleteBranchCategory(branchId, categoryId) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/categories/' + encodeURIComponent(categoryId), {
      method: 'DELETE'
    });
  }

  function reorderBranchCategories(branchId, orderedIds) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/categories/reorder', {
      method: 'PUT',
      body: JSON.stringify({ order: orderedIds })
    });
  }

  function adoptProduct(branchId, payload) {
    return request('/admin/branches/' + encodeURIComponent(branchId) + '/adopt', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  window.XentraCatalogClient = {
    request: request,
    getBranchCatalog: getBranchCatalog,
    setBranchProductAvailability: setBranchProductAvailability,
    removeBranchProduct: removeBranchProduct,
    uploadBranchProductImage: uploadBranchProductImage,
    updateBranchProductOverride: updateBranchProductOverride,
    createBranchCategory: createBranchCategory,
    updateBranchCategory: updateBranchCategory,
    uploadBranchCategoryImage: uploadBranchCategoryImage,
    deleteBranchCategory: deleteBranchCategory,
    reorderBranchCategories: reorderBranchCategories,
    adoptProduct: adoptProduct
  };
})(window);
