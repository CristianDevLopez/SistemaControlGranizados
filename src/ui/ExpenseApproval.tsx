import { expenseCustodianId, expenseCustodianMessage } from '../domain/access.ts';
import type { Expense } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';

export function ExpenseApproval({
  expense,
  onDecision,
  label = '',
}: {
  expense: Expense;
  onDecision: (approve: boolean) => void;
  label?: string;
}) {
  const app = useApp();
  const { actor, state } = app.data!;
  if (actor.role !== 'admin' || expense.status !== 'pending') return null;
  if (actor.id === expenseCustodianId(state, expense)) return <small>{expenseCustodianMessage}</small>;
  return (
    <>
      <button className="button small primary" disabled={!app.online} onClick={() => onDecision(true)}>
        Aprobar{label}
      </button>
      <button className="button small secondary" disabled={!app.online} onClick={() => onDecision(false)}>
        Rechazar{label}
      </button>
    </>
  );
}
