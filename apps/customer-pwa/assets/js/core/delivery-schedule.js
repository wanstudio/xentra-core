/**
 * Xentra Delivery Schedule — device-local timezone slot calculation.
 *
 * LOCKED DECISION (supersedes any earlier WordPress-timezone wording):
 *   - current time = device/customer LOCAL timezone, taken from `new Date()`
 *     and its LOCAL getters. NEVER the WordPress/server timezone.
 *   - interval: 30 minutes.
 *   - first available slot = current device time + 1 hour, then ROUND UP to
 *     the next 30-minute boundary. Order is WAJIB: +1 hour FIRST, round UP
 *     SECOND. Never round first and then add 1 hour.
 *   - day/date transition follows the device-local calendar. A first slot that
 *     lands after midnight belongs to the NEXT device-local day; it is never
 *     offered under "Hari ini" and never computed with a server date.
 *   - ASAP remains the default; scheduling stays optional (no schedule = order
 *     is processed ASAP).
 *   - When a canonical timestamp is needed for order storage it is derived
 *     from the device-local selection as ISO-8601 WITH the device offset. It is
 *     never converted back to a server timezone for display or slot generation.
 *
 * Operating hours: Xentra-Core currently has NO operating-hours record (server
 * B1 gap). Slot generation therefore defaults to a round-the-clock 30-minute
 * grid. The optional `opening_time`/`closing_time` window and the "off day"
 * (window = null) hooks below keep this module compatible with a future
 * operating-hours data source without inventing one.
 */
(function () {
  'use strict';

  var SLOT_MINUTES = 30;
  var MINUTES_IN_DAY = 24 * 60;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function minutesLabel(minutes) {
    minutes = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return pad(h) + ':' + pad(m);
  }

  function slotItem(startMinutes, endMinutes) {
    var value = minutesLabel(startMinutes) + '-' + minutesLabel(endMinutes);
    return { value: value, label: value, startMinutes: startMinutes, endMinutes: endMinutes };
  }

  // '15:00-15:30' -> 900
  function labelToMinutes(label) {
    var parts = String(label || '').split('-');
    var t = (parts[0] || '').split(':');
    return Number(t[0] || 0) * 60 + Number(t[1] || 0);
  }

  function midnight(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // ── 1. FIRST AVAILABLE SLOT (locked math) ──
  // now(device) + 1 hour -> round UP to next 30-minute boundary -> day carry.
  function computeFirstSlotStart(now) {
    var plusHour = new Date(now.getTime() + 60 * 60 * 1000);
    var total = plusHour.getHours() * 60 + plusHour.getMinutes();
    var minutes = Math.ceil(total / SLOT_MINUTES) * SLOT_MINUTES;
    var day = midnight(plusHour);
    if (minutes >= MINUTES_IN_DAY) {
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      minutes = 0;
    }
    return { date: day, minutes: minutes };
  }

  // ── 2. Seven device-local day labels (label + device-local ISO date) ──
  function buildScheduleDays(now) {
    var names = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    var list = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      var label = i === 0 ? 'Hari ini' : (i === 1 ? 'Besok' : names[d.getDay()]);
      list.push({
        value: label,
        label: label,
        iso: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      });
    }
    return list;
  }

  function buildRange(startMinutes, endMinutes) {
    var slots = [];
    var m = startMinutes;
    while (m + SLOT_MINUTES <= endMinutes) {
      slots.push(slotItem(m, m + SLOT_MINUTES));
      m += SLOT_MINUTES;
    }
    return slots;
  }

  // ── 3. Seven day pools (day + its slots) ──
  // The day that CONTAINS the first available slot starts at that slot; every
  // later day starts at `opening_time` (default 00:00) and ends at
  // `closing_time` (default 24:00). A day whose window is null (off day)
  // produces NO slots.
  function buildDayPools(now, opts) {
    opts = opts || {};
    var isOff = opts.opening_time === null || opts.closing_time === null;
    var openMin = (opts.opening_time && !isOff) ? labelToMinutes(opts.opening_time) : 0;
    var closeMin = (opts.closing_time && !isOff) ? labelToMinutes(opts.closing_time) : MINUTES_IN_DAY;

    if (isOff) {
      return buildScheduleDays(now).map(function (d) { return { day: d, slots: [] }; });
    }

    var first = computeFirstSlotStart(now);
    var days = buildScheduleDays(now);
    var pools = [];
    var assigned = false;
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      var slots;
      var dMid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      if (!assigned && dMid.getTime() === first.date.getTime()) {
        var start = Math.max(first.minutes, openMin);
        if (start + SLOT_MINUTES <= closeMin) {
          slots = buildRange(start, closeMin);
        } else {
          // first slot falls after close -> today yields nothing; the next
          // day starts at the opening boundary.
          slots = [];
        }
        assigned = true;
      } else if (!assigned) {
        slots = []; // first available slot belongs to a later day
      } else {
        slots = buildRange(openMin, closeMin);
      }
      pools.push({ day: d, slots: slots });
    }
    return pools;
  }

  // ── 4. Timezone/CANONICAL helpers (device-local, timezone-aware) ──
  function getTimezoneOffsetMinutes(now) {
    return -now.getTimezoneOffset(); // WIB +07:00 -> +420
  }

  function formatOffset(minutes) {
    var sign = minutes < 0 ? '-' : '+';
    var abs = Math.abs(minutes);
    return sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }

  /**
   * Canonical ISO (with device offset) for a selected (dayLabel, slotValue).
   * The label is resolved to a device-local ISO date via buildScheduleDays(now).
   * Returns { start, end } or null when the label/slot cannot be resolved.
   */
  function selectedSlotToIso(now, dayLabel, slotValue) {
    if (!now || !dayLabel || !slotValue) return null;
    var days = buildScheduleDays(now);
    var day = null;
    for (var i = 0; i < days.length; i++) {
      if (days[i].value === dayLabel) { day = days[i]; break; }
    }
    if (!day) return null;
    var startMinutes = labelToMinutes(slotValue);
    var endMinutes = startMinutes + SLOT_MINUTES;
    var offset = formatOffset(getTimezoneOffsetMinutes(now));
    return {
      start: day.iso + 'T' + minutesLabel(startMinutes) + ':00' + offset,
      end: day.iso + 'T' + minutesLabel(endMinutes) + ':00' + offset
    };
  }

  if (typeof window !== 'undefined') {
    window.Xentra = window.Xentra || {};
    window.Xentra.DeliverySchedule = {
      computeFirstSlotStart: computeFirstSlotStart,
      buildScheduleDays: buildScheduleDays,
      buildDayPools: buildDayPools,
      selectedSlotToIso: selectedSlotToIso,
      labelToMinutes: labelToMinutes,
      minutesLabel: minutesLabel,
      SLOT_MINUTES: SLOT_MINUTES
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      computeFirstSlotStart: computeFirstSlotStart,
      buildScheduleDays: buildScheduleDays,
      buildDayPools: buildDayPools,
      selectedSlotToIso: selectedSlotToIso,
      labelToMinutes: labelToMinutes,
      minutesLabel: minutesLabel,
      SLOT_MINUTES: SLOT_MINUTES
    };
  }
})();