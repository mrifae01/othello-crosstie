/** Marks a surface whose feature isn't built yet (AI coach, puzzles, practice…). One place to restyle or remove. */
export function ComingSoon({ label = 'Coming soon' }: { label?: string }) {
  return <span className="soon-badge">{label}</span>;
}
