"use client";

import { useState } from "react";
import { Field } from "@/components/admin/form";

// B-178. "Back as" and the cheque number, as one control pair.
//
// The cheque number was always visible under a hint reading "Cheques only." — a
// field inapplicable four fifths of the time, on a form that moves money,
// asking staff to read a hint to work out they should skip it. It renders only
// when the refund is actually going out as a cheque, which is the same
// disclosure `ChargeFeeForm` uses for the same reason: the shape of the form is
// the instruction.
//
// The spelling stays "Cheque" deliberately — the product-wide D-15 pass to
// "check" is B-182's, and doing half of it here would hide the rest from that
// row's own grep.
export function RefundMethodFields({
  defaultMethod,
}: {
  defaultMethod: "card" | "cash";
}) {
  const [method, setMethod] = useState<string>(defaultMethod);

  return (
    <>
      <Field
        name="method"
        label="Back as"
        as="select"
        value={method}
        onChange={(event) => setMethod(event.target.value)}
      >
        <option value="card">Card (original method)</option>
        <option value="cash">Cash</option>
        <option value="check">Cheque</option>
      </Field>
      {method === "check" && <Field name="checkNumber" label="Cheque number" />}
    </>
  );
}
