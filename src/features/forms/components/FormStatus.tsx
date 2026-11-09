/** Whether a form is taking submissions: a dot and a word, so it doesn't rest on colour. */
export function FormStatus({ paused }: { paused: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        paused ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300' : 'bg-emerald-500/12 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-amber-600 dark:bg-amber-400' : 'bg-emerald-600 dark:bg-emerald-400'}`} aria-hidden />
      {paused ? 'Paused' : 'Live'}
    </span>
  )
}
