import re

def update_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update .topbar-wrapper CSS to support .has-subfilters
    old_topbar_css = """    .topbar-wrapper {
      background: #ffffff;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0px 4px 25px 5px rgba(0, 0, 0, 0.10);
      padding: 16px 16px 0 16px;
      display: flex;
      flex-direction: column;
      border-bottom: none;
    }"""

    new_topbar_css = """    .topbar-wrapper {
      background: #ffffff;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0px 4px 25px 5px rgba(0, 0, 0, 0.10);
      padding: 16px 16px 0 16px; /* Base for other tabs: 0 bottom padding so active tab indicator sits flush to bottom edge */
      display: flex;
      flex-direction: column;
      border-bottom: none;
      transition: padding 0.15s ease;
    }
    .topbar-wrapper.has-subfilters {
      padding: 16px 16px 16px 16px; /* Exact 16px bottom padding on 'Dalam proses' per Figma spec */
    }"""

    if old_topbar_css in content:
        content = content.replace(old_topbar_css, new_topbar_css)
        print(f"Updated .topbar-wrapper CSS in {filepath}")
    else:
        print(f"old_topbar_css NOT found in {filepath}")

    # 2. Update .pesanan-nav-tabs CSS to support .has-subfilters
    old_tabs_css = """    .pesanan-nav-tabs {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 22px; /* Exact 22px gap from Figma Frame 312 */
      border-top: none;
      padding: 0;
      margin-bottom: 0; /* Flush to bottom edge of topbar */
      background: transparent;
    }"""

    new_tabs_css = """    .pesanan-nav-tabs {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 22px; /* Exact 22px gap from Figma Frame 312 */
      border-top: none;
      padding: 0;
      margin-bottom: 0; /* Flush to bottom edge of topbar on other tabs */
      background: transparent;
      position: relative;
      transition: margin-bottom 0.15s ease;
    }
    .pesanan-nav-tabs.has-subfilters {
      margin-bottom: 12px; /* Exact 12px gap to row 4 subfilters on 'Dalam proses' */
    }"""

    if old_tabs_css in content:
        content = content.replace(old_tabs_css, new_tabs_css)
        print(f"Updated .pesanan-nav-tabs CSS in {filepath}")
    else:
        print(f"old_tabs_css NOT found in {filepath}")

    # 3. Update .stage-subfilter-bar CSS inside topbar
    old_subfilter_css = """    .stage-subfilter-bar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px; /* Exact 10px gap from Figma Frame 312 */
      width: 100%;
      padding: 12px 16px 4px 16px;
      box-sizing: border-box;
      background: transparent;
      border: none;
    }"""

    new_subfilter_css = """    .stage-subfilter-bar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px; /* Exact 10px gap from Figma Frame 312 */
      width: 100%;
      padding: 0;
      margin: 0;
      box-sizing: border-box;
      background: transparent;
      border: none;
    }"""

    if old_subfilter_css in content:
        content = content.replace(old_subfilter_css, new_subfilter_css)
        print(f"Updated .stage-subfilter-bar CSS in {filepath}")
    else:
        print(f"old_subfilter_css NOT found in {filepath}")

    # 4. In HTML, place stage-subfilter-bar INSIDE <header class="topbar-wrapper has-subfilters">
    # Search for header closing pattern
    html_pattern = re.compile(
        r'<header class="topbar-wrapper"[^>]*>(.*?)</nav>\s*</header>\s*<!-- ROW 4: Kitchen Stage Sub-Filter[^>]*-->\s*<div class="stage-subfilter-bar" id="stage-subfilter-bar">(.*?)</div>',
        re.DOTALL
    )

    def repl_html(m):
        inner_header = m.group(1)
        subfilter_inner = m.group(2)
        # Add has-subfilters to header and nav
        return f"""<header class="topbar-wrapper has-subfilters" id="topbar-wrapper">{inner_header}</nav>

      <!-- ROW 4: Kitchen Stage Sub-Filter (Hanya di tab 'Dalam proses', Figma Frame 312) -->
      <div class="stage-subfilter-bar" id="stage-subfilter-bar">{subfilter_inner}</div>
    </header>"""

    if html_pattern.search(content):
        content = html_pattern.sub(repl_html, content)
        print(f"Updated HTML header structure in {filepath}")
    else:
        print(f"HTML header pattern NOT found in {filepath}")

    # Ensure pesanan-nav-tabs has class "has-subfilters" and id="pesanan-nav-tabs"
    content = content.replace(
        '<nav class="pesanan-nav-tabs" role="tablist">',
        '<nav class="pesanan-nav-tabs has-subfilters" id="pesanan-nav-tabs" role="tablist">'
    )

    # 5. Update switchMainTab in JS to toggle has-subfilters
    old_switch_main_tab = """      const stageBar = document.getElementById('stage-subfilter-bar');
      if (stageBar) {
        stageBar.style.display = (tab === 'in_process') ? 'flex' : 'none';
      }

      renderOrders();"""

    new_switch_main_tab = """      const topbar = document.getElementById('topbar-wrapper') || document.querySelector('.topbar-wrapper');
      const tabsNav = document.getElementById('pesanan-nav-tabs') || document.querySelector('.pesanan-nav-tabs');
      const stageBar = document.getElementById('stage-subfilter-bar');

      if (tab === 'in_process') {
        // Tab "Dalam proses": Masukkan kembali kapsul subfilter (Semua, Masuk, Dimasak, Siap) ke dalam topbar
        if (stageBar) stageBar.style.display = 'flex';
        if (topbar) topbar.classList.add('has-subfilters');
        if (tabsNav) tabsNav.classList.add('has-subfilters');
      } else {
        // Tab selain "Dalam proses" (Terjadwal, Selesai, Batal): Sembunyikan subfilter & indikator hitam menempel flush di tepi bawah top bar
        if (stageBar) stageBar.style.display = 'none';
        if (topbar) topbar.classList.remove('has-subfilters');
        if (tabsNav) tabsNav.classList.remove('has-subfilters');
      }

      renderOrders();"""

    if old_switch_main_tab in content:
        content = content.replace(old_switch_main_tab, new_switch_main_tab)
        print(f"Updated switchMainTab in {filepath}")
    else:
        print(f"old_switch_main_tab NOT found in {filepath}")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Finished updating {filepath}")

update_file('/home/ubuntu/xentra-core/apps/merchant-app/prototype-pesanan.html')
update_file('/home/ubuntu/xentra-core/apps/merchant-shared/prototypes/orders-workflow-redesign.html')
