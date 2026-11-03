import re

# 1. Update apps/merchant-app/assets/css/home.css
css_file = '/home/ubuntu/xentra-core/apps/merchant-app/assets/css/home.css'
with open(css_file, 'r', encoding='utf-8') as f:
    css_content = f.read()

old_css_target = """.bm-pesanan-card {
  background: #ffffff !important;
  border-radius: 16px !important;
  padding: 14px 16px !important;
  margin: 0 !important;
  width: 100% !important;
  border: 1px solid #e5e5e5 !important;
  cursor: pointer !important;
  box-sizing: border-box !important;
  transition: transform 0.1s ease !important;
}

.bm-pesanan-card:active {
  transform: scale(0.995) !important;
}

.bm-pesanan-card-header {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
}

.bm-pesanan-card-order-info {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
}

.bm-pesanan-card-icon {
  width: 26px !important;
  height: 26px !important;
  object-fit: contain !important;
  flex-shrink: 0 !important;
}

.bm-pesanan-card-code {
  font-size: 15px !important;
  font-weight: 800 !important;
  color: #303030 !important;
  letter-spacing: -0.2px !important;
}

.bm-pesanan-card-items-link {
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  color: #979797 !important;
}

.bm-pesanan-card-items-link svg {
  stroke: #979797 !important;
}

.bm-pesanan-card-divider {
  height: 1px !important;
  background: #e5e5e5 !important;
  margin: 10px 0 12px !important;
  width: 100% !important;
}

.bm-pesanan-card-body {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
}

.bm-pesanan-card-cust {
  font-size: 15px !important;
  font-weight: 800 !important;
  color: #303030 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

.bm-pesanan-badge {
  display: inline-flex !important;
  align-items: center !important;
  padding: 4px 12px !important;
  border-radius: 9999px !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  text-transform: capitalize !important;
  white-space: nowrap !important;
}

.bm-pesanan-badge.badge-delivery {
  background: #dbeafe !important;
  color: #1e5eb2 !important;
  border: none !important;
}

.bm-pesanan-badge.badge-dinein {
  background: #fef9c3 !important;
  color: #a16207 !important;
  border: none !important;
}

.bm-pesanan-badge.badge-takeaway {
  background: #f1f5f9 !important;
  color: #475569 !important;
  border: none !important;
}

.bm-pesanan-badge.badge-reservation {
  background: #f5f3ff !important;
  color: #7c3aed !important;
  border: none !important;
}

/* Action Buttons styled per warna2 tombol.png */
.bm-pesanan-action-btn {
  width: 100% !important;
  height: 42px !important;
  border-radius: 12px !important;
  border: none !important;
  font-size: 14px !important;
  font-weight: 800 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer !important;
  margin-top: 12px !important;
  transition: opacity 0.15s ease, transform 0.1s ease !important;
  text-align: center !important;
}

.bm-pesanan-action-btn.btn-green {
  background: #00a637 !important;
  color: #ffffff !important;
}

.bm-pesanan-action-btn.btn-coral {
  background: #fa3e3e !important;
  color: #ffffff !important;
}

.bm-pesanan-action-btn.btn-blue {
  background: #1e5eb2 !important;
  color: #ffffff !important;
}

.bm-pesanan-action-btn.btn-charcoal {
  background: #303030 !important;
  color: #ffffff !important;
}"""

