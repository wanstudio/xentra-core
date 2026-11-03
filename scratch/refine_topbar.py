import re

def refine(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Remove chevron from branch-pill so MyBangjo Pringsewu never gets truncated
    # Old pattern:
    old_branch_pill = """        <div class="branch-pill" onclick="showToast('📍 Pilih Cabang Restoran')">
          <img src="/assets/upload-aset/branding/Logo app mybangjo.png" class="branch-logo-img" alt="MyBangjo">
          <span class="branch-name" id="branch-name-label">MyBangjo Pringsewu</span>
          <svg class="branch-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>"""

    new_branch_pill = """        <div class="branch-pill" onclick="showToast('📍 Pilih Cabang Restoran')">
          <img src="/assets/upload-aset/branding/Logo app mybangjo.png" class="branch-logo-img" alt="MyBangjo">
          <span class="branch-name" id="branch-name-label">MyBangjo Pringsewu</span>
        </div>"""

    if old_branch_pill in content:
        content = content.replace(old_branch_pill, new_branch_pill)
        print(f"Removed chevron from {filepath}")
    else:
        print(f"old_branch_pill NOT found in {filepath}")

    # 2. Update toggle text: "Resto" -> "Buka", "Pesanan online" -> "Order online:"
    content = content.replace(
        '<span class="op-switch-text bold" id="lbl-shop-status">Resto</span>',
        '<span class="op-switch-text bold" id="lbl-shop-status">Buka</span>'
    )
    content = content.replace(
        '<span class="op-switch-text medium" id="lbl-online-title">Pesanan online</span>',
        '<span class="op-switch-text bold" id="lbl-online-title">Order online:</span>'
    )

    # 3. Update CSS for op-switch-text to exact 12px font-weight 700
    old_op_css = """.op-switch-text {
      font-size: 13px;
      white-space: nowrap;
      color: #303030;
    }
    .op-switch-text.bold {
      font-weight: 700;
    }
    .op-switch-text.medium {
      font-weight: 500;
    }"""

    new_op_css = """.op-switch-text {
      font-size: 12px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      white-space: nowrap;
      color: #303030;
    }
    .op-switch-text.bold {
      font-weight: 700;
    }
    .op-switch-text.medium {
      font-weight: 700;
    }"""

    if old_op_css in content:
        content = content.replace(old_op_css, new_op_css)
        print(f"Updated op-switch-text css in {filepath}")

    # 4. In JS functions toggleShopOpen and toggleOnlineOrder, ensure label matches "Buka" / "Tutup"
    content = content.replace(
        "label.textContent = shopIsOpen ? 'Resto' : 'Tutup';",
        "label.textContent = shopIsOpen ? 'Buka' : 'Tutup';"
    )

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Successfully refined {filepath}")

refine('/home/ubuntu/xentra-core/apps/merchant-app/prototype-pesanan.html')
refine('/home/ubuntu/xentra-core/apps/merchant-shared/prototypes/orders-workflow-redesign.html')
