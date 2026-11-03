import re

def update_prototype(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update .topbar-wrapper padding to 16px 16px 0 16px
    content = content.replace(
        'padding: 16px 16px 16px 16px;',
        'padding: 16px 16px 0 16px;'
    )

    # 2. Update .pesanan-nav-tabs and .pesanan-nav-tab
    old_tabs_css = """    .pesanan-nav-tabs {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 22px; /* Exact 22px gap from Figma Frame 312 */
      border-top: none;
      padding-top: 0;
      margin-bottom: 12px; /* Exact 12px gap to row 4 */
      background: transparent;
    }

    .pesanan-nav-tab {
      flex: 0 0 auto;
      border: none;
      background: transparent;
      padding: 4px 0 8px;"""

    new_tabs_css = """    .pesanan-nav-tabs {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 22px; /* Exact 22px gap from Figma Frame 312 */
      border-top: none;
      padding: 0;
      margin-bottom: 0; /* Flush to bottom edge of topbar */
      background: transparent;
    }

    .pesanan-nav-tab {
      flex: 0 0 auto;
      border: none;
      background: transparent;
      padding: 4px 0 10px;"""

    if old_tabs_css in content:
        content = content.replace(old_tabs_css, new_tabs_css)
        print("Replaced tabs css")
    else:
        print("old_tabs_css NOT found in", filepath)

    # 3. Update .stage-subfilter-bar padding
    old_subfilter_css = """    .stage-subfilter-bar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px; /* Exact 10px gap from Figma Frame 312 */
      width: 100%;
      background: transparent;
      border: none;
    }"""

    new_subfilter_css = """    .stage-subfilter-bar {
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

    if old_subfilter_css in content:
        content = content.replace(old_subfilter_css, new_subfilter_css)
        print("Replaced subfilter css")
    else:
        print("old_subfilter_css NOT found in", filepath)

    # 4. Move </header> before stage-subfilter-bar in HTML
    pattern = re.compile(
        r'(</nav>\s*)<!-- ROW 4: Kitchen Stage Sub-Filter[^>]*-->\s*<div class="stage-subfilter-bar" id="stage-subfilter-bar">(.*?)</div>\s*</header>',
        re.DOTALL
    )

    def repl(m):
        return f"{m.group(1)}</header>\n\n      <!-- ROW 4: Kitchen Stage Sub-Filter (Outside Sticky Topbar - Flush Indicator) -->\n      <div class=\"stage-subfilter-bar\" id=\"stage-subfilter-bar\">{m.group(2)}</div>"

    if pattern.search(content):
        content = pattern.sub(repl, content)
        print("Replaced HTML header closing")
    else:
        print("pattern for HTML header closing NOT found in", filepath)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'Successfully updated {filepath}')

update_prototype('/home/ubuntu/xentra-core/apps/merchant-app/prototype-pesanan.html')
update_prototype('/home/ubuntu/xentra-core/apps/merchant-shared/prototypes/orders-workflow-redesign.html')