new_css_replacement = """/* ========================================================
   ORDER CARDS REDESIGN - FIGMA FRAME 208 / 312 SPECIFICATION
   ======================================================== */
.bm-pesanan-card {
  background: #ffffff !important;
  border-radius: 20px !important;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04) !important;
  padding: 16px !important;
  margin: 0 !important;
  width: 100% !important;
  border: 1px solid #f1f5f9 !important;
  cursor: pointer !important;
  box-sizing: border-box !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 12px !important;
  position: relative !important;
  transition: transform 0.12s ease, box-shadow 0.12s ease !important;
  -webkit-tap-highlight-color: transparent !important;
}

.bm-pesanan-card:active {
  transform: scale(0.992) !important;
}

/* 1. Urgent Countdown Banner for Incoming / Pending Orders */
.urgent-timer-bar {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  background: #FF8736 !important;
  border-radius: 9.5px !important;
  height: 38px !important;
  padding: 0 14px !important;
  font-size: 12.5px !important;
  font-weight: 700 !important;
  color: #ffffff !important;
  box-sizing: border-box !important;
}

.urgent-timer-bar .pulse-dot {
  width: 7px !important;
  height: 7px !important;
  border-radius: 50% !important;
  background: #ffffff !important;
  display: inline-block !important;
  animation: bmPulse 1.2s infinite !important;
}

@keyframes bmPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.5; }
}

/* 2. Card Header (Channel Icon 40x40, Order Code #ORD-XXX, Channel Pill Badge, Time) */
.bm-pesanan-card .card-head {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 10px !important;
  width: 100% !important;
}

.bm-pesanan-card .card-meta-left {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
}

.bm-pesanan-card .channel-avatar-icon {
  width: 40px !important;
  height: 40px !important;
  border-radius: 12px !important;
  object-fit: contain !important;
  background: #f8fafc !important;
  flex-shrink: 0 !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06) !important;
}

.bm-pesanan-card .order-meta-info {
  display: flex !important;
  flex-direction: column !important;
  gap: 3px !important;
}

.bm-pesanan-card .order-code {
  font-size: 14.5px !important;
  font-weight: 800 !important;
  color: #111827 !important;
  letter-spacing: -0.2px !important;
  line-height: 1.2 !important;
}

.bm-pesanan-card .channel-pill-badge {
  display: inline-flex !important;
  align-items: center !important;
  padding: 1px 8px !important;
  border-radius: 9999px !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  width: fit-content !important;
  line-height: 1.4 !important;
  white-space: nowrap !important;
}

.bm-pesanan-card .channel-pill-badge.delivery {
  background: #DBEAFF !important;
  color: #1E5EB2 !important;
  border: 1px solid rgba(30, 94, 178, 0.2) !important;
}

.bm-pesanan-card .channel-pill-badge.dine_in,
.bm-pesanan-card .channel-pill-badge.dinein {
  background: #F1F5F9 !important;
  color: #334155 !important;
  border: 1px solid #CBD5E1 !important;
}

.bm-pesanan-card .channel-pill-badge.takeaway,
.bm-pesanan-card .channel-pill-badge.pickup {
  background: #FEF3C7 !important;
  color: #B45309 !important;
  border: 1px solid #FCD34D !important;
}

.bm-pesanan-card .channel-pill-badge.reservation {
  background: #EDE9FE !important;
  color: #6D28D9 !important;
  border: 1px solid #DDD6FE !important;
}

.bm-pesanan-card .card-time {
  font-size: 11.5px !important;
  font-weight: 600 !important;
  color: #9ca3af !important;
  white-space: nowrap !important;
}

/* 3. Inline Kitchen Menu Items Preview (Figma Gray Box 15.5px Radius) */
.bm-pesanan-card .card-items-box {
  background: #F6F7F7 !important;
  border-radius: 15.5px !important;
  padding: 12px 14px !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  border: 1px solid #E5E7EB !important;
  box-sizing: border-box !important;
  width: 100% !important;
}

.bm-pesanan-card .item-row {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  font-size: 13px !important;
  color: #111827 !important;
  line-height: 1.35 !important;
}

.bm-pesanan-card .item-qty {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 22px !important;
  height: 22px !important;
  border-radius: 4px !important;
  background: #E6E6E6 !important;
  font-weight: 800 !important;
  color: #111827 !important;
  font-size: 11px !important;
  flex-shrink: 0 !important;
}

.bm-pesanan-card .item-name {
  font-weight: 600 !important;
  color: #111827 !important;
}

.bm-pesanan-card .item-notes-box {
  font-size: 11.5px !important;
  color: #64748B !important;
  font-weight: 500 !important;
  margin-left: 30px !important;
  margin-top: 2px !important;
}

/* 4. Action Buttons (Canonical Chromatic CTA System, 39px Capsule) */
.bm-pesanan-card .card-actions-dual {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 10px !important;
  width: 100% !important;
}

.bm-pesanan-card .card-actions-single {
  display: flex !important;
  width: 100% !important;
}

.bm-pesanan-card .card-actions-single .btn-act,
.bm-pesanan-card .card-actions-single .bm-pesanan-action-btn {
  width: 100% !important;
}

.bm-pesanan-card .btn-act,
.bm-pesanan-card .bm-pesanan-action-btn {
  border: none !important;
  border-radius: 19.5px !important;
  height: 39px !important;
  padding: 0 16px !important;
  font-size: 13px !important;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif !important;
  font-weight: 700 !important;
  letter-spacing: -0.01em !important;
  cursor: pointer !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  transition: all 0.15s ease !important;
  white-space: nowrap !important;
  user-select: none !important;
  box-sizing: border-box !important;
  margin: 0 !important;
}

.bm-pesanan-card .btn-act:active,
.bm-pesanan-card .bm-pesanan-action-btn:active {
  transform: scale(0.98) !important;
}

.bm-pesanan-card .btn-act-reject,
.bm-pesanan-card .btn-act-secondary {
  background: #ffffff !important;
  color: #374151 !important;
  border: 1.5px solid #E5E7EB !important;
  font-weight: 600 !important;
}

.bm-pesanan-card .btn-act-accept,
.bm-pesanan-card .btn-act-finish,
.bm-pesanan-card .bm-pesanan-action-btn.btn-green {
  background: #00A637 !important;
  color: #ffffff !important;
  border: none !important;
}

.bm-pesanan-card .btn-act-cook,
.bm-pesanan-card .bm-pesanan-action-btn.btn-blue {
  background: #1E5EB2 !important;
  color: #ffffff !important;
  border: none !important;
}

.bm-pesanan-card .btn-act-alert,
.bm-pesanan-card .bm-pesanan-action-btn.btn-coral {
  background: #FA3E3E !important;
  color: #ffffff !important;
  border: none !important;
}

.bm-pesanan-card .btn-act-floor,
.bm-pesanan-card .bm-pesanan-action-btn.btn-charcoal {
  background: #303030 !important;
  color: #ffffff !important;
  border: none !important;
}

.bm-pesanan-card .btn-act-transit {
  background: #EA580C !important;
  color: #ffffff !important;
  border: none !important;
}"""

if old_css_target in css_content:
    css_content = css_content.replace(old_css_target, new_css_replacement)
    with open(css_file, 'w', encoding='utf-8') as f:
        f.write(css_content)
    print("Successfully updated home.css with order card redesign!")
else:
    print("old_css_target NOT found in home.css")
