const dateTimeParts = (date: string, time: string) => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) throw new Error('Enter a valid schedule date and time.')
  const [, year, month, day] = dateMatch.map(Number)
  const [, hour, minute] = timeMatch.map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('Enter a valid schedule date and time.')
  }
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error('Enter a valid schedule date and time.')
  }
  return { year, month, day, hour, minute }
}

export const dateTimeToUtc = (date: string, time: string, timeZone: string): string => {
  const target = dateTimeParts(date, time)
  const nominalUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute)
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  let candidate = nominalUtc
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]))
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    const difference = nominalUtc - representedUtc
    if (difference === 0) return new Date(candidate).toISOString()
    candidate += difference
  }
  throw new Error('This local time does not exist in the selected time zone.')
}
