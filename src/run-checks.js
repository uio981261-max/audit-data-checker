import { checkDuplicates } from './checks/duplicates.js';
import { checkSequence } from './checks/sequence.js';
import { checkCalendar } from './checks/calendar.js';
import { checkRound } from './checks/round.js';
import { checkHygiene } from './checks/hygiene.js';
import { checkYears } from './checks/years.js';
import { checkCompleteness } from './checks/completeness.js';
import { checkBenford } from './checks/benford.js';

export function runChecks(rows, options = {}) {
  return [checkDuplicates(rows), checkSequence(rows), checkCalendar(rows, options), checkRound(rows, options), checkHygiene(rows), checkYears(rows, options), checkCompleteness(rows, options), checkBenford(rows)];
}
