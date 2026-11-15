import { useMemo } from "react";
import { settlementBalances } from "../lib/budgetFinance.js";
import { isBudgetComplete } from "../lib/budgetLifecycleValues.js";
import { expenseHistoricalMembers } from "../lib/expenseSnapshot.js";
import { memberName } from "../lib/memberName.js";
import { WorkspaceHeading, WorkspaceSummary, workspaceMoney } from "./workspace/TravelWorkspace.jsx";

function buildParticipantsMap(participants, foreignKey) {
  const next = {};
  participants.forEach((participant) => {
    next[participant[foreignKey]] = [...(next[participant[foreignKey]] || []), participant.user_id];
  });
  return next;
}

function simplifyTransfers(balances) {
  const debtors = balances
    .filter((entry) => entry.balance < -0.5)
    .map((entry) => ({ ...entry, amount: Math.abs(entry.balance) }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((entry) => entry.balance > 0.5)
    .map((entry) => ({ ...entry, amount: entry.balance }))
    .sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0.5) {
      transfers.push({ from: debtor.user_id, to: creditor.user_id, amount: Math.round(amount) });
    }
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount <= 0.5) debtorIndex += 1;
    if (creditor.amount <= 0.5) creditorIndex += 1;
  }

  return transfers;
}

export default function SettlementPanel({ expenseGraph, actualExpenses: allExpenses, actualParticipants, budgetItems: rawBudgetItems, members }) {
  const actualExpenses = allExpenses.filter((row) => isBudgetComplete(row)&&row.payment_active !== false);
  const approvedMembers = members.filter((member) => member.status === "approved");
  const budgetItems = rawBudgetItems.filter(isBudgetComplete);
  const participantsByExpense = useMemo(
    () => buildParticipantsMap(actualParticipants, "actual_expense_id"),
    [actualParticipants],
  );
  const actualBudgetIds = new Set(actualExpenses.map((expense) => expense.id));
  const pendingBudgetItems = budgetItems.filter((budget) => !actualBudgetIds.has(budget.id));
  const actualTotal = actualExpenses.reduce((sum, expense) => sum + Number(expense.twd_amount || 0), 0);
  const { balances, incomplete } = settlementBalances(allExpenses, actualParticipants, approvedMembers, expenseHistoricalMembers(expenseGraph));
  const memberById = new Map(balances.map((member) => [member.user_id, member]));
  const transfers = incomplete ? [] : simplifyTransfers(balances);
  if (!expenseGraph) return <p className="muted-text">支出資料尚未確認，暫時無法計算分帳。</p>;

  return (
    <section className="panel settlement-panel travel-workspace">
      <WorkspaceHeading title="分帳結算" description="誰先付了、誰該分攤，一次看清楚。金額以實付紀錄計算。" />
      <WorkspaceSummary items={[
        { label: "實際金額", value: workspaceMoney(actualTotal) },
        { label: "尚未付款", value: workspaceMoney(pendingBudgetItems.reduce((sum, item) => sum + Number(item.twd_amount || 0), 0)) },
      ]} />

      <div className="settlement-grid">
        <section className="settlement-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">People</p>
              <h3>每人分攤與代墊</h3>
            </div>
          </div>
          <div className="settlement-table">
            <div className="settlement-row settlement-header">
              <span>成員</span>
              <span>應付</span>
              <span>已付</span>
              <span>應收／應付</span>
            </div>
            {balances.map((entry) => (
              <div className="settlement-row" key={entry.user_id}>
                <strong>{entry.name}</strong>
                <span>{workspaceMoney(entry.shouldPay)}</span>
                <span>{workspaceMoney(entry.paid)}</span>
                <span className={entry.balance >= 0 ? "positive-balance" : "negative-balance"}>
                  {entry.balance > 0 ? "應收 " : entry.balance < 0 ? "應付 " : ""}{workspaceMoney(Math.abs(entry.balance))}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="settlement-section">
          <div className="panel-heading tight">
            <div>
              <p className="eyebrow">Transfers</p>
              <h3>建議付款路徑</h3>
            </div>
          </div>
          <p className="muted">依目前差額整理；完成實際付款後請自行確認。</p>
          <div className="transfer-list">
            {transfers.length ? (
              transfers.map((transfer, index) => (
                <div className="transfer-row" key={`${transfer.from}-${transfer.to}-${index}`}>
                  <strong>{memberName(memberById.get(transfer.from))}</strong>
                  <span>付給</span>
                  <strong>{memberName(memberById.get(transfer.to))}</strong>
                  <span>{workspaceMoney(transfer.amount)}</span>
                </div>
              ))
            ) : (
              <div className="timeline-empty">{incomplete ? "請先確認付款人及自訂分攤金額，再計算轉帳建議。" : "目前沒有需要互相付款的差額"}</div>
            )}
          </div>
        </section>
      </div>

      <section className="settlement-section">
        <div className="panel-heading tight">
          <div>
            <p className="eyebrow">Actual Expenses</p>
            <h3>實付明細</h3>
          </div>
        </div>
        <div className="budget-cards">
          {actualExpenses.length ? (
            actualExpenses.map((expense) => {
              const payer = memberById.get(expense.payer_id);
              const participants = participantsByExpense[expense.id] || [];
              return (
                <article className="settlement-expense" key={expense.id}>
                  <div>
                    <strong>{expense.title}</strong>
                    <span>{expense.paid_at ? new Date(expense.paid_at).toLocaleDateString("zh-TW") : "未設定日期"}</span>
                  </div>
                  <span>{workspaceMoney(expense.twd_amount)}</span>
                  <span>{expense.payment_mode==='self'?'各自付':expense.payment_mode==='advance'?'代付：'+(expense.payments||[]).map(p=>memberName(memberById.get(p.user_id))+' '+workspaceMoney(p.twd_amount)).join('、'):'付款人：'+memberName(payer)}</span>
                  <span>
                    分攤：
                    {participants.length
                      ? participants.map((userId) => memberName(memberById.get(userId))).join("、")
                      : expenseGraph ? "既有紀錄未記載名單" : "全部成員"}
                  </span>
                </article>
              );
            })
          ) : (
            <div className="timeline-empty">尚未建立實付，結算會在有實付後開始計算</div>
          )}
        </div>
      </section>

      <section className="settlement-section">
        <div className="panel-heading tight">
          <div>
            <p className="eyebrow">Pending Budget</p>
            <h3>尚未付款的預算</h3>
          </div>
        </div>
        <div className="budget-cards">
          {pendingBudgetItems.length ? (
            pendingBudgetItems.map((budget) => (
              <article className="settlement-expense" key={budget.id}>
                <div>
                  <strong>{budget.title}</strong>
                  <span>
                    {budget.category}
                    {budget.subcategory ? `｜${budget.subcategory}` : ""}
                  </span>
                </div>
                <span>{workspaceMoney(budget.twd_amount)}</span>
                <span>{budget.is_fixed ? "固定費用" : "預估費用"}</span>
              </article>
            ))
          ) : (
            <div className="timeline-empty">所有預算都已轉入實付或沒有待處理預算</div>
          )}
        </div>
      </section>
    </section>
  );
}
