const DAY_MS = 24 * 60 * 60 * 1000;

function getZonedParts(date = new Date(), timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour)
  };
}

function getDateString(date = new Date(), timezone = 'UTC') {
  return getZonedParts(date, timezone).date;
}

function getCutoffDate(retentionDays, timezone = 'UTC', now = new Date()) {
  const days = Math.max(1, Number(retentionDays) || 1);
  return getDateString(new Date(now.getTime() - days * DAY_MS), timezone);
}

module.exports = {
  getZonedParts,
  getDateString,
  getCutoffDate
};
