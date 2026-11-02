import { startTransition, type FormEvent } from 'react';

// Every upload is capped at 4MB on the server; the request itself fails above ~4.4MB and would take
// the page down, so a bigger file is stopped here with a message instead.
const MAX_FILE = 4 * 1024 * 1024;

// React resets a <form action={fn}> after every submit, error or not, so a validation error wipes
// what the user typed (and an edit form snaps back to the stored values). Submitting through
// onSubmit keeps the fields as typed; forms that should clear after a successful save reset
// themselves on `state.ok`, and dialog forms unmount when they close.
export const submitWith = (run: (f: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  for (const input of e.currentTarget.querySelectorAll<HTMLInputElement>('input[type=file]')) {
    const big = [...(input.files ?? [])].find(file => file.size > MAX_FILE);
    if (big) {
      alert(`הקובץ "${big.name}" גדול מ-4MB. אפשר לצלם ברזולוציה נמוכה יותר או לשמור כ-PDF.`);
      return;
    }
  }
  const f = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
  startTransition(() => run(f));
};
