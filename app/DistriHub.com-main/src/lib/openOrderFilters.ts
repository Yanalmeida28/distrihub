import { adminBusinessDay } from './adminDashboard';
export function orderMatchesDate(createdAt: string, start: string, end: string, timeZone?: string): boolean {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return false;
  const day = adminBusinessDay(date, timeZone);
  return (!start || day >= start) && (!end || day <= end);
}
