import { expect, it } from 'vitest';
import {
  isNequiAccount,
  paymentNote,
  paymentOptionLabel,
  transferAccountName,
} from '../src/ui/payment-labels.ts';
import { fixture } from './support/fixture.ts';

it('identifica Nequi aunque sea la única cuenta o tenga un nombre personalizado', () => {
  const bank = fixture().locations[0];
  const nequi = { ...bank, bank: 'NEQUI', name: 'Cobros del local' };
  expect(isNequiAccount(nequi)).toBe(true);
  expect(paymentOptionLabel(nequi, [nequi])).toBe('Nequi');
  expect(paymentOptionLabel(nequi, [nequi, bank])).toBe('Nequi');
  expect(transferAccountName(nequi)).toBe('Nequi · Cobros del local');
  expect(isNequiAccount({ ...bank, name: 'Nequi del negocio' })).toBe(true);
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
