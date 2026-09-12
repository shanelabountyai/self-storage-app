import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// B-284. A date on a customer screen is written in the reader's language.
// `formatCalendarDate` and `formatDay` default to en-US for the staff screens
// (D-122), so a call here with no tag rots silently into an English date
// inside a Spanish sentence — which is how ten of them got there.
// `tests/untagged-dates-lint.test.ts` pins that this refuses each shape.
const CUSTOMER_DATE_RULES = [
  {
    selector:
      "CallExpression[callee.name='formatCalendarDate'][arguments.length<3]",
    message:
      "Pass LOCALE_TAG[locale] as the third argument: a customer screen writes dates in the reader's language (B-284).",
  },
  {
    selector: "CallExpression[callee.name='formatDay'][arguments.length<2]",
    message:
      "Pass LOCALE_TAG[locale] as the second argument: a customer screen writes dates in the reader's language (B-284).",
  },
  {
    selector:
      "NewExpression[callee.property.name='DateTimeFormat'][arguments.0.value='en-US']",
    message:
      "Use LOCALE_TAG[locale], not 'en-US': a customer screen writes dates in the reader's language (B-284).",
  },
];

// B-295. A `role="alert"` on a portal PAGE is page content wearing a live-region
// role: true when the page is drawn, unchanged while it is read, reached by
// heading and document position (B-245's ruling). The legitimate alerts report
// the result of a press AND take focus (B-285's exception), and every one of
// those lives in `components/` — `AdminForm`'s refusal box, the Stripe decline
// mirror — so this is scoped to the pages alone, and only to the portal pages
// this row actually audited. `tests/portal-alert-lint.test.ts` pins it.
const PORTAL_ALERT_RULE = {
  selector: "JSXAttribute[name.name='role'][value.value='alert']",
  message:
    'A portal page\'s role="alert" is page content, not a status message: it is true when the page is drawn and nothing focuses it (B-295, B-245). A real status message reports a press and takes focus — put it in `components/`, the way AdminForm does.',
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["app/(public)/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...CUSTOMER_DATE_RULES],
    },
  },
  // The date rules are REPEATED here rather than left to the block above.
  // Flat config resolves a rule last-block-wins for a file matching both, so a
  // portal-only block listing the alert rule alone would silently switch
  // B-284's ten date guards off for `app/portal/**` — the exact class of
  // regression that guard exists to catch. `tests/untagged-dates-lint.test.ts`
  // asserts 3 refusals under `app/portal/`, which is what proves this.
  {
    files: ["app/portal/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...CUSTOMER_DATE_RULES, PORTAL_ALERT_RULE],
    },
  },
]);

export default eslintConfig;
