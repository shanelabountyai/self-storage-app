// B-442. The queue `app/layout.tsx`'s inline script fills with presses made
// on an `AdminForm` before hydration, keyed by the form element.
interface Window {
  __adminFormReplay?: Map<HTMLFormElement, FormData>
}
