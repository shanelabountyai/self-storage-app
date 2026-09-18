import { receiptRows, type CounterReceipt } from '@/lib/admin/pos'

// B-281 / B-320. The printed counter receipt, for cash and card alike. The rows
// come from `receiptRows`, so the two screens cannot print different units for
// the same credits.

export function CounterReceiptTable({ receipt }: { receipt: CounterReceipt }) {
  const rows = receiptRows(receipt)
  return (
    <table className="w-full text-sm">
      <caption className="pb-2 text-left font-medium">
        {receipt.facilityName} — payment received
      </caption>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className={index < rows.length - 1 ? 'border-b' : undefined}>
            <th scope="row" className="py-2 pr-4 text-left align-top font-medium">
              {row.label}
            </th>
            <td
              className={`py-2 text-right align-top tabular-nums${row.strong ? ' font-medium' : ''}`}
            >
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
