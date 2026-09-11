import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
  // B-284. A date on a customer screen is written in the reader's language.
  // `formatCalendarDate` and `formatDay` default to en-US for the staff screens
  // (D-122), so a call here with no tag rots silently into an English date
  // inside a Spanish sentence — which is how ten of them got there.
  // `tests/untagged-dates-lint.test.ts` pins that this refuses each shape.
  {
    files: ["app/portal/**/*.{ts,tsx}", "app/(public)/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
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
      ],
    },
  },
]);

export default eslintConfig;
