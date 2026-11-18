import { total } from './sum.js';
import { paginate, pageCount } from './paginate.js';

// Composes the pagination and totaling helpers into a text report.

export function buildReport(transactions, page, size) {
  const visible = paginate(transactions, page, size);
  const amounts = visible.map((transaction) => transaction.amount);
  return {
    page,
    pages: pageCount(transactions.length, size),
    count: visible.length,
    total: total(amounts),
    entries: visible.map(formatEntry)
  };
}

function formatEntry(transaction) {
  return [transaction.date, transaction.label, transaction.amount].join(' ');
}

export function renderReport(report) {
  const header = ['page', report.page, 'of', report.pages, 'pages'].join(' ');
  return [header].concat(report.entries).join('\n');
}
