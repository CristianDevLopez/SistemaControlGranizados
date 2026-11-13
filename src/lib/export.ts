import { strToU8, zipSync } from 'fflate';
import type { State } from '../domain/types.ts';
function cell(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  const safe = typeof value !== 'number' && /^[\s]*[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function csv(rows: Record<string, unknown>[], columns: string[] = []): string {
  const keys = [...new Set([...columns, ...rows.flatMap(Object.keys)])];
  return (
    '\uFEFF' +
    [keys.map(cell).join(','), ...rows.map((row) => keys.map((key) => cell(row[key])).join(','))].join('\r\n')
  );
}
const schema: Record<string, string[]> = {
  settings: [
    'id',
    'version',
    'cashLimit',
    'expenseLimit',
    'expenseCategories',
    'courtesyQuota',
    'cupPackageUnits',
    'bagOunces',
    'liquidTolerance',
    'syncWarningMinutes',
    'skipOpeningCount',
    'baseline',
    'businessName',
    'lastRetainedCash',
    'lastCountId',
    'openingChecklist',
    'closingChecklist',
    'inventoryInitialized',
    'auditId',
    'auditRequest',
  ],
  flavors: ['id', 'name', 'alcohol', 'active', 'imageId'],
  sizes: ['id', 'name', 'ounces', 'alcoholPrice', 'plainPrice', 'cups', 'beers', 'active', 'rank'],
  orders: [
    'id',
    'number',
    'shiftId',
    'sellerId',
    'cashierId',
    'status',
    'createdAt',
    'paidAt',
    'total',
    'version',
    'origin',
    'originalAt',
    'paperFolio',
    'evidenceId',
    'replacesId',
    'paymentCredit',
    'paymentTransferFromId',
    'inventoryTransferred',
    'carriedCouponFromId',
    'resolvedAt',
    'lines',
    'tastings',
  ],
  payments: [
    'id',
    'orderId',
    'shiftId',
    'cashierId',
    'amount',
    'type',
    'method',
    'accountId',
    'reference',
    'at',
    'eventId',
  ],
  deliveries: ['id', 'orderId', 'lineId', 'quantity', 'by', 'at', 'eventId'],
  stock: ['id', 'article', 'quantity', 'reason', 'referenceId', 'at', 'by', 'eventId'],
  shifts: [
    'id',
    'cashierId',
    'deviceId',
    'status',
    'requestedAt',
    'openedAt',
    'authorizedBy',
    'base',
    'openingSkipped',
    'openingCountId',
    'closingCountId',
    'retained',
    'remittance',
    'closedAt',
    'offlineAuthorizedBy',
  ],
  counts: [
    'id',
    'kind',
    'shiftId',
    'by',
    'at',
    'cash',
    'items',
    'expectedCash',
    'expectedItems',
    'difference',
    'differences',
    'payments',
    'paymentLabels',
    'expectedPayments',
    'paymentDifferences',
    'retained',
    'notes',
    'checklist',
    'auditId',
    'requestedBy',
    'requestedAt',
    'itemLabels',
  ],
  shipments: ['id', 'by', 'from', 'supplier', 'items', 'expenseId', 'at', 'status', 'notes'],
  receipts: [
    'id',
    'shipmentId',
    'by',
    'at',
    'items',
    'damaged',
    'expected',
    'differences',
    'evidenceId',
    'notes',
  ],
  expenses: [
    'id',
    'by',
    'at',
    'category',
    'amount',
    'source',
    'locationId',
    'supplier',
    'notes',
    'evidenceId',
    'shiftId',
    'status',
    'approvedBy',
    'shipmentId',
  ],
  locations: [
    'id',
    'name',
    'type',
    'custodianId',
    'bank',
    'account',
    'active',
    'openingBalance',
    'receivesSales',
  ],
  transfers: [
    'id',
    'by',
    'recipientId',
    'from',
    'to',
    'amount',
    'status',
    'at',
    'executedAt',
    'confirmedAt',
    'confirmedBy',
    'receivedAmount',
    'evidenceId',
    'notes',
    'shiftId',
    'executionShiftId',
    'type',
    'votes',
    'expenseId',
  ],
  promotions: [
    'id',
    'name',
    'effect',
    'stackable',
    'delivery',
    'sizeIds',
    'flavorIds',
    'alcohol',
    'courtesyOnly',
    'allowMixed',
    'fixedPrice',
    'steps',
    'take',
    'pay',
    'startsAt',
    'endsAt',
    'days',
    'startTime',
    'endTime',
    'maxRedemptions',
    'redemptions',
    'active',
    'version',
    'by',
    'at',
  ],
  coupons: [
    'id',
    'code',
    'promotionId',
    'issuedBy',
    'issuedAt',
    'expiresAt',
    'status',
    'orderId',
    'redeemedAt',
    'courtesy',
    'excessApprovedBy',
    'benefit',
  ],
  requests: [
    'id',
    'type',
    'by',
    'at',
    'status',
    'referenceId',
    'article',
    'quantity',
    'notes',
    'evidenceId',
    'reviewedBy',
    'reviewedAt',
    'originalCommand',
    'resolutionNotes',
    'resolutionId',
  ],
  goals: ['id', 'period', 'startsAt', 'endsAt', 'cups', 'amount', 'by', 'at'],
  parameters: ['id', 'by', 'at', 'kind', 'before', 'after', 'version'],
  audit: [
    'id',
    'eventId',
    'by',
    'deviceId',
    'at',
    'reportedAt',
    'receivedAt',
    'action',
    'referenceId',
    'detail',
  ],
  notifications: ['id', 'channel', 'text', 'at', 'status', 'attempts', 'lastError'],
  packages: ['id', 'sizeId', 'units', 'openedAt', 'by', 'closedAt', 'priorDifference'],
  bags: ['id', 'flavorId', 'ounces', 'openedAt', 'by', 'exhaustedAt'],
  attachments: ['id', 'by', 'mime', 'size', 'name', 'createdAt', 'status', 'path', 'sha256'],
  outages: ['id', 'deviceId', 'from', 'until'],
  order_lines: [
    'orderId',
    'id',
    'flavorId',
    'flavorIds',
    'sizeId',
    'quantity',
    'delivered',
    'listPrice',
    'unitPrice',
    'discount',
    'promotionId',
    'couponId',
    'paidSizeId',
    'consumptionIds',
    'recipe',
    'appliedRules',
  ],
  tastings: ['orderId', 'id', 'flavorId', 'at'],
  profiles: ['id', 'name', 'role', 'active', 'username', 'permissions'],
  devices: ['id', 'userId', 'name', 'active', 'primary', 'lastSeen'],
};
export function exportZip(input: {
  branch?: import('../domain/platform.ts').Branch;
  state: State;
  profiles: unknown[];
  devices: unknown[];
  exportedAt: string;
  schemaVersion: number;
}): Uint8Array {
  const files: Record<string, Uint8Array> = {},
    dictionary: Record<string, unknown>[] = [];
  for (const [key, value] of Object.entries(input.state)) {
    const rows = value as unknown as Record<string, unknown>[];
    files[`${key}.csv`] = strToU8(csv(rows, schema[key]));
  }
  files['order_lines.csv'] = strToU8(
    csv(
      input.state.orders.flatMap((o) => o.lines.map((l) => ({ orderId: o.id, ...l }))),
      schema.order_lines,
    ),
  );
  files['tastings.csv'] = strToU8(
    csv(
      input.state.orders.flatMap((o) => o.tastings.map((t) => ({ orderId: o.id, ...t }))),
      schema.tastings,
    ),
  );
  files['profiles.csv'] = strToU8(csv(input.profiles as Record<string, unknown>[], schema.profiles));
  files['devices.csv'] = strToU8(csv(input.devices as Record<string, unknown>[], schema.devices));
  for (const [key, fields] of Object.entries(schema))
    for (const field of fields)
      dictionary.push({
        archivo: `${key}.csv`,
        campo: field,
        descripcion:
          field === 'id'
            ? 'UUID estable'
            : field.endsWith('Id')
              ? 'Referencia al UUID de otra entidad'
              : field.endsWith('At') || field === 'at'
                ? 'Fecha y hora ISO 8601 en UTC'
                : /amount|price|total|cash|balance|retained|remittance/i.test(field)
                  ? 'Pesos colombianos enteros'
                  : field === 'quantity'
                    ? 'Cantidad; volúmenes en oz para artículos liquid:'
                    : field === 'appliedRules'
                      ? 'Reglas y versiones históricas, cantidades y cobros por beneficio en JSON'
                      : field === 'recipe'
                        ? 'Composición histórica: onzas, vasos y coronitas en JSON'
                        : 'Campo de la entidad; objetos y listas se representan como JSON',
      });
  files['diccionario.csv'] = strToU8(csv(dictionary));
  files['manifest.json'] = strToU8(
    JSON.stringify(
      {
        exportedAt: input.exportedAt,
        schemaVersion: input.schemaVersion,
        ...(input.branch ? { branch: input.branch } : {}),
        timeZone: 'UTC',
        displayTimeZone: 'America/Bogota',
        currency: 'COP',
        volume: 'US fl oz',
        files: Object.keys(files),
        notes:
          'Los registros desde papel conservan origen, folio y hora original. Las fotos se respaldan por separado.',
      },
      null,
      2,
    ),
  );
  return zipSync(files, { level: 6 });
}
export function downloadFile(data: BlobPart, name: string, type = 'application/octet-stream') {
  const href = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}
