'use strict';

/**
 * Banner date/time helpers.
 *
 * Banner schedules are entered as Branch-local wall-clock values and persisted
 * as canonical UTC ISO timestamps. Evaluation compares instants, while the
 * Branch timezone remains the authoritative presentation/input context.
 */
class BannerDateTime {
  static assertValidTimeZone(timeZone) {
    const tz = String(timeZone || '').trim();
    if (!tz) {
      const err = new Error('Branch timezone wajib tersedia.');
      err.code = 'TIMEZONE_REQUIRED';
      throw err;
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    } catch (_) {
      const err = new Error('Branch timezone tidak valid.');
      err.code = 'INVALID_TIMEZONE';
      throw err;
    }
    return tz;
  }

  static parseLocalDateTime(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) {
      const err = new Error('Datetime schedule harus berformat YYYY-MM-DDTHH:mm.');
      err.code = 'INVALID_DATETIME';
      throw err;
    }

    const parts = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] || 0)
    };

    const probe = new Date(Date.UTC(
      parts.year, parts.month - 1, parts.day,
      parts.hour, parts.minute, parts.second
    ));

    if (
      probe.getUTCFullYear() !== parts.year ||
      probe.getUTCMonth() !== parts.month - 1 ||
      probe.getUTCDate() !== parts.day ||
      probe.getUTCHours() !== parts.hour ||
      probe.getUTCMinutes() !== parts.minute ||
      probe.getUTCSeconds() !== parts.second
    ) {
      const err = new Error('Datetime schedule tidak valid.');
      err.code = 'INVALID_DATETIME';
      throw err;
    }

    return parts;
  }

  static formatParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);

    const out = {};
    for (const part of parts) {
      if (part.type !== 'literal') out[part.type] = part.value;
    }
    return {
      year: Number(out.year),
      month: Number(out.month),
      day: Number(out.day),
      hour: Number(out.hour),
      minute: Number(out.minute),
      second: Number(out.second)
    };
  }

  static localToUtcIso(value, timeZone) {
    const tz = this.assertValidTimeZone(timeZone);
    const local = this.parseLocalDateTime(value);

    let candidateMs = Date.UTC(
      local.year, local.month - 1, local.day,
      local.hour, local.minute, local.second
    );

    for (let i = 0; i < 3; i++) {
      const observed = this.formatParts(new Date(candidateMs), tz);
      const observedMs = Date.UTC(
        observed.year, observed.month - 1, observed.day,
        observed.hour, observed.minute, observed.second
      );
      const targetMs = Date.UTC(
        local.year, local.month - 1, local.day,
        local.hour, local.minute, local.second
      );
      const delta = targetMs - observedMs;
      if (delta === 0) break;
      candidateMs += delta;
    }

    const finalObserved = this.formatParts(new Date(candidateMs), tz);
    if (
      finalObserved.year !== local.year ||
      finalObserved.month !== local.month ||
      finalObserved.day !== local.day ||
      finalObserved.hour !== local.hour ||
      finalObserved.minute !== local.minute ||
      finalObserved.second !== local.second
    ) {
      const err = new Error('Datetime schedule tidak valid untuk timezone Branch (waktu lokal mungkin tidak tersedia).');
      err.code = 'INVALID_LOCAL_TIME';
      throw err;
    }

    return new Date(candidateMs).toISOString();
  }

  static normalizeUtcInput(value) {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      const err = new Error('Timestamp schedule tidak valid.');
      err.code = 'INVALID_DATETIME';
      throw err;
    }
    return date.toISOString();
  }

  static compareUtc(a, b) {
    return new Date(a).getTime() - new Date(b).getTime();
  }

  static overlaps(aStart, aEnd, bStart, bEnd) {
    const aS = aStart ? new Date(aStart).getTime() : -Infinity;
    const aE = aEnd ? new Date(aEnd).getTime() : Infinity;
    const bS = bStart ? new Date(bStart).getTime() : -Infinity;
    const bE = bEnd ? new Date(bEnd).getTime() : Infinity;
    return aS < bE && bS < aE;
  }

  static effectiveStatus({ published, active, startsAt, endsAt, now = new Date() }) {
    if (!published) return 'DRAFT';
    if (!active) return 'PAUSED';

    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const startMs = startsAt ? new Date(startsAt).getTime() : null;
    const endMs = endsAt ? new Date(endsAt).getTime() : null;

    if (startMs !== null && nowMs < startMs) return 'SCHEDULED';
    if (endMs !== null && nowMs >= endMs) return 'ENDED';
    return 'ACTIVE';
  }
}

module.exports = BannerDateTime;
