import { expect, it } from 'vitest';
import {
  isNequiAccount,
  paymentNote,
  paymentOptionLabel,
  transferAccountName,
} from '../src/ui/payment-labels.ts';
import { redactState } from '../src/domain/engine.ts';
import { orderPaymentLabels } from '../src/domain/payment-methods.ts';
import { admin, cashier, fixture, ids, order, run } from './support/fixture.ts';

it('identifica Nequi aunque sea la única cuenta o tenga un nombre personalizado', () => {
  const bank = fixture().locations[0];
  const nequi = { ...bank, bank: 'NEQUI', name: 'Cobros del local' };
  expect(isNequiAccount(nequi)).toBe(true);
  expect(paymentOptionLabel(nequi, [nequi])).toBe('Nequi');
  expect(paymentOptionLabel(nequi, [nequi, bank])).toBe('Nequi');
  expect(transferAccountName(nequi)).toBe('Nequi · Cobros del local');
  expect(isNequiAccount({ ...bank, name: 'Nequi del negocio' })).toBe(true);
});

it('muestra efectivo y la cuenta corregida por pedido sin enviar registros de pago al empleado', () => {
  const base = fixture();
  base.locations[0].name = 'Nequi';
  const first = order(base);
  const second = order(run(first.state, 'pay', { orderId: first.order.id }).state);
  const paid = run(second.state, 'pay', { orderId: second.order.id }).state;
  const original = paid.payments.find((payment) => payment.orderId === second.order.id)!;
  const corrected = run(
    paid,
    'review_shift',
    {
      shiftId: ids.shift,
      action: 'correct_payment',
      paymentId: original.id,
      method: 'transfer',
      accountId: ids.location,
      notes: 'Se verificó la transferencia.',
    },
    admin,
  ).state;
  const labels = { [first.order.id]: ['Efectivo'], [second.order.id]: ['Transferencia · Nequi'] };
  expect(orderPaymentLabels(corrected)).toEqual(labels);
  const employee = redactState(corrected, cashier);
  expect(employee.payments).toEqual([]);
  expect(orderPaymentLabels(employee)).toEqual(labels);
});

it('distingue varias cuentas Nequi sin confundirlas con otras transferencias', () => {
  const bank = fixture().locations[0];
  const first = { ...bank, bank: 'Nequi', name: 'Nequi principal' };
  const second = { ...bank, id: crypto.randomUUID(), bank: 'Nequi', name: 'Nequi secundario' };
  expect(paymentOptionLabel(first, [bank, first, second])).toBe('Nequi principal');
  expect(paymentOptionLabel(second, [bank, first, second])).toBe('Nequi secundario');
  expect(paymentOptionLabel(bank, [bank])).toBe('Transferencia');
  expect(paymentOptionLabel(bank, [bank, first])).toBe('Cuenta de prueba');
});

it('el mensaje de venta identifica Nequi y conserva los mensajes de efectivo y otras transferencias', () => {
  const bank = fixture().locations[0];
  const nequi = { ...bank, bank: 'Nequi' };
  expect(paymentNote({ method: 'transfer', accountId: bank.id }, [nequi])).toBe(' · Nequi');
  expect(paymentNote({ method: 'transfer', accountId: bank.id }, [bank])).toBe(' · transferencia');
  expect(paymentNote({ method: 'cash' }, [nequi])).toBe('');
  expect(transferAccountName()).toBe('Cuenta');
});
