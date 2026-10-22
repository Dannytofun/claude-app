'use strict';
// JSON schemas for every request body. Fastify validates before handlers run;
// unknown fields are stripped (removeAdditional) and limits stop oversized or malformed data.

const str = (max, extra = {}) => ({ type: 'string', maxLength: max, ...extra });
const money = { type: 'number', minimum: -1e9, maximum: 1e9 };
const id = str(64, { pattern: '^[A-Za-z0-9_-]*$' });
const ymd = str(10, { pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' });
const ym = str(7, { pattern: '^(\\d{4}-\\d{2})?$' });
const nullableMoney = { anyOf: [money, { type: 'null' }] };

const transaction = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'amount'],
  properties: {
    id, type: { enum: ['income', 'expense', 'savings'] }, amount: money, date: ymd,
    category: str(60), merchant: str(200), reference: str(100), notes: str(500), sourceFile: str(255),
    createdAt: str(40), sample: { type: 'boolean' }, billId: id, goalId: id,
    payslip: {
      type: 'object', additionalProperties: false,
      properties: { gross: nullableMoney, epf: nullableMoney, socso: nullableMoney, eis: nullableMoney, pcb: nullableMoney, period: ym }
    }
  }
};
const bill = {
  type: 'object', additionalProperties: false, required: ['id', 'name'],
  properties: {
    id, name: str(120), category: str(60), amount: money, isVariable: { type: 'boolean' },
    dueDay: { type: 'integer', minimum: 1, maximum: 31 }, frequency: { enum: ['monthly', 'quarterly', 'yearly'] },
    startMonth: ym, sample: { type: 'boolean' }
  }
};
const billPayment = {
  type: 'object', additionalProperties: false, required: ['billId', 'month'],
  properties: {
    billId: id, month: ym, paidDate: ymd, actualAmount: money, transactionId: { anyOf: [id, { type: 'null' }] },
    createdTx: { type: 'boolean' }, beforeTracking: { type: 'boolean' }, sample: { type: 'boolean' }
  }
};
const goal = {
  type: 'object', additionalProperties: false, required: ['id', 'name'],
  properties: { id, name: str(120), target: money, savedAmount: money, sample: { type: 'boolean' } }
};

const appState = {
  type: 'object',
  additionalProperties: false,
  required: ['transactions', 'bills', 'billPayments', 'goals', 'categories', 'settings'],
  properties: {
    version: { type: 'integer' },
    hasSample: { type: 'boolean' },
    transactions: { type: 'array', maxItems: 50000, items: transaction },
    bills: { type: 'array', maxItems: 500, items: bill },
    billPayments: { type: 'array', maxItems: 20000, items: billPayment },
    goals: { type: 'array', maxItems: 100, items: goal },
    budgets: { type: 'object', maxProperties: 100, propertyNames: { maxLength: 60 }, additionalProperties: money },
    categories: { type: 'array', maxItems: 100, items: str(60, { minLength: 1 }) },
    settings: {
      type: 'object', additionalProperties: false,
      properties: {
        savingsMode: { enum: ['percent', 'fixed'] },
        savingsPercent: { type: 'number', minimum: 0, maximum: 100 },
        savingsFixed: { type: 'number', minimum: 0, maximum: 1e9 },
        theme: { enum: ['system', 'light', 'dark'] },
        currency: { enum: ['RM', 'MYR'] },
        merchantCategoryMap: { type: 'object', maxProperties: 5000, propertyNames: { maxLength: 200 }, additionalProperties: str(60) },
        keywords: {
          type: 'object', maxProperties: 100, propertyNames: { maxLength: 60 },
          additionalProperties: { type: 'array', maxItems: 200, items: str(60) }
        }
      }
    }
  }
};

const credentials = {
  type: 'object', additionalProperties: false, required: ['email', 'password'],
  properties: { email: str(254), password: str(1024) }
};

module.exports = {
  credentials,
  putState: {
    type: 'object', additionalProperties: false, required: ['version', 'data'],
    properties: { version: { type: 'integer', minimum: 0 }, data: appState }
  },
  changePassword: {
    type: 'object', additionalProperties: false, required: ['currentPassword', 'newPassword'],
    properties: { currentPassword: str(1024), newPassword: str(1024) }
  },
  deleteAccount: {
    type: 'object', additionalProperties: false, required: ['password', 'confirm'],
    properties: { password: str(1024), confirm: { const: 'DELETE' } }
  }
};
